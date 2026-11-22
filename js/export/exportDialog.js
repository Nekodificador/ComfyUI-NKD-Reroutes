// Diálogo de «Export workflow image…». DOM propio y mínimo, con los tokens de
// color del tema para que se vea igual en clásico y Nodes 2.0. No conoce el
// canvas: recibe `render(opts)` (devuelve un <canvas> o null) y `onExport(opts)`.

const THUMB_W = 520, THUMB_H = 300

const CSS = `
.nkd-xd-back{position:fixed;inset:0;z-index:10000;background:#0008;display:flex;align-items:center;justify-content:center}
.nkd-xd{width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;
  background:var(--comfy-menu-bg,#222);color:var(--fg-color,#ddd);border:1px solid var(--border-color,#444);
  border-radius:10px;padding:16px;font:13px/1.4 Inter,Arial,sans-serif;box-shadow:0 10px 40px #0009}
.nkd-xd h3{margin:0 0 12px;font-size:15px;font-weight:600}
.nkd-xd .thumb{height:${THUMB_H}px;border-radius:6px;margin-bottom:12px;display:flex;align-items:center;justify-content:center;
  background:repeating-conic-gradient(#8883 0 25%,transparent 0 50%) 0 0/16px 16px;position:relative;overflow:hidden}
.nkd-xd .thumb img{max-width:100%;max-height:100%}
.nkd-xd .thumb span{position:absolute;bottom:6px;right:8px;font-size:11px;opacity:.7}
.nkd-xd .row{display:flex;align-items:center;gap:10px;margin:8px 0}
.nkd-xd .row>label:first-child{width:130px;opacity:.8}
.nkd-xd select,.nkd-xd input[type=number]{background:var(--comfy-input-bg,#111);color:inherit;border:1px solid var(--border-color,#444);border-radius:5px;padding:4px 6px}
.nkd-xd input[type=number]{width:90px}
.nkd-xd .seg{display:flex;gap:4px}
.nkd-xd .seg button{background:var(--comfy-input-bg,#111);color:inherit;border:1px solid var(--border-color,#444);border-radius:5px;padding:4px 10px;cursor:pointer}
.nkd-xd .seg button.on{border-color:var(--p-primary-color,#4a90e2);background:color-mix(in srgb,var(--p-primary-color,#4a90e2) 25%,transparent)}
.nkd-xd details{margin-top:8px}.nkd-xd summary{cursor:pointer;opacity:.8}
.nkd-xd .foot{display:flex;align-items:center;gap:8px;margin-top:16px}
.nkd-xd .foot .reset{margin-right:auto;background:none;border:0;color:inherit;opacity:.6;text-decoration:underline;cursor:pointer;padding:0}
.nkd-xd .foot button.btn{border-radius:6px;padding:6px 14px;cursor:pointer;border:1px solid var(--border-color,#444);background:transparent;color:inherit}
.nkd-xd .foot button.go{background:var(--p-primary-color,#4a90e2);border-color:transparent;color:#fff}
.nkd-xd button:disabled{opacity:.5;cursor:default}`

function ensureCss() {
  if (document.getElementById("nkd-xd-css")) return
  document.head.append(Object.assign(document.createElement("style"), { id: "nkd-xd-css", textContent: CSS }))
}

const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props)
  el.append(...kids.filter(k => k != null))
  return el
}

