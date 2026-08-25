// Guardar una imagen generada como preview de un modelo/LoRA. Clic derecho sobre
// un nodo con imágenes (Preview/Save Image) → "Save as model preview" → elige el
// modelo (de los referenciados en el grafo) → POST a la ruta de servidor del pack,
// que escribe el sidecar junto al modelo. Funciona en clásico y en Nodos 2.0
// (getExtraMenuOptions es la vía del menú de nodo en ambos).

import { app } from "../../../scripts/app.js"
import { api } from "../../../scripts/api.js"
import { ensureModelIndex, modelInfo } from "./modelIndex.js"

const ENDPOINT = "/nkd/reroutes/save_preview"

// {filename, subfolder, type} de una imagen de salida a partir de su URL.
function imageRef(img) {
  try {
    const u = new URL(img.src, location.origin)
    const filename = u.searchParams.get("filename")
    if (!filename) return null
    return { filename, subfolder: u.searchParams.get("subfolder") || "", type: u.searchParams.get("type") || "output" }
  } catch { return null }
}

function toast(severity, summary, detail) {
  app.extensionManager?.toast?.add?.({ severity, summary, detail, life: severity === "error" ? 5000 : 3000 })
}

async function save(img, target) {
  const image = imageRef(img)
  if (!image) { toast("error", "Preview not saved", "unrecognised image"); return }
  try {
    const r = await api.fetchApi(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folder: target.folder, filename: target.value, image }),
    })
    if (r.ok) { toast("success", "Preview saved", target.value); app.canvas?.setDirty?.(true, true) }
    else { const e = await r.json().catch(() => ({})); toast("error", "Preview not saved", e.error || r.status) }
  } catch (e) { toast("error", "Preview not saved", String(e).slice(0, 120)) }
}

// Modelos referenciados por algún widget del grafo (posibles destinos).
function modelTargets() {
  const seen = new Set(), out = []
  for (const node of app.graph?._nodes || []) {
    for (const w of node.widgets || []) {
      const v = w?.value
      if (typeof v !== "string" || seen.has(v)) continue
      const info = modelInfo(v)
      if (info) { seen.add(v); out.push({ value: v, folder: info.folder }) }
    }
  }
  return out
}

function currentImage(node) {
  if (!node.imgs?.length) return null
  const i = node.imageIndex ?? node.overIndex
  return (i != null ? node.imgs[i] : node.imgs[0]) || null
}

function addOption(node, options) {
  const img = currentImage(node)
  if (!img) return
  const targets = modelTargets()
  if (!targets.length) return
  options.unshift({
    content: "💾 Save as model preview",
    submenu: { options: targets.map((t) => ({ content: t.value, callback: () => save(img, t) })) },
  })
}

// Desde beforeRegisterNodeDef, para CADA tipo de nodo: envuelve getExtraMenuOptions
// y añade la opción cuando el nodo tiene imágenes.
export function wrapNodeMenu(nodeType) {
  const orig = nodeType.prototype.getExtraMenuOptions
  nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
    try { addOption(this, options) } catch { /* nunca romper el menú */ }
    return orig?.apply(this, arguments)
  }
}

export function installSavePreview() {
  ensureModelIndex()   // para que los destinos estén listos al abrir el menú
}
