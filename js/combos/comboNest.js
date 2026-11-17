// Combos en subcarpetas + filtro recursivo (Fase 4) — SOLO canvas clásico.
//
// En el canvas clásico un combo abre un `.litecontextmenu` con todas las opciones
// como `.litemenu-entry`. Este adaptador las reorganiza en carpetas (partiendo por
// "/" o "\") SIN romper el filtro del core: mantiene cada entrada real (con su
// handler de clic), le pone el nombre corto visible y mete la RUTA COMPLETA en un
// `<span>` oculto dentro de la entrada. Como el filtro del core matchea el
// `textContent` de la entrada (que incluye ese span aunque esté oculto), buscar
// encuentra la hoja esté en la subcarpeta que esté. Una regla CSS aplana el árbol
// mientras el filtro tiene texto. Mecanismo calcado de pysssss betterCombos (MIT).
//
// En Nodos 2.0 el combo lo pinta reka-ui como lista plana. Ahí se intercepta el clic
// y se abre este mismo menú clásico (ver `onVueClick`), así que todo lo de abajo vale
// igual en los dos renderizadores.
//
// ponytail: sin previews/thumbnails ni modo grid (eso es de pysssss y lleva
// backend). Aquí sólo carpetas + filtro recursivo.

import { app } from "../../../scripts/app.js"
import { buildComboTree } from "./buildComboTree.js"
import { fuzzyMatch } from "./fuzzyMatch.js"

let cfg = null
let _installed = false
const THRESHOLD = 10                 // no anidar combos pequeños
const SPLIT = /[\\/]/
const DONE = "__nkdComboNested"

function injectCss() {
  if (document.getElementById("nkd-combo-styles")) return
  const s = document.createElement("style")
  s.id = "nkd-combo-styles"
  s.textContent = `
.nkd-combo-folder { opacity: 0.8; cursor: pointer; }
.nkd-combo-folder-arrow { display: inline-block; width: 14px; }
.nkd-combo-folder:hover { background-color: rgba(255,255,255,0.1); }
.nkd-combo-prefix { display: none; opacity: 0.55; }

/* Con el filtro escrito: aplanar el árbol y revelar la ruta, para que el filtro
   del core (que matchea textContent) busque por toda la profundidad. */
.litecontextmenu:has(input:not(:placeholder-shown)) .nkd-combo-folder-contents { display: block !important; }
.litecontextmenu:has(input:not(:placeholder-shown)) .nkd-combo-folder { display: none !important; }
.litecontextmenu:has(input:not(:placeholder-shown)) .nkd-combo-prefix { display: inline; }
.litecontextmenu:has(input:not(:placeholder-shown)) .litemenu-entry { padding-left: 2px !important; }

/* Entrada resaltada por navegación con teclado. */
.nkd-combo-kbd { background-color: #2a4a6b !important; color: #fff !important; }

/* Abierto desde Nodos 2.0: mismo aspecto que el desplegable nativo de reka (medido:
   Inter 12px, filas de 32px, radio 8px, buscador con lupa y borde). Sólo estética. */
.litecontextmenu.nkd-vue-combo {
  background: var(--base-background, #13171d) !important; color: var(--base-foreground, #e5eaf0) !important;
  border: 1px solid var(--border-default, #3d4148) !important; border-radius: 8px !important;
  box-shadow: 1px 1px 8px rgba(0,0,0,0.4) !important; padding: 4px !important;
  font: 12px Inter, Arial, sans-serif !important; min-width: var(--nkd-w, 0); box-sizing: border-box;
}
.nkd-vue-combo .comfy-context-menu-filter {
  display: block; width: 100%; box-sizing: border-box; margin: 0 0 4px; padding: 6px 8px 6px 30px;
  border: 1px solid var(--border-default, #3d4148); border-radius: 6px; outline: none;
  background: transparent url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.3-4.3'/%3E%3C/svg%3E") no-repeat 9px center;
  color: inherit; font: inherit;
}
.nkd-vue-combo .comfy-context-menu-filter:focus { border-color: var(--ring, #999); }
.nkd-vue-combo .litemenu-entry {
  height: 32px; line-height: 32px; box-sizing: border-box; padding-right: 8px !important; margin: 0;
  border-radius: 4px; border: none !important; background: transparent !important;
  color: var(--base-foreground, #e5eaf0) !important; font-size: 12px !important; white-space: nowrap;
}
.nkd-vue-combo .litemenu-entry:hover, .nkd-vue-combo .nkd-combo-kbd {
  background: var(--secondary-background-hover, #262a30) !important;
}
.nkd-vue-combo .nkd-combo-folder { opacity: 1; color: var(--muted-foreground, #999) !important; }
.nkd-vue-combo .nkd-combo-folder-arrow { font-size: 9px; }
.nkd-vue-combo .nkd-combo-current { background: color-mix(in srgb, var(--base-foreground, #fff) 10%, transparent) !important; }
.nkd-vue-combo .nkd-combo-current::after { content: "✓"; float: right; padding-left: 12px; }
`
  document.head.appendChild(s)
}

