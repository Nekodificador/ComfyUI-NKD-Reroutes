// Adaptador del ruteo ortogonal: lo que el motor (./router.js) no puede saber
// porque no conoce ComfyUI — dónde están los nodos, qué cable es cuál y cuándo
// merece la pena recalcular.
//
// El motor es caro (una búsqueda A* por cable), así que esto es sobre todo una
// caché. Tres reglas la gobiernan:
//
//   1. Los obstáculos se leen UNA vez por frame, no una vez por cable.
//   2. Una ruta sólo se recalcula si cambian sus extremos o si se ha movido
//      algún nodo. Lo segundo se detecta con un hash de todos los rectángulos:
//      si no cambia, las rutas guardadas siguen valiendo.
//   3. Con el ratón pulsado se rutea SÓLO lo que se ha movido. Rutearlo todo en
//      cada frame congela el canvas, pero al arrastrar un nodo únicamente
//      cambian de sitio sus cables: al resto se le sirve lo guardado. Así la
//      vista previa ES el resultado, en vez de un parecido que se despega.

import { nudgePass } from "./nudge.js"
import { offsetStrand, route } from "./router.js"

const STUB = 24         // rabito recto obligatorio al salir de un socket
// Separación entre carriles del mismo lado de un nodo. Apretado a propósito: el
// rabito del carril más hondo es obligatorio para TODOS los cables de ese lado,
// así que con un paso grande un nodo de muchas entradas fuerza rabitos tan
// largos que el cable acaba dando la vuelta.
const STUB_PITCH = 5
const CLEARANCE = 16    // cuánto se infla cada nodo; los carriles son sus bordes
const CACHE_MAX = 4096
// Búsquedas nuevas por frame mientras se arrastra. Los cables que se mueven al
// arrastrar un nodo son los suyos —un puñado—, así que el tope no se toca en
// uso normal; está para que un nodo con decenas de cables no pare el canvas.
const SEARCH_BUDGET = 24

const cache = new Map()
let obstacles = []
let version = 0         // sube cada vez que cambia la disposición de los nodos
let lastHash = ""
let searchesThisFrame = 0

// Cuánto cuesta atravesar un nodo, en veces lo que cuesta el aire libre. Es el
// mando de "esquivar o no": en 1 atravesar sale igual de barato que rodear y el
// cable va recto por debajo de todo; alto, lo rodea siempre. Contra el recargo
// por codo (24 dentro del motor) sale la decisión de cuánto rodeo merece la
// pena, que es lo que de verdad se está eligiendo.
let avoidance = 8

// Si el reparto de pasillos está encendido. Apagarlo es una preferencia
// legítima: en grafos ordenados a mano, un cable que se aparta 8 px de donde lo
// dejaste molesta más de lo que ayuda.
let spreadOn = true

// Extremos REALES de cada cable, apuntados según se dibujan.
//
// La alternativa es `getConnectionPos`, y miente: en los nodos altos de
// Nodes 2.0 devuelve la posición POR DEFECTO del socket, que puede caer una
// fila entera lejos de donde está pintado. Eso envenena a quien pregunta por un
// cable que no es el que se está dibujando —los carriles, que miran a los
// vecinos, y la plantilla de la cinta— y salen carriles en el orden equivocado
// y plantillas con la forma equivocada.
//
// Nosotros vemos los extremos buenos: el renderizador nos los pasa en cada
// frame. Guardarlos es todo lo que hace falta. Se corrige solo — el primer
// frame usa lo que haya y a partir del segundo son exactos.
const pins = new Map()  // id del cable -> { a, b }

