// Construcción del índice de candidatos de imantación.
// Se ejecuta UNA VEZ al empezar el arrastre: los vecinos no se mueven mientras
// arrastras, así que recalcularlos por frame sería trabajo tirado.

// Rectángulo del nodo en coordenadas de grafo, barra de título incluida.
// Derivado de pos/size en vez de getBounding() porque boundingRect sólo se
// refresca al dibujar y durante el arrastre puede ir un frame por detrás.
export function rectOf(node) {
  const th = LiteGraph.NODE_TITLE_HEIGHT
  const x = node.pos[0]
  const y = node.pos[1] - th
  if (node.flags?.collapsed) {
    const w = node._collapsed_width || LiteGraph.NODE_COLLAPSED_WIDTH
    return { x, y, w, h: th }
  }
  return { x, y, w: node.size[0], h: node.size[1] + th }
}

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

// Enlaces que conectan un nodo arrastrado con un vecino, en ambos sentidos.
// Devuelve pares [yPropio, yVecino] en coordenadas de grafo.
function socketPairs(graph, draggedNode, neighbour) {
  const pairs = []
  const links = graph.links
  const getLink = (id) => (links?.get ? links.get(id) : links?.[id])

  // entradas del arrastrado alimentadas por el vecino
  for (const [slot, input] of (draggedNode.inputs || []).entries()) {
    const link = input?.link != null ? getLink(input.link) : null
    if (!link || link.origin_id !== neighbour.id) continue
    const own = draggedNode.getConnectionPos(true, slot, [0, 0])
    const other = neighbour.getConnectionPos(false, link.origin_slot, [0, 0])
    pairs.push([own[1], other[1]])
  }

  // salidas del arrastrado que alimentan al vecino
  for (const [slot, output] of (draggedNode.outputs || []).entries()) {
    for (const id of output?.links || []) {
      const link = getLink(id)
      if (!link || link.target_id !== neighbour.id) continue
      const own = draggedNode.getConnectionPos(false, slot, [0, 0])
      const other = neighbour.getConnectionPos(true, link.target_slot, [0, 0])
      pairs.push([own[1], other[1]])
    }
  }

  return pairs
}

function socketTargets(graph, draggedNodes, neighbour, dragRect, out) {
  for (const node of draggedNodes) {
    for (const [ownY, otherY] of socketPairs(graph, node, neighbour)) {
      out.y.push(mk({
        ref: "socket",
        offset: ownY - dragRect.y,   // el socket viaja con el rect
        value: otherY,
        kind: "socket",
        guide: { x1: dragRect.x - GUIDE_REACH, y1: otherY, x2: dragRect.x + GUIDE_REACH, y2: otherY },
      }))
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

  const draggedNodes = [...draggedItems].filter(it => it?.isVirtualNode !== true && it?.inputs !== undefined)
  const columns = new Map()

  for (const node of graph.nodes) {
    if (draggedItems.has(node) || node.pinned) continue

    const nRect = rectOf(node)
    edgeTargets(nRect, !!node.flags?.collapsed, opts, out)
    socketTargets(graph, draggedNodes, node, dragRect, out)

    // agrupar por borde izquierdo (redondeado) para detectar columnas
    const key = Math.round(nRect.x)
    if (!columns.has(key)) columns.set(key, [])
    columns.get(key).push(nRect)
  }

  gapTargets(columns, dragRect, out)
  return out
}
