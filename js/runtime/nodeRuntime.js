// Runtime por nodo (Fase 3): mide cuánto tarda cada nodo al ejecutar y lo muestra
// en un badge SOBRE el nodo — porque el runtime es una propiedad del nodo, no del
// cable. Dos toggles independientes que beben de la misma captura:
//   • "Show node runtime" (state.nodeRuntime): badge con el tiempo, en azul NKD.
//   • "Runtime heatmap"   (state.heatmap): ese badge se colorea por coste relativo
//     (azul oscuro = rápido → naranja = lento), en vez de azul plano.
// El badge aparece si CUALQUIERA de los dos está activo.
//
// Display: el sistema NATIVO de ComfyUI (`node.badges` + `LGraphBadge`), que
// renderiza igual en el canvas clásico y en Nodos 2.0 — sin dibujar en dos sitios.
// Misma vía que el badge de id del core (`Comfy.NodeBadge`).
//
// Captura: por eventos de la API. `executing` da el id del nodo en curso (o null al
// terminar); el tiempo de un nodo se cierra cuando arranca el siguiente. Patrón de
// Dev-Utils/profiler; sirve para flujos lineales (el caso común).
//
// ponytail: mide en el cliente (incluye latencia de red). El esquema del servidor
// trae execution_start_time/end_time y hay un evento progress_state con timing
// exacto — refinamiento futuro si el tiempo de red molesta.

import { app } from "../../../scripts/app.js"
import { api } from "../../../scripts/api.js"
import { formatRuntime } from "./formatRuntime.js"
import { heatColor } from "./heatColor.js"
import { NKD_ACCENT } from "../spline/config.js"

const LGraphBadge = () => globalThis.LGraphBadge
const RT = Symbol("nkdRuntimeBadge")   // marca nuestro badge en el nodo para hallarlo/quitarlo

const times = new Map()   // String(nodeId) -> ms
let cfg = null
let running = null        // id del nodo en ejecución
let runningStart = 0

const capturing = () => cfg?.nodeRuntime || cfg?.heatmap
function maxRuntime() { let m = 0; for (const v of times.values()) if (v > m) m = v; return m }
function nodeById(id) { return app.graph?.getNodeById?.(id) ?? null }

// El id de `executing` puede venir suelto (lo normal) o dentro de un objeto.
function idOf(detail) {
  if (detail == null) return null
  return typeof detail === "object" ? (detail.display_node ?? detail.node ?? null) : detail
}

function badgeFor(node) {
  const B = LGraphBadge()
  if (!B || !Array.isArray(node.badges)) return null
  let b = node[RT]
  if (!b) { b = new B({ text: "", fgColor: "#111", bgColor: NKD_ACCENT, fontSize: 10 }); node[RT] = b }
  if (!node.badges.includes(b)) node.badges.push(b)
  return b
}

// Texto = tiempo; color = azul plano, o el heat (relativo al máximo) si el heatmap
// está activo. Se llama para todos los nodos con badge cuando el máximo cambia.
function paint(node) {
  const b = node[RT]
  if (!b) return
  const ms = times.get(String(node.id))
  b.text = formatRuntime(ms)
  b.bgColor = cfg?.heatmap ? (heatColor(ms, maxRuntime()) || NKD_ACCENT) : NKD_ACCENT
}

function record(id, ms) {
  times.set(String(id), ms)
  if (!capturing()) return
  const node = nodeById(id)
  if (node) badgeFor(node)
  // Recolorar todos: el máximo pudo crecer y el heat es relativo a él.
  for (const n of app.graph?._nodes || []) if (n[RT]) paint(n)
  app.canvas?.setDirty(true, true)
}

// Quita nuestros badges de todos los nodos (conserva los tiempos).
export function clearRuntimeBadges() {
  for (const node of app.graph?._nodes || []) {
    const b = node[RT]
    if (!b) continue
    if (Array.isArray(node.badges)) node.badges = node.badges.filter(x => x !== b)
    node[RT] = null
  }
  app.canvas?.setDirty(true, true)
}

// Al cambiar cualquiera de los dos toggles: si alguno sigue activo, asegura los
// badges de los nodos con tiempo y los recolorea; si no, los quita.
export function refreshRuntimeDisplay() {
  if (!capturing()) { clearRuntimeBadges(); return }
  for (const key of times.keys()) { const n = nodeById(key); if (n) badgeFor(n) }
  for (const n of app.graph?._nodes || []) if (n[RT]) paint(n)
  app.canvas?.setDirty(true, true)
}

// Nueva cola: olvida los tiempos y quita los badges.
function resetRuntime() {
  times.clear()
  running = null
  clearRuntimeBadges()
}

export function installNodeRuntime(state) {
  cfg = state

  api.addEventListener("execution_start", () => {
    if (capturing()) resetRuntime()
  })

  api.addEventListener("executing", (e) => {
    if (!capturing()) return
    const id = idOf(e.detail)
    const now = performance.now()
    if (running != null) record(running, now - runningStart)   // el anterior terminó
    running = id
    runningStart = now
    if (id == null) running = null                             // fin de la cola
  })

  // Red de seguridad por si `executing:null` no llega: cerrar el último al acabar.
  api.addEventListener("execution_success", () => {
    if (!capturing() || running == null) return
    record(running, performance.now() - runningStart)
    running = null
  })
}
