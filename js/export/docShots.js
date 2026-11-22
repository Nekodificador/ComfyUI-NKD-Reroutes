// Capturas para la documentación de un pack NKD, por lotes y sin diálogo.
// Pensado para que lo lance un agente (la skill nkd-readme) desde el navegador:
//
//   await NKDReroutes.renderNodeShots({ pack: "ComfyUI-NKD-Basic-Tools" })
//     → cada nodo del pack, suelto, fondo transparente, sin workflow dentro,
//       a ×2 → <pack>/docs/img/<Tipo>.png
//   await NKDReroutes.renderTemplateThumbs({ pack: "ComfyUI-NKD-Basic-Tools" })
//     → cada workflow de example_workflows con el fondo del tema → <nombre>.jpg
//       al lado de su JSON: la miniatura que enseña la galería de plantillas.
//
// Usa el mismo renderizador que «Export workflow image», así que respeta el modo
// (Nodes 2.0 o clásico). En Nodes 2.0 la página tiene que estar VISIBLE: Vue no
// pinta en una pestaña oculta y la captura se quedaría esperando.
import { app } from "../../../scripts/app.js"
import { api } from "../../../scripts/api.js"
import { renderWorkflow } from "./workflowImage.js"

const DOC_SCALE = 2          // nítido en pantallas densas y en la web de GitHub
const DOC_PADDING = 16       // aire alrededor del nodo
const THUMB_MAX = 1280       // las miniaturas de la galería se ven pequeñas
const THUMB_QUALITY = 0.88

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Espera a que Vue haya montado lo que se acaba de crear. Si la página no pinta
// (oculta), lo dice en vez de colgarse para siempre.
async function settle() {
  const frame = new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const late = sleep(2000).then(() => "timeout")
  if (LiteGraph.vueNodesMode && (await Promise.race([frame, late])) === "timeout") {
    throw new Error("La página tiene que estar visible para capturar con Nodes 2.0")
  }
  await sleep(150)
}

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result).split(",")[1])
  r.onerror = reject
  r.readAsDataURL(blob)
})

async function save(pack, kind, name, blob) {
  const res = await api.fetchApi("/nkd/reroutes/save_doc_image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pack, kind, name, data: await toBase64(blob) }),
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`)
  return out
}

const encode = (canvas, type, quality) => new Promise((r) => canvas.toBlob(r, type, quality))

/** Tipos de nodo que registra un pack (por su módulo de Python). */
export function packNodeTypes(pack) {
  return Object.entries(LiteGraph.registered_node_types)
    .filter(([, cls]) => cls.nodeData?.python_module === `custom_nodes.${pack}`)
    .map(([type]) => type)
    .sort()
}

/** Un PNG transparente por nodo del pack, en <pack>/docs/img/<Tipo>.png. */
export async function renderNodeShots({ pack, types = packNodeTypes(pack), scale = DOC_SCALE } = {}) {
  if (!types.length) throw new Error(`Ningún nodo registrado para ${pack}`)
  await app.extensionManager.command.execute("Comfy.NewBlankWorkflow")
  await settle()
  const graph = app.canvas.graph
  const results = []
  for (const type of types) {
    const node = LiteGraph.createNode(type)
    if (!node) { results.push({ type, error: "no se pudo crear" }); continue }
    node.pos = [0, 0]
    graph.add(node)
    try {
      await settle()
      const canvas = await renderWorkflow({
        only: new Set([node]), background: "transparent", padding: DOC_PADDING, embed: false, scale,
      })
      const blob = await encode(canvas, "image/png")
      results.push({ type, ...(await save(pack, "node", type, blob)), size: [canvas.width, canvas.height] })
    } catch (e) {
      results.push({ type, error: String(e?.message ?? e) })
    } finally {
      graph.remove(node)
    }
  }
  return results
}

/** Una miniatura JPG por workflow de ejemplo del pack, junto a su JSON. */
export async function renderTemplateThumbs({ pack, names = null, maxSide = THUMB_MAX } = {}) {
  const all = await (await api.fetchApi("/workflow_templates")).json()
  const list = names ?? all[pack] ?? []
  if (!list.length) throw new Error(`${pack} no tiene workflows de ejemplo`)
  const results = []
  for (const name of list) {
    try {
      const wf = await (await fetch(api.apiURL(`/workflow_templates/${encodeURIComponent(pack)}/${encodeURIComponent(name)}.json`))).json()
      await app.extensionManager.command.execute("Comfy.NewBlankWorkflow")
      await app.loadGraphData(wf, true, true, name)
      await settle()
      const canvas = await renderWorkflow({ background: "ui", padding: 40, embed: false, maxSide })
      const blob = await encode(canvas, "image/jpeg", THUMB_QUALITY)
      results.push({ name, ...(await save(pack, "thumb", name, blob)), size: [canvas.width, canvas.height] })
    } catch (e) {
      results.push({ name, error: String(e?.message ?? e) })
    }
  }
  return results
}

window.NKDReroutes = { ...(window.NKDReroutes ?? {}), packNodeTypes, renderNodeShots, renderTemplateThumbs }
