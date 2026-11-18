// Redimensionar un grupo desde cualquiera de sus cuatro esquinas.
//
// El frontend sólo ofrece el triángulo de abajo a la derecha (en los dos
// renderizadores los grupos se pintan en el canvas). La esquina SE se deja al
// nativo —ya funciona y el imán ya la trata—; aquí se toman las otras tres.
//
// Medidas de nomadoor/ComfyUI-Smart-Guides (MIT), ya probadas por él: zona de
// agarre de 20×20 por esquina, 4 hacia fuera y 16 hacia dentro, con la parte de
// dentro topada a 1/4 del grupo para que en uno pequeño siga quedando título que
// agarrar. Escrito aparte, sin su código.
//
// Puro arriba (bajo node); el adaptador recibe el canvas y no importa `app`.

export const OUTSIDE = 4
export const INSIDE = 16

/** Esquina de `r` bajo (x, y): "NW" | "NE" | "SW" | "SE" | null. */
export function cornerAt(r, x, y) {
  const inside = Math.min(INSIDE, r.w / 4, r.h / 4)
  const near = (v, edge, dir) => { const d = (v - edge) * dir; return d >= -OUTSIDE && d <= inside }
  const v = near(y, r.y, 1) ? "N" : near(y, r.y + r.h, -1) ? "S" : ""
  const h = near(x, r.x, 1) ? "W" : near(x, r.x + r.w, -1) ? "E" : ""
  return v && h ? v + h : null
}

/**
 * Rectángulo tras arrastrar la esquina (dx, dy) desde `start`. Siempre desde la
 * foto inicial: sin estado, así no deriva. El lado opuesto no se mueve nunca,
 * tampoco al topar con el mínimo (el `resize` nativo topa contra el origen, que
 * por el lado oeste/norte haría correr el grupo).
 */
export function resizeFrom(start, corner, dx, dy, minW, minH) {
  let { x, y, w, h } = start
  if (corner.includes("W")) { w = Math.max(minW, start.w - dx); x = start.x + start.w - w }
  else w = Math.max(minW, start.w + dx)
  if (corner.includes("N")) { h = Math.max(minH, start.h - dy); y = start.y + start.h - h }
  else h = Math.max(minH, start.h + dy)
  return { x, y, w, h }
}

// ─── Adaptador ──────────────────────────────────────────────────────────────

const CURSOR = { NW: "nwse-resize", SE: "nwse-resize", NE: "nesw-resize", SW: "nesw-resize" }
const rectOfGroup = (g) => ({ x: g.pos[0], y: g.pos[1], w: g.size[0], h: g.size[1] })

let _active = null   // { item, dir } mientras se estira; lo lee el imán
let _hover = null    // esquina bajo el puntero con el botón suelto (para el cursor)

/** Lo que se está estirando ahora mismo por una esquina nuestra, o null. */
export const activeGroupResize = () => _active

function groupCornerAt(graph, x, y) {
  const groups = graph?._groups ?? []
  for (let i = groups.length - 1; i >= 0; i--) {   // el de encima primero
    const g = groups[i]
    if (g.pinned) continue
    const corner = cornerAt(rectOfGroup(g), x, y)
    if (corner && corner !== "SE") return { group: g, corner }
  }
  return null
}

function takeOver(canvas, e) {
  const x = e.canvasX, y = e.canvasY
  if (x === undefined || canvas.linkConnector?.isConnecting) return
  const hit = groupCornerAt(canvas.graph, x, y)
  if (!hit) return
  // Lo que viva en la esquina (reroute, centro de cable, E/S de subgrafo) conserva su arrastre.
  if (canvas.graph.getRerouteOnPos?.(x, y)) return
  if (canvas.subgraph?.getIoNodeOnPos?.(x, y)) return
  try { if (canvas._getLinkCentreOnPos?.(e)) return } catch { /* nada */ }

  const { group, corner } = hit
  const start = rectOfGroup(group)
  const p = canvas.pointer
  if (!p) return
  const G = group.constructor
  let open = false
  const finish = () => {
    // La transacción se cierra lo primero: con un beforeChange abierto el
    // ChangeTracker deja de apuntar historial el resto de la sesión.
    if (open) { open = false; try { canvas.emitAfterChange?.() } catch { /* nada */ } }
    if (_active?.item !== group) return
    _active = null
    canvas._updateCursorStyle?.()
  }
  // El clic sigue siendo del frontend (seleccionar por el título, caja en el cuerpo).
  // Sin la transacción el ChangeTracker apuntaba un estado a medio arrastre y
  // Ctrl+Z volvía ahí en vez de al de antes (medido).
  p.onDragStart = () => {
    canvas.dragging_canvas = false
    try { canvas.emitBeforeChange?.(); open = true } catch { /* nada */ }
    _active = { item: group, dir: corner }
  }
  p.onDrag = (ev) => {
    if (_active?.item !== group) return
    const r = resizeFrom(start, corner, ev.canvasX - x, ev.canvasY - y, G.minWidth ?? 140, G.minHeight ?? 80)
    group.pos = [r.x, r.y]
    group.size = [r.w, r.h]
    canvas.setDirty(true, true)
  }
  p.onDragEnd = finish
  p.finally = finish
}

export function installGroupResize(app) {
  const P = globalThis.LGraphCanvas?.prototype
  if (!P || typeof P._processPrimaryButton !== "function" || P.__nkdGroupCorners) return
  P.__nkdGroupCorners = true

  const press = P._processPrimaryButton
  P._processPrimaryButton = function (e, node, ...rest) {
    const out = press.call(this, e, node, ...rest)
    try { if (!node && !this.read_only && !this.selectOnly) takeOver(this, e) }
    catch (err) { console.error("[NKD Reroutes] esquinas de grupo:", err) }
    return out
  }

  // El cursor pasa por la misma vía que el del frontend (_updateCursorStyle +
  // su caché _setCursor): escribir style.cursor lo desincroniza y no vuelve.
  const cursor = P._updateCursorStyle
  if (typeof cursor === "function") {
    P._updateCursorStyle = function (...args) {
      const out = cursor.apply(this, args)
      const c = _active?.dir ?? (!this.pointer?.isDown && !this.read_only ? _hover : null)
      if (c && typeof this._setCursor === "function") this._setCursor(CURSOR[c])
      return out
    }
  }

  addEventListener("pointermove", (e) => {
    const canvas = app?.canvas
    if (!canvas || e.target !== canvas.canvas || canvas.pointer?.isDown) return
    let next = null
    try {
      const [x, y] = canvas.convertEventToCanvasOffset(e)
      if (!canvas.graph?.getNodeOnPos(x, y, canvas.visible_nodes)) next = groupCornerAt(canvas.graph, x, y)?.corner ?? null
    } catch { next = null }
    _hover = next   // lo lee la actualización de cursor del frontend que sigue a este evento
  }, true)
}
