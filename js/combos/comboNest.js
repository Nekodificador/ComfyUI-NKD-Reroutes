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
// En Nodos 2.0 los combos no usan `.litecontextmenu` (los pinta PrimeVue/reka-ui,
// que ya es lista plana con filtro recursivo nativo), así que este observer no
// dispara — correcto: allí no hay nada que arreglar.
//
// ponytail: sin previews/thumbnails ni modo grid (eso es de pysssss y lleva
// backend). Aquí sólo carpetas + filtro recursivo.

import { buildComboTree } from "./buildComboTree.js"

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

function processMenu(menu) {
  if (!cfg?.comboNest || menu[DONE]) return
  // Sólo menús de COMBO: el core sólo les inyecta el filtro (cuando hay >4 opciones).
  if (!menu.querySelector(".comfy-context-menu-filter")) return
  // No duplicar si otra extensión (pysssss/nosotros) ya anidó este menú.
  if (menu.querySelector(".pysssss-combo-folder, .nkd-combo-folder")) return

  const entries = [...menu.querySelectorAll(".litemenu-entry")]
  if (entries.length < THRESHOLD) return
  if (!entries.some((e) => SPLIT.test(valueOf(e)))) return   // sin rutas, nada que anidar

  menu[DONE] = true
  try { buildTreeDom(menu, entries) } catch (e) { console.warn("[NKD Reroutes] combo nest", e) }
}

export function installComboNest(state) {
  cfg = state
  if (_installed) return
  _installed = true
  injectCss()
  const obs = new MutationObserver((muts) => {
    if (!cfg?.comboNest) return
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
