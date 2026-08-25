// Índice compartido de modelos: fichero → {carpeta, pathIndex}. Se construye una
// vez desde los endpoints del core (`/experiment/models` + por carpeta) y lo usan
// tanto la preview al hover (comboPreview) como el guardado de preview (savePreview).

import { api } from "../../../scripts/api.js"

let index = null
let loading = null
const MODEL_EXTS = new Set([".safetensors", ".ckpt", ".pt", ".pth", ".sft", ".bin", ".gguf", ".pkl", ".pt2"])

async function build() {
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
  } catch { /* sin endpoint de modelos: índice vacío */ }
  return idx
}

export function ensureModelIndex() {
  if (index) return Promise.resolve(index)
  if (!loading) loading = build().then((i) => (index = i))
  return loading
}

// Info de un valor de combo si es un modelo conocido, o null. Síncrono (usa el
// índice ya cargado); llama antes a ensureModelIndex.
export function modelInfo(value) {
  return index?.get(value) ?? null
}