export function openExportDialog({ initial, defaults, selectionCount = 0, render, onExport }) {
  ensureCss()
  let opts = { ...initial }
  let thumbTimer = 0, thumbToken = 0

  const img = h("img", { alt: "" })
  const info = h("span")
  const thumb = h("div", { className: "thumb" }, img, info)

  const seg = (key, choices) => {
    const wrap = h("div", { className: "seg" })
    const paint = () => [...wrap.children].forEach(b => b.classList.toggle("on", b.dataset.v === String(opts[key])))
    for (const [v, label] of choices) {
      wrap.append(h("button", { type: "button", textContent: label, onclick: () => { set(key, v); paint() } }))
      wrap.lastChild.dataset.v = String(v)
    }
    paint()
    return Object.assign(wrap, { paint })
  }
  const num = (key, min, max, step) => h("input", { type: "number", min, max, step, value: opts[key],
    oninput: (e) => set(key, Number(e.target.value)) })

  const format = seg("format", [["webp", "WebP"], ["png", "PNG"]])
  const embed = h("input", { type: "checkbox", checked: opts.embed, onchange: (e) => set("embed", e.target.checked) })
  // Sólo la selección: la imagen y el workflow de dentro son sólo esos nodos
  // (un subgraph seleccionado sale aislado, con sus widgets).
  const onlySel = h("input", { type: "checkbox", checked: !!opts.onlySelection, onchange: (e) => set("onlySelection", e.target.checked) })
  // Con la selección: el resto del workflow a esta opacidad (0 = no se ve).
  const dim = h("input", { type: "range", min: 0, max: 90, step: 5, value: opts.dim ?? 0, style: "flex:1",
    oninput: (e) => set("dim", Number(e.target.value)) })
  const dimLabel = h("small", { style: "opacity:.6;min-width:3em" })
  const background = seg("background", [["ui", "Theme"], ["transparent", "Transparent"], ["solid", "Solid"]])
  const color = h("input", { type: "color", value: opts.color, oninput: (e) => set("color", e.target.value) })
  const padding = num("padding", 0, 500, 10)
  const maxSide = num("maxSide", 256, 16383, 256)

  // Branding: pie con logo y texto en una franja aparte bajo la imagen.
  const brand = h("input", { type: "checkbox", checked: !!opts.brand, onchange: (e) => set("brand", e.target.checked) })
  const brandText = h("input", { type: "text", value: opts.brandText ?? "", placeholder: "{title} · your name or site · {date}",
    style: "flex:1;background:var(--comfy-input-bg,#111);color:inherit;border:1px solid var(--border-color,#444);border-radius:5px;padding:4px 6px",
    oninput: (e) => set("brandText", e.target.value) })
  const logoImg = h("img", { alt: "", style: "height:24px;max-width:96px;object-fit:contain" })
  const logoPick = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/svg+xml", style: "display:none",
    onchange: (e) => {
      const f = e.target.files?.[0]
      if (!f) return
      const r = new FileReader()
      r.onload = () => set("brandLogo", String(r.result))
      r.readAsDataURL(f)
    } })
  const btn = "background:var(--comfy-input-bg,#111);color:inherit;border:1px solid var(--border-color,#444);border-radius:5px;padding:4px 10px;cursor:pointer"
  const logoBtn = h("button", { type: "button", textContent: "Choose logo…", style: btn, onclick: () => logoPick.click() })
  const logoClear = h("button", { type: "button", textContent: "✕", title: "Remove logo", style: btn, onclick: () => set("brandLogo", "") })

  const row = (label, ...kids) => h("div", { className: "row" }, h("label", { textContent: label }), ...kids)
  const go = h("button", { type: "button", className: "btn go", textContent: "Export" })
  const cancel = h("button", { type: "button", className: "btn", textContent: "Cancel", onclick: close })
  const reset = h("button", { type: "button", className: "reset", textContent: "Reset to defaults" })

  const dialog = h("div", { className: "nkd-xd" },
    h("h3", { textContent: "Export workflow image" }),
    thumb,
    selectionCount ? row("Only selection", onlySel, h("small", { textContent: `${selectionCount} selected node${selectionCount > 1 ? "s" : ""}`, style: "opacity:.6" })) : null,
    selectionCount ? row("Show the rest", dim, dimLabel) : null,
    row("Format", format),
    row("Embed workflow", embed),
    row("Background", background, color),
    row("Padding (px)", padding),
    row("Footer", brand, h("small", { textContent: "logo and text under the image", style: "opacity:.6" })),
    row("Footer text", brandText),
    row("Logo", logoImg, logoBtn, logoClear, logoPick),
    h("details", {}, h("summary", { textContent: "Advanced" }),
      row("Max long edge (px)", maxSide, h("small", { textContent: "larger images are scaled down", style: "opacity:.6" }))),
    h("div", { className: "foot" }, reset, cancel, go))
  const back = h("div", { className: "nkd-xd-back", onmousedown: (e) => { if (e.target === back) close() } }, dialog)

  function sync() {
    color.style.visibility = opts.background === "solid" ? "visible" : "hidden"
    embed.checked = opts.embed
    brand.checked = !!opts.brand
    brandText.disabled = logoBtn.disabled = logoClear.disabled = !opts.brand
    if (document.activeElement !== brandText) brandText.value = opts.brandText ?? ""
    if (opts.brandLogo) logoImg.src = opts.brandLogo; else logoImg.removeAttribute("src")
    logoClear.style.visibility = opts.brandLogo ? "visible" : "hidden"
    onlySel.checked = !!opts.onlySelection
    dim.value = opts.dim ?? 0
    dim.disabled = !opts.onlySelection
    dimLabel.textContent = opts.dim ? `${opts.dim} %` : "hidden"
    color.value = opts.color
    padding.value = opts.padding
    maxSide.value = opts.maxSide
    format.paint(); background.paint()
  }
  function set(key, value) {
    opts = { ...opts, [key]: value }
    sync()
    if (key === "background" || key === "color" || key === "padding" || key === "onlySelection" || key === "dim" || key.startsWith("brand")) queueThumb()
  }
  // El logo y el texto del pie se conservan: son tuyos, no un ajuste de la exportación.
  reset.onclick = () => {
    opts = { ...defaults, onlySelection: opts.onlySelection, brandLogo: opts.brandLogo, brandText: opts.brandText }
    sync(); queueThumb()
  }

  // Miniatura con el renderizador de verdad (lo que ves es lo que sale), a
  // escala reducida y sin cada pulsación: en Nodes 2.0 rasterizar tarda.
  function queueThumb() {
    clearTimeout(thumbTimer)
    thumbTimer = setTimeout(drawThumb, 350)
  }
  async function drawThumb() {
    const token = ++thumbToken
    info.textContent = "Rendering…"
    try {
      const fit = (w, h) => Math.min(THUMB_W / w, THUMB_H / h) * (window.devicePixelRatio || 1)
      const cv = await render({ ...opts, scale: fit })
      if (token !== thumbToken || !back.isConnected) return
      if (!cv) { info.textContent = "The workflow is empty."; img.removeAttribute("src"); go.disabled = true; return }
      img.src = cv.toDataURL()
      info.textContent = ""
    } catch (e) {
      if (token === thumbToken) info.textContent = "Preview failed (export may still work)"
      console.warn("[NKD Reroutes] preview", e)
    }
  }

  go.onclick = async () => {
    go.disabled = cancel.disabled = true
    go.textContent = "Exporting…"
    try { await onExport(opts) } finally { close() }
  }
  function onKey(e) {
    if (e.key === "Escape") { e.stopPropagation(); close() }
    else if (e.key === "Enter" && !go.disabled && e.target.tagName !== "BUTTON") { e.stopPropagation(); go.click() }
  }
  function close() {
    clearTimeout(thumbTimer)
    removeEventListener("keydown", onKey, true)
    back.remove()
  }

  addEventListener("keydown", onKey, true)
  document.body.append(back)
  sync()
  drawThumb()
}
