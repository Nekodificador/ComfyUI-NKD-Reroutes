// Bus de reroutes: adaptador.
// Spec: docs/superpowers/specs/2026-10-26-bus-de-reroutes-design.md
//
// Un bus es una columna de reroutes NATIVOS (uno por cable) más su pertenencia
// en graph.extra.nkdBuses. Sin la extensión se ve la columna de puntos y todo
// funciona; con ella se ocultan los puntos y se pinta la barra. Nada más se
// guarda: la barra se deriva en cada frame de sus reroutes.
//
// Gestos, en window-CAPTURA como js/connect/ (corren antes que el handler
// nativo, en clásico y en Nodes 2.0):
//   · Ctrl+Alt+arrastrar con el botón izquierdo, desde canvas vacío: los cables
//     cortados forman un bus. Si la línea cruza una barra, saca ese cable.
//   · Pulsar una barra: selecciona sus reroutes y la arrastra entera. Supr la
//     borra (borrado nativo de la selección; la reconciliación limpia extra).
// Node Wrangler usa sólo el botón derecho, así que no se pisan.

import { app } from "../../../scripts/app.js"
import { NKD_ACCENT } from "../spline/config.js"
import { eventGraphPos } from "../connect/quickConnect.js"
import {
  sampleCut, hitSegments, layoutLanes, reconcileBuses,
  busRect, memberAtCut, nextBusId,
} from "./computeBus.js"

const BAR_FILL = "#dddddd"
const CUT_COLOR = "#ff3b3b"

let cfg = null
let members = new Set()   // ids de reroute que están en algún bus (frame actual)
let bars = []             // [{ bus, rect, members: [{ id, x, y }] }] (frame actual)
let cut = null            // { a, b } en coords de grafo mientras se arrastra el corte
let drag = null           // { graph, items, last } mientras se arrastra una barra

export const isBusMember = (id) => members.has(id)

const kill = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation() }
const inside = (r, [x, y], m = 0) => x >= r.x - m && x <= r.x + r.w + m && y >= r.y - m && y <= r.y + r.h + m

// Una vez por frame, antes de dibujar: reconciliar y derivar las barras.
// Con el interruptor apagado no hay barras ni puntos ocultos: se ve lo nativo.
export function busBeginFrame(graph) {
  members = new Set()
  bars = []
  if (!cfg?.rerouteBus || !graph?.reroutes) return
  const raw = graph.extra?.nkdBuses
  if (!raw?.length) return
  const clean = reconcileBuses(raw, new Set(graph.reroutes.keys()))
  // Sólo se escribe si cambió: limpiar lo que otro dejó roto no es un cambio del usuario.
  if (JSON.stringify(clean) !== JSON.stringify(raw)) graph.extra.nkdBuses = clean
  for (const bus of clean) {
    const ms = bus.rerouteIds.map(id => {
      const r = graph.reroutes.get(id)
      return { id, x: r.pos[0], y: r.pos[1] }
    })
    for (const m of ms) members.add(m.id)
    bars.push({ bus, rect: busRect(ms), members: ms })
  }
}

// Después de los cables: las barras encima de ellos, y la línea de corte en vuelo.
export function busDraw(ctx, graph) {
  for (const { rect, members: ms } of bars) {
    const sel = ms.some(m => graph?.reroutes?.get(m.id)?.selected)
    ctx.save()
    ctx.fillStyle   = BAR_FILL
    ctx.strokeStyle = sel ? NKD_ACCENT : "rgba(0,0,0,0.5)"
    ctx.lineWidth   = sel ? 2 : 1
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(rect.x, rect.y, rect.w, rect.h, rect.w / 2)
    else ctx.rect(rect.x, rect.y, rect.w, rect.h)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }
  if (cut) {
    ctx.save()
    ctx.strokeStyle = CUT_COLOR
    ctx.lineWidth   = 2
    ctx.beginPath()
    ctx.moveTo(cut.a[0], cut.a[1])
    ctx.lineTo(cut.b[0], cut.b[1])
    ctx.stroke()
    ctx.restore()
  }
}