// Una vez por frame, antes de que se dibuje ningún cable.
export function beginFrame(graph, cfg = {}) {
  const esquivar = cfg.avoidance ?? avoidance
  const separar  = cfg.spread ?? spreadOn
  searchesThisFrame = 0
  // Cambiar cualquiera de los dos mandos cambia TODAS las rutas, así que
  // invalida igual que si se hubieran movido los nodos. El reparto además se
  // olvida de lo que había movido: si no, al apagarlo los cables se quedarían
  // desplazados para siempre.
  if (esquivar !== avoidance || separar !== spreadOn) {
    avoidance = esquivar
    if (separar !== spreadOn) { spreadOn = separar; nudgeMemo.clear() }
    version++
  }
  if (!graph?._nodes) return
  let hash = ""
  const rects = []
  for (const node of graph._nodes) {
    // boundingRect incluye el título y lo que el nodo tenga por fuera; pos/size
    // es el plan B para nodos que no lo expongan.
    const r = node.boundingRect ??
      (node.pos && node.size ? [node.pos[0], node.pos[1], node.size[0], node.size[1]] : null)
    // Un solo nodo raro no puede tumbar el snapshot: sin él se rutea igual, y
    // reventando aquí se queda sin rutear TODO el frame.
    if (!r) continue
    rects.push([r[0], r[1], r[2], r[3]])
    // Redondeado a entero: un nodo no se mueve medio píxel por su cuenta, y sin
    // redondear cualquier temblor del layout invalidaría todas las rutas.
    hash += `${r[0] | 0},${r[1] | 0},${r[2] | 0},${r[3] | 0};`
  }
  if (hash !== lastHash) {
    lastHash = hash
    obstacles = rects
    version++
    if (cache.size > CACHE_MAX) { cache.clear(); pins.clear() }
  }
  if (spreadOn) separarPasillos()
}

// Reparto de los pasillos compartidos, una vez por frame y sólo cuando hay algo
// nuevo que repartir.
//
// Va aquí y no al calcular cada ruta porque es una decisión de CONJUNTO: para
// saber si dos tramos se pisan hay que tenerlos todos delante, y las rutas se
// calculan de una en una según se dibujan. De ahí que se asiente en un frame —
// se reparte lo que se dibujó en el anterior—, que es justo lo que no se nota.
// Lo que el reparto le movió a cada cable, por si hay que reutilizarlo.
//
// Al arrastrar un nodo sube la versión en cada frame y sus cables se recalculan
// DESPUÉS de que el reparto haya pasado, así que nunca les alcanza: durante el
// arrastre se juntaban otra vez en la misma columna y sólo se separaban al
// soltar. El reparto no puede correr por cable —necesita verlos todos— pero su
// resultado sí se puede reutilizar: mientras arrastras, la forma del cable
// apenas cambia y la separación que se le calculó sigue valiendo. Al soltar,
// la pasada de verdad la recalcula.
const nudgeMemo = new Map()  // id del cable -> desplazamientos por vértice

// Reaplica a una ruta recién calculada la separación que tenía la anterior.
// Sólo si la forma coincide: distinto número de vértices es otra ruta, y
// mover sus puntos a ciegas la rompería. Los extremos no se tocan nunca —
// tienen que acabar en el socket.
function reusarSeparacion(id, pts) {
  const memo = nudgeMemo.get(id)
  if (!memo || memo.length !== pts.length) return pts
  const out = pts.map(p => [p[0], p[1]])
  for (let i = 1; i < out.length - 1; i++) {
    out[i][0] += memo[i][0]
    out[i][1] += memo[i][1]
  }
  return out
}

let lastNudge = ""
function separarPasillos() {
  const vivas = []
  let sello = "v" + version
  for (const e of cache.values()) {
    if (e.version !== version || !e.raw) continue
    vivas.push(e)
    sello += "|" + e.key
  }
  if (sello === lastNudge) return
  lastNudge = sello
  try {
    nudgePass(vivas, obstacles)
    // Apuntar lo que ha movido, para poder reutilizarlo mientras se arrastra.
    for (const e of vivas) {
      const id = e.key.split("|")[0]
      nudgeMemo.set(id, e.pts.map((p, i) => [p[0] - e.raw[i][0], p[1] - e.raw[i][1]]))
    }
  } catch (err) {
    console.warn("[NKD Reroutes] el reparto de pasillos falló", err)
  }
}

