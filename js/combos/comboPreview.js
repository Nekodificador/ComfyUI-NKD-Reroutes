// Previews de modelos al pasar el ratón por el combo (Fase 5) — SOLO clásico.
//
// Consume el endpoint del CORE (sin Python propio): `/experiment/models` lista las
// carpetas de modelos, `/experiment/models/{carpeta}` sus ficheros con pathIndex, y
// `/experiment/models/preview/{carpeta}/{pathIndex}/{fichero}` sirve la miniatura
// (del sidecar `*.preview.*` o de la portada embebida). Se construye un índice
// fichero→{carpeta,pathIndex} una vez, y al hover sobre una entrada de combo cuyo
// valor esté en el índice se muestra su miniatura; si el modelo no tiene preview el
// endpoint da 404 y no se muestra nada (onerror).
//
// En Nodos 2.0 los combos no usan `.litecontextmenu` (PrimeVue), así que esto no
// dispara — allí el sidebar Model Library ya enseña previews.
//
// ponytail: sin thumbnails-en-rejilla ni info de Civitai (eso pedía backend); sólo
// la miniatura al hover, que es el hueco que el core no cubre en el combo (#739).

import { app } from "../../../scripts/app.js"
import { api } from "../../../scripts/api.js"

let cfg = null
let _installed = false
let index = null            // Map<fichero, {folder, pathIndex}>
let indexLoading = null
const DONE = "__nkdComboPreview"
const IMG = 300

const MODEL_EXTS = new Set([".safetensors", ".ckpt", ".pt", ".pth", ".sft", ".bin", ".gguf", ".pkl", ".pt2"])

async function buildIndex() {
  const idx = new Map()
  try {
    const folders = await (await api.fetchApi("/experiment/models")).json()
    const modelFolders = (folders || []).filter((f) => (f.extensions || []).some((e) => MODEL_EXTS.has(e)))
    await Promise.all(modelFolders.map(async (f) => {
      try {
        const list = await (await api.fetchApi(`/experiment/models/${encodeURIComponent(f.name)}`)).json()
        for (const m of list || []) if (m?.name && !idx.has(m.name)) idx.set(m.name, { folder: f.name, pathIndex: m.pathIndex })
      } catch { /* carpeta sin listar: se ignora */ }
    }))
  } catch { /* sin endpoint de modelos: índice vacío, no hay previews */ }
  return idx
}

function ensureIndex() {
  if (index) return Promise.resolve(index)
  if (!indexLoading) indexLoading = buildIndex().then((i) => (index = i))
  return indexLoading
}

function previewSrc(folder, pathIndex, filename) {
  const path = `/experiment/models/preview/${encodeURIComponent(folder)}/${pathIndex}/${encodeURIComponent(filename)}`
  return api.apiURL ? api.apiURL(path) : `/api${path}`
}

let imgHost = null
let current = null                       // entrada cuya preview se está pidiendo
function host() {
  if (!imgHost) { imgHost = document.createElement("img"); imgHost.className = "nkd-combo-preview" }
  return imgHost
}
function hide() { current = null; imgHost?.remove() }

function show(entry, info, value) {
  current = entry
  const img = host()
  // Sólo se muestra al CARGAR: así un modelo sin preview (404) no deja ver la caja
  // vacía un instante. El guard `current` evita mostrar una carga tardía si el
  // ratón ya se movió a otra entrada.
  img.onload = () => {
    if (current !== entry) return
    const scale = Math.min(1, IMG / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale)
    const r = entry.getBoundingClientRect()
    let left = r.right
    if (left + w > document.body.clientWidth) left = r.left - w
    const top = Math.max(4, Math.min(r.top - h / 2, window.innerHeight - h - 4))
    img.style.left = `${Math.round(left)}px`
    img.style.top = `${Math.round(top)}px`
    document.body.appendChild(img)
  }
  img.onerror = () => { if (current === entry) img.remove() }
  img.src = previewSrc(info.folder, info.pathIndex, value)
}

function injectCss() {
  if (document.getElementById("nkd-combo-preview-styles")) return
  const s = document.createElement("style")
  s.id = "nkd-combo-preview-styles"
  s.textContent = `
.nkd-combo-preview {
  position: absolute;
  max-width: ${IMG}px; max-height: ${IMG}px;
  width: auto; height: auto;
  pointer-events: none; z-index: 10000;
  border-radius: 6px;
  box-shadow: 0 4px 18px rgba(0,0,0,0.55);
}
`
  document.head.appendChild(s)
}

function processMenu(menu) {
  if (!cfg?.comboPreviews || menu[DONE] || !index) return
  if (!menu.querySelector(".comfy-context-menu-filter")) return   // sólo menús de combo
  let any = false
  for (const entry of menu.querySelectorAll(".litemenu-entry")) {
    const value = entry.getAttribute("data-value")
    const info = value && index.get(value)
    if (!info) continue
    any = true
    entry.addEventListener("mouseover", () => show(entry, info, value), { passive: true })
    entry.addEventListener("mouseout", hide, { passive: true })
    entry.addEventListener("click", hide, { passive: true })
  }
  if (any) menu[DONE] = true
}

export function installComboPreviews(state) {
  cfg = state
  if (_installed) return
  _installed = true
  injectCss()
  ensureIndex()                          // precargar el índice en segundo plano
  const obs = new MutationObserver((muts) => {
    if (!cfg?.comboPreviews) return
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList?.contains("litecontextmenu")) {
          // Esperar al índice (la 1ª vez) y a que el core cree las entradas.
          ensureIndex().then(() => requestAnimationFrame(() => processMenu(n)))
        }
      }
    }
  })
  obs.observe(document.body, { childList: true })
}
