// Exporta el workflow entero como WebP, con el workflow dentro (o sin él).
// Rehecho a partir de "Workflow Image" de pysssss/ComfyUI-Custom-Scripts (MIT):
// mismo truco de redimensionar el canvas al bounding del grafo y redibujar,
// pero en WebP (mucho más ligero que PNG para capturas de interfaz) y
// accesible desde el menú superior, la paleta de comandos y el clic derecho,
// así que funciona igual con Nodes 2.0.
//
// Nodes 2.0: los nodos son DOM de Vue y el canvas sólo pinta cables, grupos y
// rejilla. Se componen las dos capas (ver renderVue); si el rasterizado del
// DOM falla, se vuelve al aspecto clásico (renderClassic).
import { app } from "../../../scripts/app.js"
import { embedWorkflow } from "./webpWorkflow.js"

const PAD = 50
const MAX_SIDE = 16383 // tope del formato WebP
const QUALITY = 0.9    // con pérdida: ~3x menos que PNG y el texto sigue nítido

function graphBounds(graph) {
  const b = [Infinity, Infinity, -Infinity, -Infinity]
  const add = (r) => {
    b[0] = Math.min(b[0], r[0]); b[1] = Math.min(b[1], r[1])
    b[2] = Math.max(b[2], r[0] + r[2]); b[3] = Math.max(b[3], r[1] + r[3])
  }
  for (const n of graph._nodes ?? []) add(n.getBounding())
  for (const g of graph._groups ?? []) add(g._bounding ?? g.bounding)
  for (const r of graph.reroutes?.values?.() ?? []) add([r.pos[0], r.pos[1], 0, 0])
  if (!Number.isFinite(b[0])) return null
  return [b[0] - PAD, b[1] - PAD, b[2] + PAD, b[3] + PAD]
}

// Los textos multilínea son un <textarea> encima del canvas: no salen en el
// dibujo, así que se pintan aquí a mano en el hueco que les reserva el nodo.
// Las notas Markdown salen como texto plano, sin formato.
function drawTextWidgets(ctx, graph) {
  ctx.save()
  ctx.font = "12px Inter, Arial, sans-serif"
  ctx.textBaseline = "top"
  for (const node of graph._nodes ?? []) {
    if (node.flags?.collapsed) continue
    for (const w of node.widgets ?? []) {
      if ((w.type !== "customtext" && w.type !== "MARKDOWN") || w.hidden || typeof w.value !== "string") continue
      const x = node.pos[0] + 10, y = node.pos[1] + w.y
      const width = node.size[0] - 20, height = (w.computedHeight ?? 60) - 4
      if (width <= 0 || height <= 0) continue
      ctx.fillStyle = LiteGraph.WIDGET_BGCOLOR
      ctx.beginPath(); ctx.roundRect(x, y, width, height, 6); ctx.fill()
      ctx.save()
      ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip()
      ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR
      let ly = y + 6
      for (const line of wrap(ctx, w.value, width - 12)) {
        if (ly > y + height) break
        ctx.fillText(line, x + 6, ly)
        ly += 15
      }
      ctx.restore()
    }
  }
  ctx.restore()
}

function wrap(ctx, text, maxWidth) {
  const out = []
  for (const para of text.split("\n")) {
    let line = ""
    for (const word of para.split(" ")) {
      const test = line ? line + " " + word : word
      if (line && ctx.measureText(test).width > maxWidth) { out.push(line); line = word }
      else line = test
    }
    out.push(line)
  }
  return out
}

// Escala de la captura: la del monitor, salvo que un lado pase del tope.
const scaleFor = (w, h) => Math.min(window.devicePixelRatio || 1, MAX_SIDE / w, MAX_SIDE / h)

