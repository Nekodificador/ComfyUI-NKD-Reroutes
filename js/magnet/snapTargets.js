// Construcción del índice de candidatos de imantación.
// Se ejecuta UNA VEZ al empezar el arrastre: los vecinos no se mueven mientras
// arrastras, así que recalcularlos por frame sería trabajo tirado.

// Un reroute es un punto de una conexión, no un nodo: no tiene `size` ni
// `computeSize`, y su posición se escribe con `pos = [x, y]` porque tampoco
// tiene `setPos`.
export function isReroute(item) {
  return !!item && item.linkIds !== undefined && item.size === undefined
}

// Un grupo tampoco es un nodo: no tiene sockets ni barra de título aparte —su
// rectángulo YA incluye la banda del título— y se mueve con move(), no setPos().
export function isGroup(item) {
  return !!item && typeof item.recomputeInsideNodes === "function"
}

// Rectángulo del nodo en coordenadas de grafo, barra de título incluida.
// Derivado de pos/size en vez de getBounding() porque boundingRect sólo se
// refresca al dibujar y durante el arrastre puede ir un frame por detrás.
export function rectOf(node) {
  // Un reroute se trata como rectángulo de tamaño cero: así `ref:"min"` apunta
  // al punto en sí y las alineaciones caen justo sobre el centro del dot.
  if (isReroute(node)) return { x: node.pos[0], y: node.pos[1], w: 0, h: 0 }

  // El bounding de un grupo ya lleva dentro su banda de título: restarle
  // NODE_TITLE_HEIGHT como a un nodo lo dejaría desplazado hacia arriba.
  if (isGroup(node)) return { x: node.pos[0], y: node.pos[1], w: node.size[0], h: node.size[1] }

  const th = LiteGraph.NODE_TITLE_HEIGHT
  const x = node.pos[0]
  const y = node.pos[1] - th
  if (node.flags?.collapsed) {
    const w = node._collapsed_width || LiteGraph.NODE_COLLAPSED_WIDTH
    return { x, y, w, h: th }
  }
  return { x, y, w: node.size[0], h: node.size[1] + th }
}

/**
 * Rectángulo que envuelve a todos los de la lista.
 * Lo usa dragAdapter para tratar una selección múltiple como un solo bloque.
 * @param {Array<{x,y,w,h}>} rects
 * @returns {{x,y,w,h}|null} null si la lista viene vacía
 */