// Reparto de carriles en un lado de un nodo.
//
// Sin esto, los cables de un mismo lado salen todos a los mismos 24 px y giran
// en la misma columna: se pisan y parecen uno solo. La regla —del original— es
// que los que SUBEN anidan pegados al nodo, el más alto primero, y los que
// BAJAN empiezan un carril más allá del último que sube, el más bajo primero.
// Sale de la geometría, sin iterar y sin estado: dos cables cualesquiera del
// mismo lado sacan siempre carriles distintos.
//
// Devuelve la longitud del rabito de ESTE socket. Como el carril depende de los
// cables VECINOS, entra en la clave de la caché: conectar o soltar un cable de
// al lado cambia este sin que se haya movido nada.
export function laneStub(graph, node, isInput, slot) {
  const slots = node ? (isInput ? node.inputs : node.outputs) : null
  if (!slots || !node.getConnectionPos) return STUB

  const list = []
  for (let j = 0; j < slots.length; j++) {
    // Una salida con varios cables es UN pin y UN carril: se abren en la punta
    // del rabito, no en el nodo.
    const linkId = isInput ? slots[j].link : slots[j].links?.[0]
    if (linkId == null) continue
    const ll = graph._links?.get?.(Number(linkId))
    if (!ll) continue
    // Alturas vistas al dibujar si las hay; si no, lo que diga el nodo.
    const visto = pins.get(ll.id)
    let y, oy
    if (visto) {
      y  = isInput ? visto.b[1] : visto.a[1]
      oy = isInput ? visto.a[1] : visto.b[1]
    } else {
      const other = graph.getNodeById?.(isInput ? ll.origin_id : ll.target_id)
      if (!other?.getConnectionPos) continue
      y  = node.getConnectionPos(isInput, j)?.[1]
      oy = other.getConnectionPos(!isInput, isInput ? ll.origin_slot : ll.target_slot)?.[1]
    }
    if (y == null || oy == null) continue
    list.push({ j, y, up: oy <= y })
  }

  const suben = list.filter(s => s.up).sort((a, b) => a.y - b.y)
  const bajan = list.filter(s => !s.up).sort((a, b) => b.y - a.y)
  let carril = suben.findIndex(s => s.j === slot)
  if (carril < 0) {
    const d = bajan.findIndex(s => s.j === slot)
    if (d < 0) return STUB
    carril = suben.length + d
  }
  return STUB + carril * STUB_PITCH
}

// Aparta un rabito hasta que su columna quede despejada en el tramo de altura
// que el cable tiene que recorrer.
//
// Por qué hace falta: el cable baja por la columna de la punta del rabito. Si
// esa columna atraviesa otro nodo, acercarse al destino deja de valer un codo y
// pasa a valer dos —bajar antes, entrar después—, y el recargo por codo (24) se
// come de largo el desempate que prefiere bajar cerca del destino (0,25). El
// resultado es que el trazado VUELCA entero y el codo se planta al principio en
// cuanto un nodo se cruza en la columna de llegada.
//
// La respuesta no es tocar los precios sino quitar el motivo: se retrocede la
// punta hasta el borde del nodo que estorba, que es un carril libre, y desde
// ahí bajar vuelve a costar un codo. Es lo que uno haría a mano.
//
// `dir` es hacia dónde sale el rabito (-1 llegada, +1 salida) y `limite` es la
// x del otro extremo: apartarse más allá sería cruzar el cable sobre sí mismo,
// y entonces se deja como estaba y que el ruteo se apañe.
function clearStub(x, dir, yA, yB, limite) {
  const y0 = Math.min(yA, yB), y1 = Math.max(yA, yB)
  // Varias pasadas porque apartarse de un nodo puede meterte en el siguiente;
  // pocas, porque esto corre por cable y por frame.
  for (let pasada = 0; pasada < 4; pasada++) {
    let destino = null
    for (const [rx, ry, rw, rh] of obstacles) {
      const bx0 = rx - CLEARANCE, bx1 = rx + rw + CLEARANCE
      const by0 = ry - CLEARANCE, by1 = ry + rh + CLEARANCE
      if (x <= bx0 || x >= bx1) continue        // el borde exacto es carril libre
      if (y1 <= by0 || y0 >= by1) continue      // no se cruzan en altura
      const salida = dir < 0 ? bx0 : bx1        // apartarse en el sentido del rabito
      if (destino === null || (dir < 0 ? salida < destino : salida > destino)) destino = salida
    }
    if (destino === null) return x
    if (dir < 0 ? destino <= limite : destino >= limite) return x
    x = destino
  }
  return x
}