// Pone la cámara sobre el grafo entero y lo dibuja, síncrono. Devuelve la
// función que deja el canvas como estaba. `classic` apaga Nodes 2.0 sólo
// durante el dibujo. `passes` = 2 porque el ruteo PCB reparte pasillos y
// corrige alturas de socket con lo dibujado en el frame anterior, que aquí es
// otra geometría.
function drawFull(bounds, s, classic, passes) {
  const c = app.canvas, el = c.canvas, ctx = el.getContext("2d"), ds = c.ds
  const w = bounds[2] - bounds[0], h = bounds[3] - bounds[1]
  const saved = {
    scale: ds.scale, offset: [...ds.offset], viewport: ds.viewportSize,
    width: el.width, height: el.height, transform: ctx.getTransform(),
    vue: LiteGraph.vueNodesMode, info: c.render_info,
  }
  if (classic) LiteGraph.vueNodesMode = false
  c.render_info = false
  ds.scale = 1
  ds.offset = [-bounds[0], -bounds[1]]
  // El frontend moderno cachea el tamaño del viewport: sin esto sólo se
  // dibuja lo que cabía en pantalla.
  ds.viewportSize = [w, h]
  el.width = Math.round(w * s)
  el.height = Math.round(h * s)
  ctx.setTransform(s, 0, 0, s, 0, 0)
  for (let i = 0; i < passes; i++) c.draw(true, true)
  // Se devuelve antes de ceder ningún tick: en esas microtareas corre Vue.
  LiteGraph.vueNodesMode = saved.vue
  return () => {
    c.render_info = saved.info
    ds.scale = saved.scale
    ds.offset = saved.offset
    ds.viewportSize = saved.viewport
    el.width = saved.width
    el.height = saved.height
    ctx.setTransform(saved.transform)
  }
}

const toWebp = (canvas) => new Promise((r) => canvas.toBlob(r, "image/webp", QUALITY))
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()))

// Propiedades CSS que se copian al rasterizar los nodos de Vue. Por defecto
// html-to-image copia TODAS las calculadas (~870 por elemento): con 12 nodos
// la SVG intermedia pesaba 36 MB y tardaba 9 s. Con esta lista, 3,4 MB y 3 s,
// y comparada píxel a píxel con la copia completa sólo cambia el scroll de un
// textarea. Ojo: Tailwind 4 usa `translate`/`scale` sueltos y los iconos son
// `mask-image`; sin ellos salen sockets movidos y cuadros grises.
// La librería memoriza la lista en su primera llamada: no la llames antes sin ella.
const STYLE_PROPS = `display position top right bottom left z-index box-sizing width height
min-width min-height max-width max-height aspect-ratio
margin-top margin-right margin-bottom margin-left padding-top padding-right padding-bottom padding-left
flex-direction flex-wrap flex-grow flex-shrink flex-basis justify-content justify-items justify-self
align-items align-self align-content order gap row-gap column-gap
grid-template-columns grid-template-rows grid-template-areas grid-area grid-column-start grid-column-end
grid-row-start grid-row-end grid-auto-flow grid-auto-columns grid-auto-rows
overflow-x overflow-y visibility opacity transform transform-origin translate scale rotate isolation
mix-blend-mode filter backdrop-filter clip-path
mask-image mask-size mask-repeat mask-position mask-mode
-webkit-mask-image -webkit-mask-size -webkit-mask-repeat -webkit-mask-position
color background-color background-image background-size background-position background-repeat
background-clip background-origin
border-top-width border-right-width border-bottom-width border-left-width
border-top-style border-right-style border-bottom-style border-left-style
border-top-color border-right-color border-bottom-color border-left-color
border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius
outline-width outline-style outline-color outline-offset box-shadow text-shadow
font-family font-size font-weight font-style font-variant-numeric font-feature-settings line-height
letter-spacing text-align text-transform text-decoration-line text-decoration-color text-overflow
white-space word-break overflow-wrap vertical-align text-indent -webkit-line-clamp -webkit-box-orient
fill stroke stroke-width object-fit object-position content list-style-type`.split(/\s+/)

