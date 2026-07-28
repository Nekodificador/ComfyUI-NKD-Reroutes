import { computeSnap } from "./computeSnap.js"
import { collectSnapTargets, rectOf, unionRect } from "./snapTargets.js"

// Estado del arrastre en curso. El índice de candidatos se construye una sola
// vez, en el primer frame en que el imán está activo, y se tira al soltar.
const session = {
  active:  false,
  graph:   null,
  targets: null,
  nodes:   [],
  result:  null,
}

let _reentry = false

// El ancho se aplica al soltar, no por frame: así el movimiento y el
// redimensionado caen en la misma transacción y un solo Ctrl+Z revierte ambos.
function commitWidth(state) {
  const width = session.result?.width
  if (!state.magnetMatchWidth || width == null) return

  for (const n of session.nodes) {
    if (n.flags?.collapsed) continue
    const min = n.computeSize?.()?.[0] ?? 0
    if (width < min) continue          // nunca por debajo del mínimo del nodo
    n.setSize([width, n.size[1]])
  }
}

function endSession(state, commit) {
  if (session.active) {
    if (commit) commitWidth(state)
    session.graph?.afterChange()
  }
  session.active = false
  session.graph = null
  session.targets = null
  session.nodes = []
  session.result = null
}

function draggedNodesOf(canvas) {
  return [...(canvas.selectedItems || [])].filter(it => it && it.pos && it.size && !it.pinned)
}

// state: el objeto `state` vivo de rerouteSplines.js
export function installMagnet(state) {
  installClassicPath(state)
  installGuideRenderer(state)
}

function installClassicPath(state) {
  const orig = LGraphCanvas.prototype.processMouseMove
  if (!orig) return

  LGraphCanvas.prototype.processMouseMove = function (e) {
    const ret = orig.apply(this, arguments)   // deja que LiteGraph mueva primero
    if (_reentry) return ret

    const engaged = state.magnetEnabled && e?.shiftKey && this.state?.draggingItems
    if (!engaged) { endSession(state, false); return ret }

    _reentry = true
    try { applyMagnet(this, state) } finally { _reentry = false }
    return ret
  }

  const origUp = LGraphCanvas.prototype.processMouseUp
  if (origUp) {
    LGraphCanvas.prototype.processMouseUp = function () {
      const ret = origUp.apply(this, arguments)
      endSession(state, true)
      this.setDirty(true, true)
      return ret
    }
  }
}

function applyMagnet(canvas, state) {
  const nodes = draggedNodesOf(canvas)
  if (!nodes.length) { endSession(state, false); return }

  const dragRect = unionRect(nodes.map(rectOf))
  if (!dragRect) { endSession(state, false); return }

  // El índice se construye una vez por arrastre: los vecinos no se mueven.
  if (!session.active) {
    session.graph = canvas.graph
    canvas.graph?.beforeChange()

    session.targets = collectSnapTargets(canvas.graph, canvas.selectedItems, dragRect, {
      gapX: state.magnetGapX,
      gapY: state.magnetGapY,
    })
    session.active = true
    session.nodes = nodes
  }

  const minWidth = Math.max(...nodes.map(n => (n.computeSize?.()?.[0]) ?? 0))
  const result = computeSnap(dragRect, session.targets, {
    radius:     state.magnetRadius,
    matchWidth: Boolean(state.magnetMatchWidth),
    minWidth,
  })
  session.result = result

  // La silueta va donde caerá el nodo, con el ancho que tendrá al soltar.
  result.ghost = {
    x: dragRect.x + result.dx,
    y: dragRect.y + result.dy,
    w: result.width ?? dragRect.w,
    h: dragRect.h,
  }

  if (result.dx || result.dy) {
    for (const n of nodes) {
      // setPos(), nunca n.pos[0] += dx: `pos` es un Float64Array y el setter de
      // la clase sincroniza el layout store. Mutar el índice se lo salta.
      n.setPos(n.pos[0] + result.dx, n.pos[1] + result.dy)
    }
    canvas.setDirty(true, true)
  }
}

function installGuideRenderer(state) {
  // Encadenar, nunca sobrescribir: el core ya engancha aquí el borde de selección.
  const prev = LGraphCanvas.prototype.onDrawForeground
  LGraphCanvas.prototype.onDrawForeground = function (ctx, visibleArea) {
    prev?.call(this, ctx, visibleArea)
    if (!session.active || !state.magnetGuides || !session.result) return

    // Las guías y la silueta se dibujan por separado. Sólo los candidatos de
    // alineación llevan guía; los de adosado no. Un enganche que gane sólo por
    // apilado deja `guides` vacío y aun así mueve el nodo, así que salir aquí
    // dejaría ese caso sin ningún indicador.
    const { guides, ghost } = session.result
    if (!guides.length && !ghost) return

    ctx.save()

    if (guides.length) {
      ctx.setLineDash([6, 5])
      ctx.lineWidth = 1
      ctx.strokeStyle = "#FFFFFF66"
      ctx.beginPath()
      for (const g of guides) {
        ctx.moveTo(g.x1, g.y1)
        ctx.lineTo(g.x2, g.y2)
      }
      ctx.stroke()
    }

    // Silueta de destino. Se dibuja con el ancho final para que el cambio de
    // forma de la regla 5 se vea venir antes de soltar.
    if (ghost) {
      ctx.setLineDash([])
      ctx.lineWidth = 0.5
      ctx.strokeStyle = "#FFFFFF66"
      ctx.fillStyle = "#FFFFFF22"
      ctx.beginPath()
      ctx.rect(ghost.x, ghost.y, ghost.w, ghost.h)
      ctx.fill()
      ctx.stroke()
    }

    ctx.restore()
  }
}