function valueOf(entry) {
  return entry.getAttribute("data-value") ?? entry.textContent ?? ""
}

function buildTreeDom(menu, entries) {
  const byValue = new Map(entries.map((e) => [valueOf(e), e]))
  const tree = buildComboTree(entries.map(valueOf), SPLIT)
  const parent = entries[0].parentElement
  if (!parent) return

  const relabel = (entry, value, label) => {
    entry.textContent = label
    const prefix = value.slice(0, value.length - label.length)   // "a/b/"
    if (prefix) {
      const span = document.createElement("span")
      span.className = "nkd-combo-prefix"
      span.textContent = prefix
      entry.prepend(span)
    }
  }

  const render = (node, container, depth) => {
    for (const leaf of node.leaves) {
      const entry = byValue.get(leaf.value)
      if (!entry) continue
      relabel(entry, leaf.value, leaf.label)
      entry.style.paddingLeft = `${depth * 12 + 14}px`
      container.appendChild(entry)                 // mueve la entrada REAL aquí
    }
    for (const folder of node.folders) {
      const fol = document.createElement("div")
      fol.className = "litemenu-entry nkd-combo-folder"
      fol.style.paddingLeft = `${depth * 12 + 5}px`
      fol.innerHTML = `<span class="nkd-combo-folder-arrow">▶</span> ${folder.name}`
      container.appendChild(fol)

      const contents = document.createElement("div")
      contents.className = "nkd-combo-folder-contents"
      contents.style.display = "none"
      container.appendChild(contents)

      render(folder.node, contents, depth + 1)

      fol.addEventListener("click", (ev) => {
        ev.stopPropagation()
        const arrow = fol.querySelector(".nkd-combo-folder-arrow")
        const open = contents.style.display !== "none"
        contents.style.display = open ? "none" : "block"
        if (arrow) arrow.textContent = open ? "▶" : "▼"
      })
    }
  }

  render(tree, parent, 0)
}

// Al agrupar en carpetas el menú se encoge mucho, pero el core lo posicionó para
// la lista larga (acababa pegado al techo). Se recoloca junto al ratón y se acota
// la altura a la pantalla. Calcado de pysssss (last_mouse es coord de cliente).
function reposition(menu) {
  const mouse = _openAt ?? app.canvas?.last_mouse
  _openAt = null
  const rect = menu.getBoundingClientRect()
  // Sin ratón fiable ([0,0] = inactivo): no mover al rincón, sólo acotar la altura.
  if (!mouse || (mouse[0] === 0 && mouse[1] === 0)) {
    const t = Math.max(4, rect.top)
    menu.style.maxHeight = `${Math.round(window.innerHeight - t - 12)}px`
    menu.style.overflowY = "auto"
    return
  }
  const body = document.body.getBoundingClientRect()
  let left = mouse[0] - 10
  let top = mouse[1] - 10
  if (body.width && left > body.width - rect.width - 10) left = body.width - rect.width - 10
  if (body.height && top > body.height - rect.height - 10) top = body.height - rect.height - 10
  left = Math.max(0, left)
  top = Math.max(0, top)
  menu.style.left = `${Math.round(left)}px`
  menu.style.top = `${Math.round(top)}px`
  menu.style.maxHeight = `${Math.round(window.innerHeight - top - 12)}px`
  menu.style.overflowY = "auto"
}

// Búsqueda fuzzy: sustituye el substring del filtro del core por match por
// subsecuencia. Se engancha un listener 'input' propio en el filtro; corre DESPUÉS
// del del core (registrado antes) y su display manda. Sólo cuenta las hojas
// (`.litemenu-entry` que no sean cabeceras de carpeta).
function attachFuzzy(menu) {
  const input = menu.querySelector(".comfy-context-menu-filter")
  if (!input || input.__nkdFuzzy) return
  input.__nkdFuzzy = true
  input.addEventListener("input", () => {
    const term = input.value
    for (const entry of menu.querySelectorAll(".litemenu-entry")) {
      if (entry.classList.contains("nkd-combo-folder")) continue
      entry.style.display = fuzzyMatch(term, entry.textContent || "") ? "block" : "none"
    }
  })
}

