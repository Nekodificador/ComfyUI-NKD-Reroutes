// Auto-arrange — planner puro. Sin DOM, sin canvas, sin LiteGraph: se ejecuta
// bajo node para los tests (igual que computeSnap / computeTension).
//
// Idea: se parte del FINAL (el sink) hacia atrás.
//   • X = rank por longest-path hacia el sink (las fuentes a la izquierda, el
//     sampler y los outputs a la derecha; los samplers encadenados salen solos).
//   • Y = banda según a QUÉ input del sampler alimenta la cadena del nodo, en el
//     MISMO ORDEN que los sockets del sampler. Un KSampler (model, positive,
//     negative, latent) da model→arriba … latent→abajo; un SamplerCustomAdvanced
//     (noise, guider, sampler, sigmas, latent) reparte en ese orden. El `guider`
//     se desenvuelve un nivel: dentro van el model (arriba) y el conditioning.
//   • El sampler + lo que va aguas abajo (decode, save…) forman un EJE CENTRAL a
//     la derecha: van centrados en vertical y NO inflan las bandas (así un
//     SaveImage gigante no empuja el latente al fondo).
//
// Encima, una zona de LOADERS (Checkpoint/UNET/VAE/CLIP/Lora/…Loader) + sus Set
// nodes, aparcada en una rejilla arriba, fuera del flujo.
//
// Sólo se recorren conexiones VISIBLES: el adaptador filtra a links reales entre
// nodos del workSet, así que Set/Get (por nombre) y UseEverywhere (broadcast) —que
// no viven en graph.links— nunca llegan aquí.

/**
 * @param {{nodes:Array, edges:Array}} snapshot
 *   nodes: [{ id, type, inputs:[{name,type}], pos:[x,y], w, h, pinned }]
 *   edges: [{ from, to, toSlot }]   // sólo links visibles entre nodos del workSet
 * @param {{gapX:number, gapY:number}} opts
 * @returns {{ nodeMoves: Map<id,[x,y]> }}
 */
// Envoltorio: parte el grafo en COMPONENTES CONEXOS (por links visibles) y ordena
// cada uno por separado, anclado a su propia posición original. Así dos workflows
// desconectados en el mismo canvas se tratan como instancias aparte y no se colocan
// uno encima del otro — cada cluster se reorganiza en su zona.
export function computeArrange(snapshot, opts) {
  const nodes = snapshot?.nodes || []
  const edges = snapshot?.edges || []
  const byId = new Map(nodes.map(n => [n.id, n]))
  const adj = new Map(nodes.map(n => [n.id, []]))
  for (const e of edges) if (byId.has(e.from) && byId.has(e.to)) { adj.get(e.from).push(e.to); adj.get(e.to).push(e.from) }
  const comp = new Map()
  let ci = 0
  for (const n of nodes) {
    if (comp.has(n.id)) continue
    const q = [n.id]; comp.set(n.id, ci)
    while (q.length) { const id = q.shift(); for (const a of adj.get(id) || []) if (!comp.has(a)) { comp.set(a, ci); q.push(a) } }
    ci++
  }
  const groups = new Map()
  for (const n of nodes) { const c = comp.get(n.id); (groups.get(c) ?? groups.set(c, []).get(c)).push(n) }
  const nodeMoves = new Map()
  for (const [, gnodes] of groups) {
    const ids = new Set(gnodes.map(n => n.id))
    const gedges = edges.filter(e => ids.has(e.from) && ids.has(e.to))
    const r = arrangeOne({ nodes: gnodes, edges: gedges }, opts)
    for (const [id, pos] of r.nodeMoves) nodeMoves.set(id, pos)
  }
  return { nodeMoves }
}