// Trazado ortogonal de emergencia: rabito, medio camino, salto, rabito. Sin
// búsqueda y sin mirar los obstáculos, así que cuesta nada.
//
// Existe porque el ruteo dice "no" en dos situaciones —el caso trivial y la
// búsqueda que se rinde— y dejar pasar la Bézier ahí significaba ver los dos
// motores a la vez en la misma pantalla. En su carril el PCB es sustituto
// completo: si no hay ruta buena, hay ruta tonta, pero ortogonal. También cubre
// el tope de búsquedas por frame al arrastrar.
function fallback(a, b, startDir, endDir, stubStart = STUB, stubEnd = STUB) {
  const sx = a[0] + (startDir === "left" ? -stubStart : stubStart)
  const ex = b[0] + (endDir   === "left" ? -stubEnd   : stubEnd)
  // El salto vertical va en la columna del rabito de LLEGADA, no por el punto
  // medio. No es estética: es la forma que saca el A* cuando no hay nada en
  // medio —su desempate cobra un pelo menos por bajar cerca del destino—, y
  // este trazado es lo que se ve mientras arrastras. Con el salto en el medio,
  // el cable cambiaba de forma al soltar y la vista previa no valía para nada.
  return simplify([[a[0], a[1]], [sx, a[1]], [ex, a[1]], [ex, b[1]], [b[0], b[1]]])
}

// Quita los puntos repetidos y los que no doblan nada. Sin esto, un cable a la
// misma altura mete tres vértices encima de la misma recta y el marcador
// central —que busca el tramo recto más largo— se cree que hay tres tramos.
function simplify(pts) {
  const out = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i], q = out[out.length - 1]
    if (Math.abs(p[0] - q[0]) < 0.01 && Math.abs(p[1] - q[1]) < 0.01) continue
    if (out.length >= 2) {
      const r = out[out.length - 2]
      const rectoX = Math.abs(r[0] - q[0]) < 0.01 && Math.abs(q[0] - p[0]) < 0.01
      const rectoY = Math.abs(r[1] - q[1]) < 0.01 && Math.abs(q[1] - p[1]) < 0.01
      if (rectoX || rectoY) out.pop()
    }
    out.push(p)
  }
  return out
}

