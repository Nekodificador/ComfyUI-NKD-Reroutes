// Adaptador de "conectar desde lejos" — mecanismo calcado de niknah/quick-connections (MIT).
//
// Estilo NKD: listeners de pointer en window (CAPTURA) + hook de INSTANCIA sobre
// onDrawOverlay. El pointerup en captura corre ANTES que el handler nativo de la
// suelta —tanto el processMouseUp clásico como el pointerup de Vue en Nodos 2.0—,
// así que ahí decidimos si conectamos y suprimimos el buscador para ese release.
//
// Fin del arrastre (lo que quitaba el cable colgando): en el frontend moderno el
// estado de "connecting" lo cierra `canvas.linkConnector.reset()` (no basta con
// anular connecting_links). Es la pieza que faltaba, tomada de quick-connections.
//
// Supresión del buscador: sólo cuando conectamos, y sólo ese release. El frontend
// moderno lo abre por el evento `litegraph:canvas` subType 'empty-release', que
// cortamos con stopPropagation mientras dura la supresión; el clásico por el flag
// release_link_on_empty_shows_menu + canvas.showConnectionMenu. Soltar SIN elegir
// no suprime nada, así el "soltar para crear nodo" nativo sigue.
//
// Interacción: lista de sockets compatibles anclada al socket de ORIGEN, la fila
// bajo el cursor resaltada, línea de puntos + contorno del nodo destino, soltar
// encima conecta. Libres antes que ocupados (motor). Coords desde el evento
// (clientX/Y + ds), no desde graph_mouse (en 2.0 esa va por otra vía).
//
// ponytail: v1 = sólo conectar (sin insertar Reroute/Set-Get).

import { app } from "../../../scripts/app.js"
import { computeQuickConnect } from "./computeQuickConnect.js"
import { rectOf } from "../magnet/snapTargets.js"

const LG = () => globalThis.LiteGraph

let cfg = null                 // el objeto state, para leer quickConnect en vivo
let drag = null                // sesión de arrastre activa (coords de GRAFO); null = nada
let suppressing = false        // ventana en la que suprimimos el buscador nativo

const _overlayPatched = new WeakSet()
const ROW_H = 22, PAD = 8, DOT = 4, ANCHOR_GAP = 32
const MIN_W = 180, MAX_W = 380
const ACCENT = "#e0c060"

const labelOf = (it) => `${it.node.title || it.node.type || "node"} · ${it.name || "#" + it.slot}`

// Redondeado con fallback por si el navegador no trae ctx.roundRect.
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
}

// Cursor en coordenadas de GRAFO desde el evento — válido en clásico y 2.0.
function eventGraphPos(canvas, e) {
  const el = canvas.canvas
  if (!el || e?.clientX == null) return [canvas.graph_mouse?.[0] ?? 0, canvas.graph_mouse?.[1] ?? 0]
  const rect = el.getBoundingClientRect()
  const s = canvas.ds.scale, o = canvas.ds.offset
  return [(e.clientX - rect.left) / s - o[0], (e.clientY - rect.top) / s - o[1]]
}

// Lee el socket del que se está arrastrando, en ambos renderizadores.
function readConnecting(canvas) {
  if (!canvas) return null
  // Nodos 2.0 / ComfyUI: connecting_links es un array.
  if (canvas.connecting_links) {
    const l = canvas.connecting_links[0]
    const sock = l?.output || l?.input
    const side = l?.output ? "output" : l?.input ? "input" : null
    if (!l || !side || !sock) return null
    return { node: l.node, slot: l.slot, side, type: sock.type }
  }
  // Clásico.
  if (canvas.connecting_node) {
    const sock = canvas.connecting_output || canvas.connecting_input
    const side = canvas.connecting_output ? "output" : canvas.connecting_input ? "input" : null
    if (!side || !sock) return null
    return { node: canvas.connecting_node, slot: canvas.connecting_slot, side, type: sock.type }
  }
  return null
}

function originSocketPos(origin) {
  return origin.node.getConnectionPos(origin.side === "input", origin.slot, [0, 0])
}

