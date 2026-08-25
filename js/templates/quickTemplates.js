// Invocar plantillas de nodos guardadas con Alt+1..9 (Fase 2).
//
// Las node templates ya NO viven en localStorage['Comfy.NodeTemplates'] —eso era el
// frontend antiguo, que es lo que copiaba Easy-Use v1—: el frontend moderno las
// guarda en un fichero de userdata del servidor (`comfy.templates.json`), que se
// lee por la API. El formato es el mismo: `[{name, data}]` con `data` = JSON string.
//
// Inserción: registrar los group-nodes que traiga la plantilla y pegar por el
// portapapeles de LiteGraph (litegrapheditor_clipboard + pasteFromClipboard, que
// SÍ sigue en localStorage). Opera sobre el MODELO del grafo → clásico y 2.0.
//
// El atajo va por listener CRUDO de teclado (como Easy-Use), no por keybinding
// declarativo (el combo alt+dígito declarativo no dispara en el frontend actual).
// Se usa e.code (`Digit1`..`Digit9`/numpad) = tecla FÍSICA → Windows y Mac sin el
// mapa de glyphs de Option que necesita e.key.
//
// ponytail: sin toggle propio (como el auto-arrange). Posición de pegado = la del
// core (junto al ratón); no se sobreescribe pasteFromClipboard para no pisar a nadie.

import { app } from "../../../scripts/app.js"
import { api } from "../../../scripts/api.js"
import { templateForSlot } from "./templateSlot.js"

const TEMPLATES_FILE = "/userdata/comfy.templates.json"
const CLIPBOARD_KEY = "litegrapheditor_clipboard"

async function loadTemplatesRaw() {
  try {
    const r = await api.fetchApi(TEMPLATES_FILE)
    return r.ok ? await r.text() : null
  } catch { return null }
}

export function installQuickTemplates() {
  window.addEventListener("keydown", (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)
    if (!m) return
    // No robar la tecla mientras se escribe en un campo.
    const el = document.activeElement
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return
    e.preventDefault()   // Alt+dígito no tiene otra función en el canvas
    insertTemplateSlot(Number(m[1]))
  }, true)
}

// Inserta la plantilla del slot N; no hace nada si no existe. Salva y restaura el
// portapapeles real para no pisar lo que el usuario tuviera copiado.
export async function insertTemplateSlot(slot) {
  const canvas = app.canvas
  if (!canvas?.pasteFromClipboard) return
  const tpl = templateForSlot(await loadTemplatesRaw(), slot)
  if (!tpl) return

  // Si la plantilla trae group-nodes hay que registrarlos antes de pegar o
  // saldrían como nodos ausentes (lo mismo que hace Easy-Use). Import perezoso y
  // tolerante: si este frontend no expone groupNode.js, se pega igual sin ellos.
  try {
    const data = JSON.parse(tpl.data)
    if (data?.groupNodes) {
      const { GroupNodeConfig } = await import("../../../extensions/core/groupNode.js")
      await GroupNodeConfig.registerFromWorkflow(data.groupNodes, {})
    }
  } catch { /* sin group-nodes o sin groupNode.js: se pega tal cual */ }

  const prev = localStorage.getItem(CLIPBOARD_KEY)
  try {
    localStorage.setItem(CLIPBOARD_KEY, tpl.data)
    canvas.pasteFromClipboard()   // el core envuelve en before/afterChange → un Ctrl+Z
  } finally {
    if (prev === null) localStorage.removeItem(CLIPBOARD_KEY)
    else localStorage.setItem(CLIPBOARD_KEY, prev)
  }
}