export function unionRect(rects) {
  if (!rects.length) return null
  let x0 =  Infinity, y0 =  Infinity
  let x1 = -Infinity, y1 = -Infinity
  for (const r of rects) {
    if (r.x < x0) x0 = r.x
    if (r.y < y0) y0 = r.y
    if (r.x + r.w > x1) x1 = r.x + r.w
    if (r.y + r.h > y1) y1 = r.y + r.h
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

// Fábrica de candidatos: rellena todos los campos que lee computeSnap y deja
// sobrescribir los que importen. Así ningún candidato sale con huecos, que
// serían un fallo silencioso —el motor leería undefined y no petaría—.
const mk = (over) => ({
  ref: "min", offset: 0, value: 0, kind: "edge",
  column: false, sourceWidth: null, guide: null, ...over,
})

// Longitud del segmento de guía a cada lado de la referencia, en px de grafo.
const GUIDE_REACH = 1200

function edgeTargets(nRect, neighbourIsCollapsed, opts, out) {
  const { gapX, gapY } = opts
  const nx1 = nRect.x + nRect.w
  const ny1 = nRect.y + nRect.h

  // Eje X — regla 1: misma columna, izquierda con izquierda.
  // Es el único candidato marcado como column, y el que dispara la regla 5.
  out.x.push(mk({
    ref: "min", value: nRect.x, column: true,
    sourceWidth: neighbourIsCollapsed ? null : nRect.w,
    guide: { x1: nRect.x, y1: nRect.y - GUIDE_REACH, x2: nRect.x, y2: ny1 + GUIDE_REACH },
  }))

  // Eje X — regla 2: adosado a derecha o izquierda del vecino, con hueco fijo.
  out.x.push(mk({ ref: "min", value: nx1 + gapX }))
  out.x.push(mk({ ref: "max", value: nRect.x - gapX }))

  // Eje Y — regla 2: misma fila, borde superior con borde superior.
  out.y.push(mk({
    ref: "min", value: nRect.y,
    guide: { x1: nRect.x - GUIDE_REACH, y1: nRect.y, x2: nx1 + GUIDE_REACH, y2: nRect.y },
  }))

  // Eje Y — regla 1: apilado debajo o encima, con hueco fijo.
  out.y.push(mk({ ref: "min", value: ny1 + gapY }))
  out.y.push(mk({ ref: "max", value: nRect.y - gapY }))
}

// Vecino real de un socket dentro del cable.
//
// Un enlace va: socket de origen -> [cadena de reroutes] -> socket destino. Si
// hay reroutes por medio, el vecino de un socket NO es el socket del otro nodo
// sino el reroute contiguo — que es adonde apunta el cable de verdad. Alinearse
// con el nodo lejano no endereza nada.
//
// `link.parentId` apunta al ULTIMO reroute del enlace, y getReroutes() devuelve
// la cadena ordenada desde la raiz, así que chain[0] es el primero (junto al
// origen) y chain.at(-1) el último (junto al destino).
function wireNeighbour(graph, link, side, draggedItems) {
  const chain = graph.reroutes?.get?.(link.parentId)?.getReroutes?.() ?? []
  const reroute = side === "input" ? chain.at(-1) : chain[0]

  if (reroute) {
    return draggedItems.has(reroute) ? null : [reroute.pos[0], reroute.pos[1]]
  }
  const node = side === "input"
    ? graph.getNodeById?.(link.origin_id)
    : graph.getNodeById?.(link.target_id)
  if (!node || draggedItems.has(node)) return null
  return side === "input"
    ? node.getConnectionPos(false, link.origin_slot, [0, 0])
    : node.getConnectionPos(true, link.target_slot, [0, 0])
}

// Regla 3: cuadrar cada socket del nodo arrastrado con su vecino en el cable,
// sea otro nodo o un reroute, para que ese tramo salga recto.
function socketTargets(graph, draggedNodes, draggedItems, dragRect, out) {
  const links = graph.links
  // graph.links es un Map en el frontend actual, pero fue un objeto plano en
  // versiones anteriores. El acceso por índice es el plan B para instalaciones viejas.
  const getLink = (id) => (links?.get ? links.get(id) : links?.[id])

  const emit = (ownY, anchor) => {
    out.y.push(mk({
      ref: "socket",
      offset: ownY - dragRect.y,   // el socket viaja con el rect
      value: anchor[1],
      kind: "socket",
      guide: { x1: anchor[0] - GUIDE_REACH, y1: anchor[1], x2: anchor[0] + GUIDE_REACH, y2: anchor[1] },
    }))
  }

  for (const node of draggedNodes) {
    for (const [slot, input] of (node.inputs || []).entries()) {
      const link = input?.link != null ? getLink(input.link) : null
      if (!link) continue
      const anchor = wireNeighbour(graph, link, "input", draggedItems)
      if (anchor) emit(node.getConnectionPos(true, slot, [0, 0])[1], anchor)
    }

    for (const [slot, output] of (node.outputs || []).entries()) {
      for (const id of output?.links || []) {
        const link = getLink(id)
        if (!link) continue
        const anchor = wireNeighbour(graph, link, "output", draggedItems)
        if (anchor) emit(node.getConnectionPos(false, slot, [0, 0])[1], anchor)
      }
    }
  }
}

// Regla 4: dos vecinos apilados en la misma columna con sitio suficiente
// entre ellos ofrecen un destino centrado en el hueco.
function gapTargets(columns, dragRect, out) {
  for (const rects of columns.values()) {
    rects.sort((a, b) => a.y - b.y)
    for (let i = 0; i < rects.length - 1; i++) {
      const top = rects[i], bottom = rects[i + 1]
      const gap = bottom.y - (top.y + top.h)
      if (gap < dragRect.h) continue          // no cabe: degrada a regla 1
      out.y.push(mk({
        ref: "min",
        value: top.y + top.h + (gap - dragRect.h) / 2,
        kind: "gap",
        guide: { x1: top.x - GUIDE_REACH, y1: top.y + top.h + gap / 2,
                 x2: top.x + GUIDE_REACH, y2: top.y + top.h + gap / 2 },
      }))
    }
  }
}

// Los dos extremos del cable a los que toca un reroute: el punto de aguas
// arriba (el reroute padre, o el socket de salida si es el primero de la
// cadena) y, por cada enlace que lo cruza, el punto de aguas abajo (el
// siguiente reroute, o el socket de entrada si es el último).
function rerouteAnchors(graph, reroute) {
  const pts = []
  const links = graph.links
  const getLink = (id) => (links?.get ? links.get(id) : links?.[id])

  const parent = reroute.parent
  if (parent) {
    pts.push([parent.pos[0], parent.pos[1]])
  } else {
    const link = reroute.firstLink
    const src = link && graph.getNodeById?.(link.origin_id)
    if (src) pts.push(src.getConnectionPos(false, link.origin_slot, [0, 0]))
  }

  for (const id of reroute.linkIds ?? []) {
    const link = getLink(id)
    if (!link) continue
    const chain = graph.reroutes?.get?.(link.parentId)?.getReroutes?.() ?? []
    const i = chain.findIndex(r => r?.id === reroute.id)
    const next = i >= 0 ? chain[i + 1] : undefined
    if (next) {
      pts.push([next.pos[0], next.pos[1]])
    } else {
      const dst = graph.getNodeById?.(link.target_id)
      if (dst) pts.push(dst.getConnectionPos(true, link.target_slot, [0, 0]))
    }
  }
  return pts
}

// Candidatos para un arrastre de reroutes: cuadrar el cable con sus extremos
// (prioridad socket) y, por debajo, alinearse con los demás reroutes del grafo
// para poder montar columnas y filas limpias de puntos.
function rerouteTargets(graph, draggedReroutes, draggedItems, out) {
  for (const r of draggedReroutes) {
    for (const [ax, ay] of rerouteAnchors(graph, r)) {
      // Sólo la Y del extremo: es lo que deja el tramo de cable recto.
      //
      // Deliberadamente NO se emite la X. Alinear la X con el extremo dejaría el
      // tramo vertical, que suena simétrico pero en la práctica estorba: los
      // cables de ComfyUI van casi siempre de izquierda a derecha, así que ese
      // candidato acaba arrastrando el punto de lado hasta plantarlo encima del
      // socket. Para columnas de reroutes ya están los candidatos de abajo.
      out.y.push(mk({
        ref: "min", value: ay, kind: "socket",
        guide: { x1: ax - GUIDE_REACH, y1: ay, x2: ax + GUIDE_REACH, y2: ay },
      }))
    }
  }

  for (const other of graph.reroutes?.values?.() ?? []) {
    if (draggedItems.has(other)) continue
    const [ox, oy] = other.pos
    out.x.push(mk({ ref: "min", value: ox, guide: { x1: ox, y1: oy - GUIDE_REACH, x2: ox, y2: oy + GUIDE_REACH } }))
    out.y.push(mk({ ref: "min", value: oy, guide: { x1: ox - GUIDE_REACH, y1: oy, x2: ox + GUIDE_REACH, y2: oy } }))
  }
}

// Lo que viaja con el arrastre, no sólo lo seleccionado.
//
// Al arrastrar un grupo, sus hijos NO están en selectedItems —los mueve el
// grupo— pero se mueven igual. Si emitieran candidatos, el grupo intentaría
// imantarse a sus propias tripas y se quedaría clavado en el sitio.
export function expandDragged(draggedItems) {
  const out = new Set(draggedItems)
  const stack = [...draggedItems]
  while (stack.length) {
    for (const child of stack.pop()?.children ?? []) {
      if (out.has(child)) continue
      out.add(child)
      stack.push(child)
    }
  }
  return out
}

// Candidatos para redimensionar por una esquina.
//
// Sólo se emiten para los DOS bordes que esa esquina mueve —"SE" mueve derecha e
// inferior, "NW" izquierda y superior—, así que computeSnap devuelve el delta de
// ese borde y el otro lado se queda clavado donde está. Un grupo sólo se estira
// por la esquina inferior derecha; un nodo, por las cuatro.
export function collectResizeTargets(graph, item, opts, dir = "SE") {
  const out = { x: [], y: [] }
  if (!graph) return out

  // Los hijos de un grupo se estiran con él: no son referencia válida.
  const skip = expandDragged(new Set([item]))

  // Cada especie con la suya: un grupo se mide contra otros grupos, un nodo
  // contra otros nodos. Mezclarlos llenaba el radio de bordes ajenos —los del
  // contenido para el grupo, los del marco para el nodo— y ganaba cualquiera.
  const rects = []
  const neighbours = isGroup(item) ? (graph.groups || []) : (graph.nodes || [])
  for (const n of neighbours) if (!skip.has(n)) rects.push(rectOf(n))

  const west  = dir.includes("W")
  const north = dir.includes("N")

  for (const r of rects) {
    const x1 = r.x + r.w
    const y1 = r.y + r.h
    const vline = (v) => ({ x1: v, y1: r.y - GUIDE_REACH, x2: v, y2: y1 + GUIDE_REACH })
    const hline = (v) => ({ x1: r.x - GUIDE_REACH, y1: v, x2: x1 + GUIDE_REACH, y2: v })

    // Igualar borde con borde: mismo ancho / mismo alto cuando el lado opuesto
    // ya está alineado, que es el caso típico de dos grupos en fila.
    // Y estirar hasta tocar al vecino, dejando el hueco de siempre.
    if (west) {
      out.x.push(mk({ ref: "min", value: r.x,  guide: vline(r.x) }))
      out.x.push(mk({ ref: "min", value: x1 + opts.gapX }))
    } else {
      out.x.push(mk({ ref: "max", value: x1,   guide: vline(x1) }))
      out.x.push(mk({ ref: "max", value: r.x - opts.gapX }))
    }

    if (north) {
      out.y.push(mk({ ref: "min", value: r.y,  guide: hline(r.y) }))
      out.y.push(mk({ ref: "min", value: y1 + opts.gapY }))
    } else {
      out.y.push(mk({ ref: "max", value: y1,   guide: hline(y1) }))
      out.y.push(mk({ ref: "max", value: r.y - opts.gapY }))
    }
  }
  return out
}

/**
 * @param {LGraph} graph
 * @param {Set} draggedItems    canvas.selectedItems
 * @param {{x,y,w,h}} dragRect  envolvente de lo arrastrado
 * @param {{gapX:number, gapY:number}} opts
 * @returns {{x:Array, y:Array}}
 */
export function collectSnapTargets(graph, draggedItems, dragRect, opts) {
  const out = { x: [], y: [] }
  if (!graph) return out

  const dragged = [...draggedItems]
  const moving = expandDragged(draggedItems)
  const draggedReroutes = dragged.filter(isReroute)

  // Arrastrando sólo reroutes el juego cambia: un reroute no tiene bordes que
  // alinear ni ancho que igualar, y meterle los candidatos de los nodos sería
  // ruido —seis por nodo— en el que se perdería lo único que importa, que es
  // cuadrar el cable. Así que esa ruta lleva su propio índice.
  if (draggedReroutes.length && draggedReroutes.length === dragged.length) {
    rerouteTargets(graph, draggedReroutes, moving, out)
    return out
  }

  // Los nodos virtuales (Set/Get y demás nodos de sólo frontend) SÍ entran: son
  // pastillas, pero tienen sockets y enlaces de verdad, así que cuadrar su
  // socket con el vecino del cable es exactamente lo que uno quiere al colocar
  // una variable. Excluirlos dejaba el imán enganchando por los bordes y nunca
  // por el cable, que es lo que se sentía como que "no los detecta".
  // Lo que filtra de verdad es `inputs`: grupos y reroutes no lo tienen.
  const draggedNodes = dragged.filter(it => it?.inputs !== undefined)
  const columns = new Map()

  const addNeighbour = (rect, collapsed) => {
    edgeTargets(rect, collapsed, opts, out)
    // agrupar por borde izquierdo (redondeado) para detectar columnas
    // Tolerancia de ~1 px: dos nodos colocados a mano casi nunca coinciden al
    // decimal, y para el ojo ya están en la misma columna.
    const key = Math.round(rect.x)
    if (!columns.has(key)) columns.set(key, [])
    columns.get(key).push(rect)
  }

  // Cada especie se imanta con la suya: arrastrando grupos sólo cuentan los
  // grupos, y arrastrando nodos sólo los nodos. Un grupo envuelve a sus nodos,
  // así que mezclándolos sus bordes caen siempre dentro del radio del nodo que
  // arrastras —y al revés— y el imán acaba enganchando donde no toca.
  if (dragged.every(isGroup)) {
    for (const group of graph.groups || []) {
      if (moving.has(group) || group.pinned) continue
      addNeighbour(rectOf(group), false)
    }
  } else {
    for (const node of graph.nodes) {
      if (moving.has(node) || node.pinned) continue
      addNeighbour(rectOf(node), !!node.flags?.collapsed)
    }
  }

  gapTargets(columns, dragRect, out)

  // Una vez, no por vecino: recorre los enlaces del nodo arrastrado, así que
  // encuentra su vecino en el cable sea nodo o reroute.
  socketTargets(graph, draggedNodes, moving, dragRect, out)
  return out
}