// Devuelve siempre los vértices de un trazado ortogonal: el ruteado si se ha
// podido calcular, y si no el de emergencia.
export function routeFor(id, a, b, opts = {}) {
  const {
    pointerDown = false, startIsReroute = false, endIsReroute = false,
    graph = null, link = null,
  } = opts

  // Apuntar los extremos buenos, antes que nada. Sólo de los tramos nodo→nodo:
  // en una cadena con reroutes, todos los tramos comparten el id del cable y el
  // último en dibujarse dejaría apuntada la posición de un reroute como si
  // fuera la del socket.
  if (link && !startIsReroute && !endIsReroute) {
    pins.set(link.id, { a: [a[0], a[1]], b: [b[0], b[1]] })
  }

  // Un reroute no tiene cara: el cable lo cruza. Se le da la dirección del
  // propio tramo para que entre y salga por donde va, en vez de forzarle la
  // convención de socket y hacerle dar la vuelta al punto.
  const startDir = startIsReroute ? (b[0] >= a[0] ? "right" : "left")  : "right"
  const endDir   = endIsReroute   ? (b[0] >= a[0] ? "left"  : "right") : "left"

  // Los carriles son de los lados de NODO. Un extremo en reroute se lleva el
  // rabito de siempre: los sockets que guarda el cable son los de la CADENA
  // entera, no los de este tramo, así que allí no significan nada.
  let stubStart = STUB, stubEnd = STUB
  if (graph && link) {
    if (!startIsReroute) stubStart = laneStub(graph, graph.getNodeById?.(link.origin_id), false, link.origin_slot)
    if (!endIsReroute)   stubEnd   = laneStub(graph, graph.getNodeById?.(link.target_id), true,  link.target_slot)
  }

  // Apartar los rabitos de las columnas ocupadas. Va después de los carriles
  // —el carril decide el orden entre hermanos, esto decide si esa columna es
  // viable— y antes de la clave, porque cambia la geometría de la ruta.
  if (endDir === "left" || endDir === "right") {
    const dir = endDir === "left" ? -1 : 1
    const punta = clearStub(b[0] + dir * stubEnd, dir, a[1], b[1], a[0])
    stubEnd = Math.abs(punta - b[0])
  }
  {
    const dir = startDir === "left" ? -1 : 1
    const punta = clearStub(a[0] + dir * stubStart, dir, a[1], b[1], b[0])
    stubStart = Math.abs(punta - a[0])
  }

  const key = `${id}|${a[0] | 0},${a[1] | 0}|${b[0] | 0},${b[1] | 0}|${startDir}>${endDir}|${stubStart},${stubEnd}`
  const hit = cache.get(key)
  if (hit && hit.version === version) return hit.pts

  // Mitad de un arrastre.
  //
  // Rutear TODOS los cables en cada frame congela el canvas, pero no hace
  // falta: al mover un nodo sólo cambian de sitio SUS cables. A los demás no
  // les ha pasado nada —sus extremos son los mismos, y por tanto su clave—, así
  // que se les sirve lo que ya tenían aunque sea de una versión anterior.
  //
  // Los que sí se han movido son los que el usuario está mirando, y esos se
  // rutean de verdad. Antes aquí había un trazado de emergencia que intentaba
  // parecerse al ruteo: no miraba obstáculos ni formaba cintas, así que la
  // vista previa enseñaba una cosa y al soltar aparecía otra. Perseguir el
  // parecido es perseguirse la cola; la preview tiene que SER el resultado.
  if (pointerDown) {
    const viejo = cache.get(key)
    if (viejo) return viejo.pts
    // Tope de seguridad: arrastrar un nodo con muchísimos cables no puede
    // convertirse en cien búsquedas por frame. Pasado el tope, apaño barato —
    // feo un instante, pero el canvas responde.
    if (++searchesThisFrame > SEARCH_BUDGET) {
      return fallback(a, b, startDir, endDir, stubStart, stubEnd)
    }
  }

  let pts = null
  let origen = "busqueda"

  // Cinta primero: si este cable tiene hermanos al mismo nodo, copia su forma
  // en vez de buscarse la vida. Sólo en tramos nodo→nodo — con un reroute por
  // medio, los sockets que guarda el cable son los de la cadena, no los de
  // este tramo, y el par al que pertenece no significa nada.
  if (graph && link && !startIsReroute && !endIsReroute) {
    try {
      pts = strand(graph, link, a, b)
      if (pts) origen = "cinta"
    } catch (err) {
      console.warn("[NKD Reroutes] la cinta falló para el cable", id, err)
    }
  }

  try {
    if (!pts) pts = route({
      start: [a[0], a[1]],
      end:   [b[0], b[1]],
      startDir, endDir,
      obstacles,
      clearance: CLEARANCE,
      blockedMult: avoidance,
      stubStart,
      stubEnd,
    })
  } catch (err) {
    // Una excepción escapando de aquí sube hasta el bucle de dibujado de
    // ComfyUI y deja el canvas muerto el resto de la sesión. Un cable feo es
    // un mal día; un canvas congelado es un informe de fallo.
    console.warn("[NKD Reroutes] el ruteo falló para el cable", id, err)
  }

  // route() devuelve null en el caso trivial —hay corredor recto y despejado—
  // y cuando la búsqueda se rinde. En los dos, el trazado de emergencia da la
  // misma recta que daría el ruteo, sin haberla buscado.
  if (!pts) {
    pts = fallback(a, b, startDir, endDir, stubStart, stubEnd)
    origen = "emergencia"
  }

  // `raw` es la ruta tal cual sale del cálculo; `pts` es lo que se dibuja, con
  // la separación reutilizada encima. Tienen que ir separadas: la pasada de
  // reparto rehace pts desde raw, y si raw ya viniera desplazada iría sumando
  // desplazamiento sobre desplazamiento en cada frame.
  const dibujo = reusarSeparacion(String(id), pts)
  cache.set(key, { key, raw: pts, pts: dibujo, version, origen, stubStart, stubEnd, a, b })
  return dibujo
}