function nestIfNeeded(menu) {
  if (!cfg?.comboNest || menu[DONE]) return
  // No duplicar si otra extensión (pysssss/nosotros) ya anidó este menú.
  if (menu.querySelector(".pysssss-combo-folder, .nkd-combo-folder")) return
  const entries = [...menu.querySelectorAll(".litemenu-entry")]
  if (entries.length < THRESHOLD) return
  if (!entries.some((e) => SPLIT.test(valueOf(e)))) return   // sin rutas, nada que anidar
  menu[DONE] = true
  try { buildTreeDom(menu, entries); reposition(menu) } catch (e) { console.warn("[NKD Reroutes] combo nest", e) }
}

// Navegación con teclado que respeta el set VISIBLE (fuzzy + carpetas), en vez de
// la del core, que recorre TODAS las entradas por índice en su orden original y se
// desincroniza con nuestra reorganización. Flechas ↑/↓ mueven el resaltado por las
// hojas visibles; Enter dispara el clic de la resaltada (o la primera).
//
// El listener va en CAPTURA sobre el MENÚ (ancestro del input): así corre ANTES que
// el keydown del core (que está en el propio input) y lo reemplaza con stopImmediate.
function attachKeyNav(menu) {
  if (menu.__nkdKeyNav) return
  const input = menu.querySelector(".comfy-context-menu-filter")
  if (!input) return
  menu.__nkdKeyNav = true
  const HI = "nkd-combo-kbd"
  let idx = -1
  const visibleLeaves = () => [...menu.querySelectorAll(".litemenu-entry")]
    .filter((e) => !e.classList.contains("nkd-combo-folder") && e.offsetParent !== null)
  const paint = (list) => {
    list.forEach((e, i) => e.classList.toggle(HI, i === idx))
    if (idx >= 0) list[idx]?.scrollIntoView({ block: "nearest" })
  }
  menu.addEventListener("keydown", (ev) => {
    if (ev.target !== input) return
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp" && ev.key !== "Enter") return
    ev.preventDefault(); ev.stopImmediatePropagation()
    const list = visibleLeaves()
    if (ev.key === "Enter") { (list[idx] || list[0])?.click(); return }
    if (!list.length) { idx = -1; return }
    idx = ev.key === "ArrowDown" ? (idx + 1) % list.length : (idx <= 0 ? list.length - 1 : idx - 1)
    paint(list)
  }, true)
  // Al filtrar cambia el set visible → reiniciar el resaltado.
  input.addEventListener("input", () => {
    idx = -1
    for (const e of menu.querySelectorAll("." + HI)) e.classList.remove(HI)
  })
}

function processMenu(menu) {
  // Sólo menús de COMBO: el core sólo les inyecta el filtro (cuando hay >4 opciones).
  if (!menu.querySelector(".comfy-context-menu-filter")) return
  if (cfg?.comboFuzzy) attachFuzzy(menu)   // fuzzy vale también en combos sin carpetas
  attachKeyNav(menu)                       // navegación con teclado sobre el set visible
  nestIfNeeded(menu)
}

// ── Nodos 2.0 ────────────────────────────────────────────────────────────────
// Truco descubierto por Kijai (KJNodes vue_combo.js): un `click` en CAPTURA de window
// sobre el disparador del combo de Vue corre antes que reka, así que se le puede
// quitar la apertura de su lista plana. Kijai abre ahí un panel propio y sólo para
// valores "carpeta/fichero.ext" (por eso los samplers de ClownShark, "multistep/res_2m",
// se quedaban planos). Aquí se abre el MENÚ CLÁSICO de LiteGraph con los mismos
// valores: el observer de abajo lo anida igual que en el canvas clásico, y con él
// vienen gratis el filtro recursivo, el fuzzy, el teclado y las previews de modelo.
const VUE_TRIGGER = '[data-testid="widget-select-default-trigger"]'
const VUE_OPENERS = `${VUE_TRIGGER}, button[aria-hidden="true"]:has(> i[class*="chevron-down"])`
let _openAt = null   // dónde recolocar el menú (coords de cliente); la siguiente reposition lo consume