function arrangeOne(snapshot, opts) {
  const gapX = opts?.gapX ?? 36
  const gapY = opts?.gapY ?? 12
  // Dentro de un cluster los nodos van pegados (gapY ~10). Entre clusters/carriles
  // distintos, un hueco mayor (~30) para que se lean como grupos separados.
  const clusterGap = Math.max(30, gapY * 2)

  const nodes = snapshot.nodes || []
  const edges = snapshot.edges || []
  const byId = new Map(nodes.map(n => [n.id, n]))

  // Offset REAL de un socket desde el TOP del nodo (lo pasa el adaptador vía
  // getConnectionPos). Fallback aproximado sólo para tests bajo node. Alinear socket
  // con socket es lo que deja el cable recto — la idea del imán aplicada al colocar.
  const inOff = (node, slot) => node?.inOff?.[slot] ?? (30 + ((slot || 0) + 0.5) * 20)
  const outOff = (node, slot) => node?.outOff?.[slot] ?? (30 + ((slot || 0) + 0.5) * 20)

  const incoming = new Map()
  const outgoing = new Map()
  for (const n of nodes) { incoming.set(n.id, []); outgoing.set(n.id, []) }
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue
    outgoing.get(e.from).push(e)
    incoming.get(e.to).push(e)
  }
  const connected = new Set()
  for (const e of edges) if (byId.has(e.from) && byId.has(e.to)) { connected.add(e.from); connected.add(e.to) }

  // Los loaders NO se agrupan: siguen la lógica normal, inline al inicio de su
  // pipeline. (Se probó agruparlos arriba creando Set/Get y se revirtió — desastre.)

  // ── Detección de samplers ──────────────────────────────────────────────────
  const isSampler = (n) => {
    const names = (n.inputs || []).map(i => (i.name || "").toLowerCase())
    const has = (x) => names.includes(x)
    if (has("latent_image") && has("model") && (has("positive") || has("negative"))) return true
    if (has("latent_image") && has("guider")) return true   // SamplerCustomAdvanced (Flux)
    return false
  }
  const samplers = new Set(nodes.filter(isSampler).map(n => n.id))
  const isBandInput = (name) => {
    const n = (name || "").toLowerCase()
    // Los sockets que ordenan la altura: todo lo que sea una entrada de datos del
    // sampler. Se excluyen los widgets numéricos (que no son sockets) — pero como
    // sólo miramos node.inputs, aquí ya son todos sockets.
    return true
  }

  // ── Banda por slot del sampler (clave = ruta de slots) ─────────────────────
  // laneKey de un nodo = la ruta de slots más "alta" (lexicográfica) por la que
  // llega al sampler. [0]=primer socket … El guider inyecta un nivel: [guiderSlot,
  // guiderInputSlot], así el model del guider queda por encima del conditioning.
  // Pipeline semántico de un input: model / cond / latent (por nombre y tipo).
  // Lo demás (noise, sampler, sigmas, seed…) es "config" del sampler.
  const pipeOfInput = (input) => {
    const name = (input?.name || "").toLowerCase()
    const type = (input?.type || "").toUpperCase()
    if (name.includes("latent") || type === "LATENT") return "latent"
    if (name === "positive" || name === "negative" || type === "CONDITIONING") return "cond"
    if (name === "model" || type === "MODEL") return "model"
    return "config"
  }

  const seeds = []   // {id, key, bfs, pipe}
  for (const sid of samplers) {
    const s = byId.get(sid)
    for (const [slot, input] of (s.inputs || []).entries()) {
      const feeders = (incoming.get(sid) || []).filter(e => e.toSlot === slot).map(e => e.from)
      if ((input?.name || "").toLowerCase() === "guider") {
        for (const gid of feeders) {
          seeds.push({ id: gid, key: [slot], bfs: false, pipe: "config" })   // el guider va en la columna de config (orden de socket)
          const guider = byId.get(gid)
          for (const [gslot, ginput] of (guider?.inputs || []).entries()) {
            if (!isBandInput(ginput?.name)) continue
            for (const e of (incoming.get(gid) || []).filter(x => x.toSlot === gslot)) {
              seeds.push({ id: e.from, key: [slot, gslot], bfs: true, pipe: pipeOfInput(ginput) })
            }
          }
        }
        continue
      }
      if (!isBandInput(input?.name)) continue
      for (const fid of feeders) seeds.push({ id: fid, key: [slot], bfs: true, pipe: pipeOfInput(input) })
    }
  }
  const lower = (a, b) => {           // ¿a < b lexicográfico?
    const n = Math.min(a.length, b.length)
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] < b[i]
    return a.length < b.length
  }
  const laneKey = new Map()
  const pipesReached = new Map()   // id → Set de pipes semánticos que alimenta su cono
  const addPipe = (id, p) => { let s = pipesReached.get(id); if (!s) { s = new Set(); pipesReached.set(id, s) } s.add(p) }
  const setKey = (id, k) => { const prev = laneKey.get(id); if (!prev || lower(k, prev)) laneKey.set(id, k) }
  for (const { id, key, bfs, pipe: p } of seeds) {
    if (!bfs) { setKey(id, key); addPipe(id, p); continue }
    const queue = [id], seen = new Set()
    while (queue.length) {
      const nid = queue.shift()
      if (seen.has(nid) || samplers.has(nid)) continue   // no cruza otro sampler
      seen.add(nid)
      setKey(nid, key); addPipe(nid, p)
      for (const e of incoming.get(nid) || []) queue.push(e.from)
    }
  }
  // Pipeline final de cada nodo. Un nodo que alimenta al LATENTE y además a model/cond
  // es BACKBONE (un pre-sampler que produce el núcleo) → 'config' (espina, sin offset,
  // plano con el sampler). Un checkpoint (model+clip, sin latente) sí gana model (arriba).
  const pipe = new Map()
  for (const [id, s] of pipesReached) {
    let p = "config"
    if (s.has("latent") && s.size > 1) p = "config"
    else if (s.has("model")) p = "model"
    else if (s.has("cond")) p = "cond"
    else if (s.has("latent")) p = "latent"
    pipe.set(id, p)
  }

  // ── Rank (columna X) ───────────────────────────────────────────────────────
  // Longest-path desde las fuentes y luego TENSADO: cada nodo con salidas se tira
  // a la derecha, justo a la izquierda de su consumidor más temprano
  // (rank = mín(rank de sucesores) − 1). Así los feeders-fuente (RandomNoise,
  // KSamplerSelect, EmptyLatent…) caen pegados al sampler en vez de varados a la
  // izquierda, y un Preview/Save (sink) queda pegado a su productor. Sin tensado,
  // forward-rank strands las fuentes y backward-rank strands los outputs.
  const fwd = new Map()
  const onStack = new Set()
  const fwdOf = (id) => {
    if (fwd.has(id)) return fwd.get(id)
    if (onStack.has(id)) return 0
    onStack.add(id)
    let r = 0
    for (const e of incoming.get(id) || []) r = Math.max(r, fwdOf(e.from) + 1)
    onStack.delete(id)
    fwd.set(id, r)
    return r
  }
  for (const n of nodes) fwdOf(n.id)
  const rank = new Map()
  for (const n of [...nodes].sort((a, b) => fwd.get(b.id) - fwd.get(a.id))) {   // sinks primero
    const outs = outgoing.get(n.id) || []
    rank.set(n.id, outs.length ? Math.min(...outs.map(e => rank.get(e.to))) - 1 : fwd.get(n.id))
  }

  // maxReach: el rank MÁS PROFUNDO alcanzable aguas abajo (hacia qué output lleva
  // esta rama). Un nodo se alineará al sucesor que llega más lejos = la cadena del
  // OUTPUT FINAL, no a un preview lateral. Así el último output dirige y todo se
  // concatena hacia atrás, sin reglas por tipo de nodo.
  const maxReach = new Map()
  const reachStack = new Set()
  const reachOf = (id) => {
    if (maxReach.has(id)) return maxReach.get(id)
    if (reachStack.has(id)) return rank.get(id) ?? 0
    reachStack.add(id)
    let r = rank.get(id) ?? 0
    for (const e of outgoing.get(id) || []) r = Math.max(r, reachOf(e.to))
    reachStack.delete(id)
    maxReach.set(id, r)
    return r
  }
  for (const n of nodes) reachOf(n.id)

  // ── Reparto ────────────────────────────────────────────────────────────────
  const main = nodes.filter(n => connected.has(n.id) && !n.pinned)
  if (!main.length) return { nodeMoves: new Map() }

  const anchorX = Math.min(...main.map(n => n.pos[0]))
  const anchorY = Math.min(...main.map(n => n.pos[1]))
  const mainTop = anchorY
  const nodeMoves = new Map()
  if (!main.length) return { nodeMoves }

  // Sin sampler (fallback): todo el main es un único carril, ordenado por flujo.
  // (Sólo cuando NO hay ningún sampler; con samplers pero sin feeders visibles el
  // grafo se coloca por el eje central, no como feeders.)
  if (samplers.size === 0) for (const n of main) laneKey.set(n.id, [0])

  const rankOf = (n) => rank.get(n.id) ?? 0
  const ranks = [...new Set(main.map(rankOf))].sort((a, b) => a - b)

  // Los Get pills cuelgan a la izquierda de su consumidor. Reservar hueco extra antes
  // de la columna del consumidor para que el pill no se solape con la columna anterior.
  const getPadForCol = new Map()
  for (const n of main) {
    if (!/GetNode/i.test(n.type || "")) continue
    const c = (outgoing.get(n.id) || [])[0]
    if (!c || !byId.has(c.to)) continue
    const cr = rankOf(byId.get(c.to))
    getPadForCol.set(cr, Math.max(getPadForCol.get(cr) || 0, (n.w || 120) + 28))
  }

  const colX = new Map()
  let x = anchorX
  for (const r of ranks) {
    x += getPadForCol.get(r) || 0
    colX.set(r, x)
    x += Math.max(...main.filter(n => rankOf(n) === r).map(n => n.w || 200)) + gapX
  }

  const placedY = new Map()   // CENTRO Y de cada nodo colocado

  // Centro Y que deja RECTO el tramo n→succ: el socket de salida de n (fromSlot) a la
  // altura del socket de entrada de succ (toSlot). Se trabaja con TOP = centro − h/2.
  const alignToSucc = (n, e) => {
    const sc = placedY.get(e.to); if (sc === undefined) return null
    const succ = byId.get(e.to)
    return (sc - (succ.h || 80) / 2 + inOff(succ, e.toSlot)) - outOff(n, e.fromSlot) + (n.h || 80) / 2
  }

  // ── Bandas por OFFSET (no por altura reservada) ────────────────────────────
  // Cada pipeline tira hacia su franja: model arriba, latent abajo, cond/config al
  // centro (con el sampler). Es un sesgo del objetivo, no una banda de altura fija —
  // así un cono profundo (p.ej. la generación de prompt del conditioning) se extiende
  // a la IZQUIERDA en columnas, sin empujar el sampler hacia abajo. Dentro de una
  // columna, orden por pipeline+socket y hueco pipeGap entre pipelines distintos.
  const pipeGap = Math.max(60, clusterGap * 2)
  const bandOffset = Math.max(200, clusterGap * 6)
  const PIPE_ORDER = { model: 0, cond: 1, config: 2, latent: 3 }
  const pipeOf = (n) => pipe.get(n.id) || "config"
  // Sólo el model se separa hacia ARRIBA. El latent NO se empuja abajo: ya queda al
  // final de la columna de feeders por orden de socket, y un offset lo dejaba aislado
  // con un hueco enorme.
  const offsetOf = (n) => (pipeOf(n) === "model" ? -bandOffset : 0)
  const subOrderOf = (n) => { const k = laneKey.get(n.id); return !k ? 99 : (k.length === 1 ? k[0] : k[0] + (k[1] + 1) / 100) }
  const orderOf = (n) => (PIPE_ORDER[pipeOf(n)] ?? 2) * 100 + subOrderOf(n)   // pipeline y luego socket

  const gapBetween = (a, b) => (pipeOf(a) !== pipeOf(b) ? pipeGap : (subOrderOf(a) !== subOrderOf(b) ? clusterGap : gapY))

  // Coloca cada nodo en SU objetivo (socket + offset de pipeline) y sólo lo empuja
  // hacia abajo si solaparía con el anterior (más el hueco correcto). No centra ni
  // reserva altura: cada columna es independiente y un cono profundo no hunde nada.
  const stackColumn = (list, r, targetOf) => {
    // La cadena que llega al output más profundo (mayor maxReach) va primero → se queda
    // con su objetivo alineado; los previews laterales (menor maxReach) ceden y se
    // apilan alrededor. A igual profundidad, orden de banda/socket. Así el output final
    // manda y un preview lateral no desalinea la cadena principal.
    list.sort((a, b) => (maxReach.get(b.id) ?? 0) - (maxReach.get(a.id) ?? 0) || orderOf(a) - orderOf(b) || targetOf(a) - targetOf(b))
    let prev = null
    for (const n of list) {
      let top = targetOf(n) - (n.h || 80) / 2
      if (prev) {
        const floor = placedY.get(prev.id) + (prev.h || 80) / 2 + gapBetween(prev, n)
        if (top < floor) top = floor
      }
      nodeMoves.set(n.id, [colX.get(r), top])
      placedY.set(n.id, top + (n.h || 80) / 2)
      prev = n
    }
  }

  // ── Colocación: barrido de DERECHA a IZQUIERDA desde el último output ───────
  // Se ancla en el SINK (último output): se siembra en su Y original y, columna a
  // columna hacia la izquierda, cada nodo se alinea al SOCKET de sus sucesores ya
  // colocados (cable recto). Varias conexiones → baricentro de esos sockets; orden
  // en la columna por pipeline+socket; solapes → uno debajo de otro. El model se
  // sesga hacia arriba (offsetOf) para leerse como banda separada.
  for (const r of [...ranks].sort((a, b) => b - a)) {   // rank alto (derecha/sink) primero
    const list = main.filter(n => rankOf(n) === r)
    if (!list.length) continue
    const target = (n) => {
      // Alinear al sucesor que lleva al OUTPUT FINAL (mayor maxReach) — así la cadena
      // principal manda y los previews laterales se desvían de ella, no al revés. A
      // igual profundidad, por socket de ENTRADA (toSlot): el orden de inputs del
      // receptor manda (Region Prompter: tile_data arriba), y con varios cables al mismo
      // nodo (presampling→sampler) se alinea por el socket primario → espina recta.
      const outs = (outgoing.get(n.id) || []).slice().sort((a, b) =>
        ((maxReach.get(b.to) ?? 0) - (maxReach.get(a.to) ?? 0)) || (a.toSlot - b.toSlot) || (a.fromSlot - b.fromSlot))
      for (const e of outs) {
        const y = alignToSucc(n, e)
        if (y === null) continue
        // El offset de banda se aplica UNA sola vez: sólo cuando el sucesor es de OTRO
        // pipeline (al entrar en la banda). Dentro de la cadena del mismo pipeline el
        // nodo se alinea a su sucesor (que ya lleva el offset) → si no, se acumularía
        // bandOffset por salto y la cadena escalonaría.
        const off = pipeOf(byId.get(e.to)) === pipeOf(n) ? 0 : offsetOf(n)
        return y + off
      }
      // Sink (sin sucesores): semilla FIJA en 0, no su posición actual. Sembrar en
      // n.pos[1] hacía que cada Shift+A lo moviera un poco → el layout derivaba y los
      // nodos se separaban. Con 0 el resultado es determinista e idempotente.
      return 0 + offsetOf(n)
    }
    stackColumn(list, r, target)
  }

  // Set/Get nodes se anclan pegados a su vecino y alineados a su socket (cable recto),
  // con un poco de aire. Un GET cuelga de su CONSUMIDOR → a la IZQUIERDA de éste. Un
  // SET cuelga de su PRODUCTOR → a la DERECHA de éste (el productor lo alimenta); si
  // no, quedaría a la izquierda del productor, volteando el grupo loader→Set.
  const isSetGetNode = (n) => /SetNode|GetNode/i.test(n.type || "")
  for (const n of main) {
    if (!isSetGetNode(n)) continue
    const out = (outgoing.get(n.id) || [])[0]
    const inc = (incoming.get(n.id) || [])[0]
    const e = out || inc
    if (!e) continue
    const anchor = byId.get(out ? e.to : e.from)
    const ap = anchor && nodeMoves.get(anchor.id)
    if (!ap) continue
    // Y con offsets REALES de socket → cable exactamente recto (colapsados incluidos).
    const y = out
      ? ap[1] + inOff(anchor, e.toSlot) - outOff(n, e.fromSlot)      // Get.out → consumidor.in
      : ap[1] + outOff(anchor, e.fromSlot) - inOff(n, e.toSlot)      // productor.out → Set.in
    const x = out
      ? ap[0] - (n.w || 200) - 16                                    // Get: a la izquierda del consumidor
      : ap[0] + (anchor.w || 200) + 16                               // Set: a la derecha del productor
    nodeMoves.set(n.id, [x, y])
  }

  // 4) Bajar todo el bloque principal por debajo de la zona de loaders.
  const mainYs = main.map(n => nodeMoves.get(n.id)?.[1]).filter(v => v !== undefined)
  const shift = mainTop - Math.min(...mainYs)
  if (shift !== 0) for (const n of main) { const p = nodeMoves.get(n.id); if (p) nodeMoves.set(n.id, [p[0], p[1] + shift]) }

  return { nodeMoves }
}