// ── Cintas ──────────────────────────────────────────────────────────────────
//
// Varios cables entre el MISMO par de nodos tienen que viajar juntos. Ruteados
// por separado no lo hacen: entre dos nodos las dos formas de la L cuestan casi
// lo mismo, y cada hermano se queda con una — se ven caminos completamente
// distintos para cables que van al mismo sitio, y se cruzan sin motivo.
//
// La solución no es afinar el desempate, es quitar la elección: uno de los
// cables es la PLANTILLA y los demás son esa misma forma desplazada en
// paralelo. Dos trazados idénticos desplazados no pueden cruzarse.
const LANE = 8

// Todos los cables que van del mismo nodo al mismo nodo, en un orden que no
// depende de quién se dibuje primero.
function bundle(graph, link) {
  const out = []
  for (const ll of graph._links?.values?.() ?? []) {
    if (ll.origin_id === link.origin_id && ll.target_id === link.target_id) out.push(ll)
  }
  out.sort((a, b) => a.origin_slot - b.origin_slot || a.target_slot - b.target_slot || a.id - b.id)
  return out
}

// Los extremos de OTRO cable: los que se le vieron al dibujarlo, y si aún no se
// ha dibujado, lo que digan sus nodos.
function endsOf(graph, ll) {
  const visto = pins.get(ll.id)
  if (visto) return visto
  const a = graph.getNodeById?.(ll.origin_id)?.getConnectionPos?.(false, ll.origin_slot)
  const b = graph.getNodeById?.(ll.target_id)?.getConnectionPos?.(true, ll.target_slot)
  return a && b ? { a: [a[0], a[1]], b: [b[0], b[1]] } : null
}

// La ruta cruda de un cable, sin caché y sin cinta. Se usa para la PLANTILLA:
// pasar por routeFor volvería a entrar en la cinta y se mordería la cola.
function rawRoute(graph, ll) {
  const e = endsOf(graph, ll)
  if (!e) return null
  const origen  = graph.getNodeById?.(ll.origin_id)
  const destino = graph.getNodeById?.(ll.target_id)
  // Los rabitos se apartan igual que en el ruteo normal. Si la plantilla se
  // calculara con reglas distintas, la cinta entera saldría con una forma que
  // ningún cable habría elegido por su cuenta.
  const s = clearStub(e.a[0] + laneStub(graph, origen,  false, ll.origin_slot),  1, e.a[1], e.b[1], e.b[0])
  const t = clearStub(e.b[0] - laneStub(graph, destino, true,  ll.target_slot), -1, e.a[1], e.b[1], e.a[0])
  return route({
    start: e.a, end: e.b, startDir: "right", endDir: "left",
    obstacles, clearance: CLEARANCE, blockedMult: avoidance,
    stubStart: Math.abs(s - e.a[0]),
    stubEnd:   Math.abs(t - e.b[0]),
  })
}