// Los segmentos que corta la línea, sobre el trazado REAL del último frame
// (Bézier o PCB, da igual: es el Path2D que pintó el frontend).
function segmentsHit(cv, a, b) {
  const ctx = cv.ctx
  const segs = [...(cv.renderedPaths ?? [])].filter(s => s.path)
  ctx.save()
  // Los Path2D están en coords de grafo: con la transformación identidad se
  // prueban directamente contra el punto de grafo (medido).
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.lineWidth = (cv.connections_width ?? 3) + 4
  const hits = hitSegments(sampleCut(a, b), segs, (s, x, y) => ctx.isPointInStroke(s.path, x, y))
  ctx.restore()
  return hits
}

function createBus(graph, cv, a, b) {
  const layout = layoutLanes(segmentsHit(cv, a, b), cfg.busLaneGap)
  if (!layout) return
  graph.beforeChange()
  try {
    // Cada segmento se identifica por su extremo de aguas abajo (un LLink o un
    // Reroute): createReroute inserta justo aguas arriba de él (medido).
    const ids = layout.lanes.map(l => graph.createReroute([layout.x, l.y], l.seg).id)
    // Un solo cable: reroute nativo normal, sin bus.
    if (ids.length >= 2) {
      graph.extra ??= {}
      const buses = graph.extra.nkdBuses ??= []
      buses.push({ id: nextBusId(buses), rerouteIds: ids })
    }
  } finally {
    graph.afterChange()
  }
}

// Saca del bus el carril que cruza el corte. Devuelve true si cruzó alguna barra.
function removeFromBus(graph, a, b) {
  for (const bar of bars) {
    const id = memberAtCut(bar.rect, bar.members, a, b)
    if (id == null) continue
    graph.beforeChange()
    try {
      // removeReroute reengancha la cadena; la reconciliación lo quita del bus
      // (y disuelve el bus si se queda con uno).
      graph.removeReroute(id)
    } finally {
      graph.afterChange()
    }
    return true
  }
  return false
}

function onDown(e) {
  if (!cfg?.rerouteBus || e.button !== 0) return
  const cv = app.canvas
  const graph = cv?.graph
  if (!graph || e.target !== cv.canvas) return
  const p = eventGraphPos(cv, e)

  if (e.ctrlKey && e.altKey) {
    // Sobre un nodo manda lo nativo (Alt+arrastrar clona).
    if (graph.getNodeOnPos?.(p[0], p[1])) return
    cut = { a: p, b: p }
    kill(e)
    return
  }
  if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return

  const bar = bars.find(b => inside(b.rect, p, 4))
  if (!bar) return
  const items = bar.members.map(m => graph.reroutes.get(m.id)).filter(Boolean)
  cv.deselectAll?.()
  cv.selectItems?.(items)
  graph.beforeChange()
  drag = { graph, items, last: p }
  kill(e)
}

function onMove(e) {
  if (!cut && !drag) return
  const cv = app.canvas
  const p = eventGraphPos(cv, e)
  if (cut) {
    cut.b = p
  } else {
    const dx = p[0] - drag.last[0], dy = p[1] - drag.last[1]
    // Asignar, no mutar en el sitio: el setter de pos sincroniza el layout store.
    for (const r of drag.items) r.pos = [r.pos[0] + dx, r.pos[1] + dy]
    drag.last = p
  }
  cv.setDirty(true, true)
  kill(e)
}

function onUp(e) {
  if (!cut && !drag) return
  const cv = app.canvas
  try {
    if (cut) {
      const graph = cv.graph
      if (!removeFromBus(graph, cut.a, cut.b)) createBus(graph, cv, cut.a, cut.b)
    } else {
      drag.graph.afterChange()
    }
  } catch (err) {
    console.warn("[NKD Reroutes] bus", err)
  } finally {
    cut = null
    drag = null
    cv.setDirty(true, true)
    kill(e)
  }
}

export function installBus(state) {
  cfg = state
  window.addEventListener("pointerdown", onDown, true)
  window.addEventListener("pointermove", onMove, true)
  window.addEventListener("pointerup",   onUp,   true)
}