// Todos los sockets del lado buscado como candidatos planos para el motor.
function collectCandidates(graph, origin) {
  const want = origin.side === "output" ? "input" : "output"
  const isInput = want === "input"
  const out = []
  for (const node of graph.nodes || []) {
    if (node === origin.node) continue          // no ofrecerse a sí mismo
    const sockets = isInput ? node.inputs : node.outputs
    if (!sockets) continue
    for (let slot = 0; slot < sockets.length; slot++) {
      const s = sockets[slot]
      if (!s) continue
      const pos = node.getConnectionPos(isInput, slot, [0, 0])
      // Ocupado sólo tiene sentido en una entrada (admite un enlace); una salida
      // abanica, así que nunca bloquea y se ofrece siempre como disponible.
      const occupied = isInput ? s.link != null : false
      out.push({ node, nodeId: node.id, slot, side: want, type: s.type, name: s.name || s.label || "", pos, occupied })
    }
  }
  return out
}

// Ancho del panel ajustado al texto más largo (medido con la fuente real).
function measureWidth(canvas, items) {
  const ctx = canvas.ctx
  const chrome = PAD + DOT * 2 + 6 + PAD      // punto + hueco + padding derecho
  if (!ctx) return 240
  ctx.save(); ctx.font = "12px sans-serif"
  let max = 0
  for (const it of items) max = Math.max(max, ctx.measureText(labelOf(it)).width)
  ctx.restore()
  return Math.min(MAX_W, Math.max(MIN_W, Math.ceil(max) + chrome))
}

function buildDrag(canvas, origin) {
  const items = computeQuickConnect(origin, collectCandidates(canvas.graph, origin), { max: 15 })
  if (!items.length) return null
  const sp = originSocketPos(origin)
  const width = measureWidth(canvas, items)
  // Lista a la derecha de una salida, a la izquierda de una entrada.
  const anchor = origin.side === "output"
    ? { x: sp[0] + ANCHOR_GAP,         y: sp[1] - ROW_H / 2 }
    : { x: sp[0] - ANCHOR_GAP - width, y: sp[1] - ROW_H / 2 }
  return { origin, originPos: sp, items, anchor, width, hover: -1, rects: [] }
}

function connect(origin, target) {
  // Salida→entrada siempre; si el origen era una entrada, el candidato es la salida.
  if (origin.side === "output") origin.node.connect(origin.slot, target.node, target.slot)
  else target.node.connect(target.slot, origin.node, origin.slot)
  app.graph?.afterChange?.()
}

function redraw(canvas) {
  canvas?.setDirty?.(true, true)
}

function hitTest(gx, gy) {
  if (!drag) return -1
  return drag.rects.findIndex(r => gx >= r.x && gx <= r.x + r.w && gy >= r.y && gy <= r.y + r.h)
}

// Neutraliza el buscador nativo (moderna showConnectionMenu + flag clásico + la
// ventana `suppressing` que corta el evento empty-release); devuelve la restauración.
function suppressNativeReleaseOnce(canvas) {
  const L = LG()
  const prevFlag = L ? L.release_link_on_empty_shows_menu : undefined
  const prevShow = canvas.showConnectionMenu
  suppressing = true
  if (L) L.release_link_on_empty_shows_menu = false
  canvas.showConnectionMenu = () => {}
  return () => {
    suppressing = false
    if (L) L.release_link_on_empty_shows_menu = prevFlag
    canvas.showConnectionMenu = prevShow
  }
}

// Cierra el estado de arrastre: en el frontend moderno lo hace linkConnector.reset();
// en el clásico basta con soltar los connecting_*. Se hace lo de ambos por si acaso.
function endDrag(canvas) {
  canvas.linkConnector?.reset?.()
  canvas.connecting_links = null
  canvas.connecting_node = null
  canvas.connecting_output = null
  canvas.connecting_input = null
  canvas.connecting_slot = null
  canvas.connecting_pos = null
}