// Este cable como hebra de su cinta, o null si no hay cinta que valga —va solo,
// o la plantilla no sirve de patrón— y entonces se rutea normal.
function strand(graph, link, a, b) {
  const hermanos = bundle(graph, link)
  if (hermanos.length < 2) return null

  const miembros = []
  for (const ll of hermanos) {
    const e = endsOf(graph, ll)
    if (e) miembros.push({ ll, a: e.a })
  }
  if (miembros.length < 2) return null

  // La plantilla es la hermana de en medio por altura de salida: así la cinta
  // se abre hacia los dos lados en vez de crecer toda hacia uno.
  miembros.sort((m, n) => m.a[1] - n.a[1] || m.a[0] - n.a[0])
  const tpl = rawRoute(graph, miembros[(miembros.length - 1) >> 1].ll)
  // offsetStrand se planta si la plantilla no tiene cuerpo que desplazar (un
  // cable recto son dos puntos) o si sus tramos no alternan bien.
  if (!tpl || tpl.length < 4) return null

  // Hacia qué lado se abre la cinta. ESTO es lo que faltaba: desplazar por un
  // múltiplo fijo ordena las hebras pero no dice de qué lado, y con el signo al
  // revés la cinta se monta invertida respecto de los carriles — las hebras se
  // cruzan y cambian de sitio en cuanto algo se recalcula.
  //
  // El primer tramo del cuerpo marca el sentido de la marcha; su normal
  // izquierda, el eje del desplazamiento. Comparando de qué lado de ese tramo
  // quedan los sockets se sabe si la normal apunta hacia ellos o en contra.
  const d = [Math.sign(tpl[2][0] - tpl[1][0]), Math.sign(tpl[2][1] - tpl[1][1])]
  const normal = [d[1], -d[0]]
  const vertical = d[0] === 0
  const ladoPines = Math.sign(vertical ? miembros[0].a[0] - tpl[1][0]
                                       : miembros[0].a[1] - tpl[1][1])
  const signo = ladoPines === Math.sign(vertical ? normal[0] : normal[1]) ? 1 : -1

  // Orden a lo largo de la marcha: la hebra más adelantada toma el carril del
  // lado de los sockets. El centro es fraccionario a propósito —con dos hebras
  // salen ±½ carril—, así la cinta queda centrada en la plantilla.
  // El desempate es por altura de salida, no por id: cuando el primer tramo va
  // en horizontal, todas las salidas del mismo nodo proyectan igual, y con el
  // id decidiendo, el orden de las hebras no tiene nada que ver con el de los
  // sockets.
  const orden = miembros
    .map(m => ({ id: m.ll.id, y: m.a[1], proy: m.a[0] * d[0] + m.a[1] * d[1] }))
    .sort((x, y) => y.proy - x.proy || x.y - y.y || x.id - y.id)
  const centro = (orden.length - 1) / 2
  const rango = orden.findIndex(o => o.id === link.id)
  if (rango < 0) return null

  return offsetStrand(tpl, a, b, (centro - rango) * LANE * signo)
}

// Radio que de verdad cabe en una esquina. Un radio fijo se come los tramos
// cortos: si vale más que la mitad de un lado, la curva de esta esquina invade
// la de la siguiente y el trazo se retuerce. La mitad es el límite exacto en el
// que dos esquinas consecutivas se tocan sin solaparse.
export function fitRadius(prev, corner, next, radius) {
  if (radius <= 0) return 0
  const antes   = Math.abs(corner[0] - prev[0]) + Math.abs(corner[1] - prev[1])
  const despues = Math.abs(next[0] - corner[0]) + Math.abs(next[1] - corner[1])
  return Math.min(radius, antes / 2, despues / 2)
}

// Vuelca una ruta en un trazo ya empezado. Vale igual para un ctx y para un
// Path2D: los dos entienden moveTo/lineTo/arcTo.
//
// arcTo redondea la esquina EN el vértice, así que los vértices intermedios no
// se dibujan con lineTo: se pasan como el punto de esquina y la curva sale
// sola. Con radio 0 arcTo se comporta como un lineTo, así que no hace falta
// una rama aparte para las esquinas vivas.
export function emitRoute(path, pts, radius = 0) {
  path.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length - 1; i++) {
    const r = fitRadius(pts[i - 1], pts[i], pts[i + 1], radius)
    path.arcTo(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], r)
  }
  const last = pts[pts.length - 1]
  path.lineTo(last[0], last[1])
}

export function routeStats() {
  return { cached: cache.size, obstacles: obstacles.length, version }
}

// ── Chivato ─────────────────────────────────────────────────────────────────
// Para mirar en la consola del navegador por qué un cable ha salido como ha
// salido. No lo usa nada del dibujado.
export function routeDump() {
  const filas = []
  for (const [clave, e] of cache) {
    if (e.version !== version) continue
    filas.push({
      cable: clave.split("|")[0],
      de: e.a && `${e.a[0] | 0},${e.a[1] | 0}`,
      a: e.b && `${e.b[0] | 0},${e.b[1] | 0}`,
      rabitos: `${e.stubStart}/${e.stubEnd}`,
      origen: e.origen,
      codo: e.pts?.[1] && `${e.pts[1][0] | 0},${e.pts[1][1] | 0}`,
      vertices: e.pts?.length,
      ruta: JSON.stringify(e.pts),
    })
  }
  return filas
}

if (typeof window !== "undefined") {
  window.__nkdPcb = {
    dump:      routeDump,
    tabla:     () => console.table(routeDump().map(({ ruta, ...r }) => r)),
    stats:     routeStats,
    obstaculos: () => obstacles,
  }
}
