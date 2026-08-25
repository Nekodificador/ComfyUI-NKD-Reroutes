// Runtime por nodo (Fase 3): mide cuánto tarda cada nodo al ejecutar y lo muestra
// como un badge sobre el nodo.
//
// Display: el sistema de badges NATIVO de ComfyUI (`node.badges` + `LGraphBadge`),
// que renderiza igual en el canvas clásico y en Nodos 2.0 — así no hay que dibujar
// en dos sitios (onDrawForeground clásico + DOM en Vue). Es la misma vía que usa el
// badge de id de nodo del core (`Comfy.NodeBadge`).
//
// Captura: por eventos de la API. `executing` da el id del nodo en curso (o null al
// terminar la cola); el tiempo de un nodo se cierra cuando arranca el siguiente. Es
// el patrón de Dev-Utils/profiler; sirve para flujos lineales (el caso común).
//
// ponytail: mide en el cliente (incluye latencia de red). El esquema del servidor
// trae execution_start_time/end_time y hay un evento progress_state con timing
// exacto — refinamiento futuro si el tiempo de red molesta. Sin group-support ni
// heatmap todavía (el heatmap sobre cable/reroute es la segunda capa de esta fase).

import { app } from "../../../scripts/app.js"
import { api } from "../../../scripts/api.js"
import { formatRuntime } from "./formatRuntime.js"
import { NKD_ACCENT } from "../spline/config.js"

const LGraphBadge = () => globalThis.LGraphBadge
const RT = Symbol("nkdRuntimeBadge")   // marca nuestro badge en el nodo para hallarlo/quitarlo

let cfg = null
let running = null       // id del nodo en ejecución
let runningStart = 0

function nodeById(id) {
  return app.graph?.getNodeById?.(id) ?? null
}

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

function setTime(id, ms) {
  const node = nodeById(id)
  if (!node) return
  const b = badgeFor(node)
  if (b) { b.text = formatRuntime(ms); app.canvas?.setDirty(true, true) }
}

// Quita nuestros badges de todos los nodos (al reiniciar una cola o al apagar).
export function clearRuntimeBadges() {
  running = null
  for (const node of app.graph?._nodes || []) {
    const b = node[RT]
    if (!b) continue
    if (Array.isArray(node.badges)) node.badges = node.badges.filter(x => x !== b)
    node[RT] = null
  }
  app.canvas?.setDirty(true, true)
}

export function installNodeRuntime(state) {
  cfg = state

  api.addEventListener("execution_start", () => {
    if (!cfg?.nodeRuntime) return
    clearRuntimeBadges()
  })

  api.addEventListener("executing", (e) => {
    if (!cfg?.nodeRuntime) return
    const id = idOf(e.detail)
    const now = performance.now()
    if (running != null) setTime(running, now - runningStart)   // el anterior terminó
    running = id
    runningStart = now
    if (id == null) running = null                              // fin de la cola
  })

  // Red de seguridad por si `executing:null` no llega: cerrar el último al acabar.
  api.addEventListener("execution_success", () => {
    if (!cfg?.nodeRuntime || running == null) return
    setTime(running, performance.now() - runningStart)
    running = null
  })
}