// Nodes 2.0 con su aspecto real, en dos capas: el canvas (rejilla, grupos,
// cables) tal cual lo pinta el modo 2.0 —los cables ya llegan a los sockets
// de Vue— y encima la capa DOM de los nodos rasterizada con html-to-image.
// Todos los nodos están en el DOM (no hay culling: medido con la cámara a
// 50 000 px) y se colocan con translate en coordenadas de grafo, así que basta
// con cambiar la transformación de la capa.
async function renderVue(bounds) {
  const layer = document.querySelector(".lg-node")?.parentElement
  if (!layer) return null
  await import("../vendor/html-to-image.js")
  const h2i = globalThis.htmlToImage
  const c = app.canvas
  const w = bounds[2] - bounds[0], h = bounds[3] - bounds[1], s = scaleFor(w, h)

  const out = document.createElement("canvas")
  const restore = drawFull(bounds, s, false, 2)
  try {
    out.width = c.canvas.width
    out.height = c.canvas.height
    out.getContext("2d").drawImage(c.canvas, 0, 0)
  } finally {
    restore()
    c.setDirty(true, true)
    c.draw(true, true)
  }

  // Alejado el zoom, Vue pinta los nodos simplificados (LOD). Se desactiva
  // mientras se rasteriza y se espera a que Vue lo aplique.
  const lod = c.min_font_size_for_lod
  c.min_font_size_for_lod = 0
  c.setDirty(true, true)
  try {
    await nextFrame(); await nextFrame()
    const nodes = await h2i.toCanvas(layer, {
      width: w, height: h, pixelRatio: s,
      fontEmbedCSS: await h2i.getFontEmbedCSS(layer),
      includeStyleProperties: STYLE_PROPS,
      style: {
        transform: `translate(${-bounds[0]}px, ${-bounds[1]}px)`, transformOrigin: "0 0",
        width: w + "px", height: h + "px", inset: "auto", left: "0", top: "0",
      },
    })
    out.getContext("2d").drawImage(nodes, 0, 0, out.width, out.height)
  } finally {
    c.min_font_size_for_lod = lod
    c.setDirty(true, true)
  }
  return { blob: await toWebp(out), width: out.width, height: out.height }
}

// Canvas clásico (y plan B de Nodes 2.0 si el rasterizado del DOM falla):
// los nodos los pinta LiteGraph, con aspecto clásico.
async function renderClassic(bounds) {
  const c = app.canvas, el = c.canvas, ctx = el.getContext("2d")
  const w = bounds[2] - bounds[0], h = bounds[3] - bounds[1], s = scaleFor(w, h)
  const vue = LiteGraph.vueNodesMode

  // El dibujo clásico añade a los nodos con imagen un widget de preview que
  // en Nodes 2.0 no tienen; sin quitarlo, exportar cambiaría el workflow.
  const hadPreview = new Set(c.graph._nodes.filter(hasPreviewWidget))
  // Un LoadImage recién abierto en Nodes 2.0 no tiene su imagen en el modelo
  // (la pinta Vue leyendo el widget). Re-disparar el callback del combo la
  // registra como lo haría el canvas clásico; no cambia el workflow.
  const waitFor = new Set(hadPreview)
  if (vue) {
    for (const n of c.graph._nodes) {
      if (n.imgs?.length || !n.widgets?.some((w) => w.name === "upload")) continue
      const combo = n.widgets.find((w) => w.name === "image" && w.type === "combo")
      if (combo?.value) { combo.callback?.(combo.value); waitFor.add(n) }
    }
  }
  let restore = null
  try {
    // Pasada previa: en Nodes 2.0 las imágenes de los nodos sólo se cargan
    // cuando el canvas clásico las pide. Se piden, se espera a que lleguen
    // con la vista ya devuelta, y luego se captura.
    drawFull(bounds, s, true, 1)()
    await imagesReady(c.graph, waitFor)
    restore = drawFull(bounds, s, true, 2)
    // Las previews de imagen no se pintan en draw(): se encolan y salen en
    // una microtarea. Sin ceder este tick, toBlob las pierde.
    await Promise.resolve()
    ctx.setTransform(s, 0, 0, s, -bounds[0] * s, -bounds[1] * s)
    drawTextWidgets(ctx, c.graph)
    return { blob: await toWebp(el), width: el.width, height: el.height }
  } finally {
    restore?.()
    for (const n of c.graph._nodes) {
      if (hadPreview.has(n)) continue
      const i = n.widgets?.findIndex((w) => w.name === PREVIEW_WIDGET) ?? -1
      if (i > -1) { n.widgets[i].onRemove?.(); n.widgets.splice(i, 1) }
    }
    c.setDirty(true, true)
    c.draw(true, true)
  }
}