// ── Dibujo (hook de instancia sobre onDrawOverlay), en coords de GRAFO ───────
// ponytail: escala con el zoom; si molesta al alejar, pasar a espacio de pantalla.
function drawDrag(ctx, canvas) {
  if (!drag) return
  const W = drag.width, ax = drag.anchor.x, ay = drag.anchor.y
  ctx.save()
  canvas.ds.toCanvasContext(ctx)

  // Destino resaltado: contorno del nodo (con brillo) + línea de puntos + anillo.
  if (drag.hover >= 0) {
    const t = drag.items[drag.hover]
    const r = rectOf(t.node)
    ctx.save()
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 2
    ctx.shadowColor = ACCENT; ctx.shadowBlur = 16
    rr(ctx, r.x, r.y, r.w, r.h, 8); ctx.stroke()
    ctx.restore()

    ctx.save()
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 2; ctx.setLineDash([6, 4])
    ctx.beginPath(); ctx.moveTo(drag.originPos[0], drag.originPos[1]); ctx.lineTo(t.pos[0], t.pos[1]); ctx.stroke()
    ctx.restore()

    ctx.strokeStyle = ACCENT; ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(t.pos[0], t.pos[1], 6, 0, Math.PI * 2); ctx.stroke()
  }

  // Panel único (sin recuadro por opción).
  const h = drag.items.length * ROW_H
  ctx.fillStyle = "rgba(24,24,24,0.96)"
  rr(ctx, ax, ay, W, h, 6); ctx.fill()

  // Filas, recortadas al panel para que el texto no se salga.
  ctx.save()
  rr(ctx, ax, ay, W, h, 6); ctx.clip()
  ctx.font = "12px sans-serif"; ctx.textBaseline = "middle"
  drag.rects = []
  drag.items.forEach((it, i) => {
    const y = ay + i * ROW_H
    drag.rects.push({ x: ax, y, w: W, h: ROW_H })
    if (i === drag.hover) { ctx.fillStyle = "#3a6ea5"; ctx.fillRect(ax, y, W, ROW_H) }
    // Ocupado = atenuado (punto y texto en gris); libre = dorado.
    ctx.fillStyle = it.occupied ? "#777" : ACCENT
    ctx.beginPath(); ctx.arc(ax + PAD + DOT, y + ROW_H / 2, DOT, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = i === drag.hover ? "#fff" : it.occupied ? "#9a9a9a" : "#ddd"
    ctx.fillText(labelOf(it), ax + PAD + DOT * 2 + 6, y + ROW_H / 2)
  })
  ctx.restore()

  // Borde del panel por encima del recorte.
  ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.lineWidth = 1
  rr(ctx, ax, ay, W, h, 6); ctx.stroke()

  ctx.restore()
}

function ensureOverlayHook(canvas) {
  if (!canvas || _overlayPatched.has(canvas)) return
  _overlayPatched.add(canvas)
  const prev = canvas.onDrawOverlay
  canvas.onDrawOverlay = function (ctx) {
    prev?.call(this, ctx)
    drawDrag(ctx, this)
  }
}

// ── Listeners de entrada (window, CAPTURA: corren antes que los handlers nativos) ─

function onPointerMove(e) {
  const canvas = app.canvas
  if (!canvas) return
  if (!cfg?.quickConnect) { if (drag) { drag = null; redraw(canvas) } return }

  const origin = readConnecting(canvas)
  if (origin && !drag) { drag = buildDrag(canvas, origin); if (drag) ensureOverlayHook(canvas) }
  else if (!origin && drag) { drag = null; redraw(canvas); return }   // enlace soltado/cancelado

  if (drag) {
    const [gx, gy] = eventGraphPos(canvas, e)
    const h = hitTest(gx, gy)
    if (h !== drag.hover) drag.hover = h
    redraw(canvas)   // el trazo de puntos y el highlight siguen al cursor cada frame
  }
}

function onPointerUp(e) {
  const canvas = app.canvas
  if (!canvas || !drag) return
  const [gx, gy] = eventGraphPos(canvas, e)
  const hover = hitTest(gx, gy)
  const d = drag
  drag = null
  redraw(canvas)
  if (hover < 0) return                       // sin selección: dejar el buscador nativo

  const origin = d.origin, target = d.items[hover]
  // Suprimir AHORA (antes del handler nativo del release), conectar y cerrar el
  // arrastre al tick siguiente (cuando el handler nativo ya ha corrido).
  const restore = suppressNativeReleaseOnce(canvas)
  setTimeout(() => {
    restore()
    if (app.canvas !== canvas) return
    connect(origin, target)
    endDrag(canvas)
    redraw(canvas)
  }, 0)
}

// El frontend moderno abre el buscador vía este evento; lo cortamos mientras suprimimos.
function onLitegraphCanvas(e) {
  if (suppressing && e.detail?.subType === "empty-release") e.stopPropagation()
}

export function installQuickConnect(state) {
  cfg = state
  window.addEventListener("pointermove", onPointerMove, true)
  window.addEventListener("pointerup", onPointerUp, true)
  window.addEventListener("litegraph:canvas", onLitegraphCanvas, true)
}