function resolveVueCombo(trigger) {
  const nodeEl = trigger?.closest("[data-node-id]")
  if (!nodeEl || trigger.disabled) return null
  const node = app.canvas?.graph?.getNodeById(nodeEl.dataset.nodeId)
  const label = trigger.getAttribute("aria-label")
  // combos con la misma etiqueta (entradas promocionadas) se emparejan por orden en el DOM
  const twins = [...nodeEl.querySelectorAll(VUE_TRIGGER)].filter((t) => t.getAttribute("aria-label") === label)
  const widget = node?.widgets?.filter((w) => w.type === "combo" && (w.label || w.name) === label)[twins.indexOf(trigger)]
  if (!widget || widget.options?.getOptionLabel) return null   // opciones con etiqueta: no son rutas
  let values = widget.options?.values
  if (typeof values === "function") values = values(widget, node)
  return Array.isArray(values) ? { node, widget, values: values.filter((v) => v != null) } : null
}

function applyVueValue({ node, widget }, value) {
  if (value === widget.value) return
  if (widget.setValue) widget.setValue(value, { node, canvas: app.canvas })
  else {   // widgets promocionados de subgrafo: proyecciones sin setValue
    const old = widget.value
    widget.value = value
    widget.callback?.(value, app.canvas, node)
    node.onWidgetChanged?.(widget.name, value, old, widget)
  }
  const tracker = app.extensionManager?.workflow?.activeWorkflow?.changeTracker
  ;(tracker?.captureCanvasState ?? tracker?.checkState)?.call(tracker)
}

function onVueClick(e) {
  // Si otra extensión ya se quedó el clic (el modo carpetas de KJNodes), no abrir dos menús.
  if (!cfg?.comboNest || e.defaultPrevented) return
  const anchor = e.target.closest?.(VUE_OPENERS)?.parentElement
  const trigger = anchor?.querySelector(`:scope > ${VUE_TRIGGER}`)
  if (!trigger) return
  const combo = resolveVueCombo(trigger)
  if (!combo || combo.values.length < THRESHOLD || !combo.values.some((v) => SPLIT.test(String(v)))) return
  e.preventDefault()
  e.stopPropagation()
  const LG = window.LiteGraph
  if (!LG?.ContextMenu) return
  const r = anchor.getBoundingClientRect()
  _openAt = [r.left + 10, r.bottom + 10]           // reposition resta 10: queda justo debajo
  app.canvas.current_node = combo.node              // el filtro del core marca así el valor actual
  const menu = new LG.ContextMenu(combo.values, {
    event: e,
    className: "dark",                              // sin esto el core no le pone el filtro
    callback: (v) => applyVueValue(combo, v),       // sin `scale`: el nativo de 2.0 no se escala con el zoom
  })
  const root = menu.root
  if (!root) return
  root.classList.add("nkd-vue-combo")
  root.style.setProperty("--nkd-w", `${r.width}px`)
  // Doble rAF: el anidado corre en un rAF que el observer pide DESPUÉS de este handler.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const input = root.querySelector(".comfy-context-menu-filter")
    if (input) {
      input.placeholder = " "                       // vacío como el nativo; " " mantiene :placeholder-shown
      input.focus({ preventScroll: true })          // como el nativo: abrir y escribir
    }
    // El core pinta el valor actual en #ccc con estilo inline !important: se le quita y se
    // marca a la manera nativa, abriendo las carpetas que lo contienen.
    const cur = [...root.querySelectorAll(".litemenu-entry")].find((en) => valueOf(en) === String(combo.widget.value))
    if (!cur) return
    cur.style.removeProperty("background-color")
    cur.style.removeProperty("color")
    cur.classList.add("nkd-combo-current")
    for (let c = cur.parentElement?.closest(".nkd-combo-folder-contents"); c; c = c.parentElement?.closest(".nkd-combo-folder-contents")) {
      c.style.display = "block"
      const arrow = c.previousElementSibling?.querySelector(".nkd-combo-folder-arrow")
      if (arrow) arrow.textContent = "▼"
    }
    cur.scrollIntoView({ block: "nearest" })
  }))
}

export function installComboNest(state) {
  cfg = state
  if (_installed) return
  _installed = true
  injectCss()
  window.addEventListener("click", onVueClick, true)
  const obs = new MutationObserver((muts) => {
    if (!cfg?.comboNest && !cfg?.comboFuzzy) return
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList?.contains("litecontextmenu")) {
          // rAF: dejar que el core termine de crear entradas + filtro.
          requestAnimationFrame(() => processMenu(n))
        }
      }
    }
  })
  obs.observe(document.body, { childList: true })
}