async function render(bounds) {
  if (LiteGraph.vueNodesMode) {
    try {
      const shot = await renderVue(bounds)
      if (shot) return shot
    } catch (e) {
      console.warn("[NKD Reroutes] Nodes 2.0 capture failed, using the classic look", e)
    }
  }
  return renderClassic(bounds)
}

const PREVIEW_WIDGET = "$$canvas-image-preview"
const hasPreviewWidget = (n) => n.widgets?.some((w) => w.name === PREVIEW_WIDGET)

// Espera (como mucho 3 s) a que los nodos con preview tengan sus imágenes.
async function imagesReady(graph, extra) {
  const ready = () => graph._nodes.every((n) =>
    !(extra.has(n) || hasPreviewWidget(n)) || (n.imgs?.length && n.imgs.every((i) => i.complete)))
  for (let t = 0; t < 60 && !ready(); t++) await new Promise((r) => setTimeout(r, 50))
}

function fileName() {
  const name = app.extensionManager?.workflow?.activeWorkflow?.filename
  return (name || "workflow").replace(/[\\/:*?"<>|]/g, "_") + ".webp"
}

function download(blob, name) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name })
  document.body.append(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 0)
}

function toast(severity, detail) {
  app.extensionManager?.toast?.add?.({ severity, summary: "Workflow image", detail, life: 4000 })
}

export async function exportWorkflowImage(withWorkflow) {
  try {
    const bounds = graphBounds(app.canvas.graph)
    if (!bounds) return toast("warn", "The workflow is empty.")
    const { blob, width, height } = await render(bounds)
    if (blob?.type !== "image/webp") return toast("error", "This browser can't encode WebP.")
    let out = blob
    if (withWorkflow) {
      const json = JSON.stringify(app.graph.serialize())
      const bytes = embedWorkflow(new Uint8Array(await blob.arrayBuffer()), json, width, height)
      out = new Blob([bytes], { type: "image/webp" })
    }
    download(out, fileName())
  } catch (e) {
    console.error("[NKD Reroutes] workflow image export failed", e)
    toast("error", String(e?.message ?? e))
  }
}

// La carga no necesita código propio: app.handleFile ya lee el workflow de un
// WebP (y de un PNG). Esto sólo abre el selector de ficheros.
export function importWorkflowImage() {
  const input = Object.assign(document.createElement("input"), { type: "file", accept: ".webp,.png,image/webp,image/png" })
  input.onchange = () => input.files[0] && app.handleFile(input.files[0])
  input.click()
}

export const WORKFLOW_IMAGE_COMMANDS = [
  { id: "nkd.reroutes.exportWorkflowImage", label: "Export workflow image (WebP)", icon: "pi pi-image", function: () => exportWorkflowImage(true) },
  { id: "nkd.reroutes.exportWorkflowImageBare", label: "Export workflow image (WebP, no embedded workflow)", icon: "pi pi-image", function: () => exportWorkflowImage(false) },
  { id: "nkd.reroutes.importWorkflowImage", label: "Import workflow image", icon: "pi pi-upload", function: importWorkflowImage },
]

export function workflowImageMenuItems() {
  return [null, {
    content: "Workflow Image (WebP)",
    submenu: {
      options: [
        { content: "Export WebP", callback: () => exportWorkflowImage(true) },
        { content: "Export WebP (no embedded workflow)", callback: () => exportWorkflowImage(false) },
        { content: "Import…", callback: importWorkflowImage },
      ],
    },
  }]
}
