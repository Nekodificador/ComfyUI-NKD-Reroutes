// «Revisar legibilidad» — marca lo que se lee mal sin mover nada.
//
// Mismas comprobaciones que la spec de la reescritura del auto-arrange
// (CLAUDE.md → «Reglas aprobadas para la reescritura», RAA-05), sacadas de las
// reglas de nomadoor/comfyui-readable-node (MIT, sin su código).
//
// Puro arriba: snapshot plano → lista de avisos. El adaptador de abajo recibe
// `app` por parámetro (no lo importa) para que el módulo cargue bajo node.

export const COLUMN_GAP = 30   // hueco de columna: tolerancia del cable hacia atrás

// Nodos que cambian de alto al ejecutar o al tocar sus valores. Una imagen no
// cuenta: se dibuja dentro del alto que ya tiene el nodo.
export const GROWS = /KSampler|SamplerCustom|Video|BoundingBox/i

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

// ¿El segmento p→q cruza el interior del rectángulo r? (Liang–Barsky)
function segmentHits(p, q, r) {
  let t0 = 0, t1 = 1
  const dx = q.x - p.x, dy = q.y - p.y
  for (const [pk, qk] of [[-dx, p.x - r.x], [dx, r.x + r.w - p.x], [-dy, p.y - r.y], [dy, r.y + r.h - p.y]]) {
    if (pk === 0) { if (qk <= 0) return false; continue }
    const t = qk / pk
    if (pk < 0) { if (t > t1) return false; if (t > t0) t0 = t }
    else { if (t < t0) return false; if (t < t1) t1 = t }
  }
  return t1 - t0 > 1e-6
}

/**
 * @param {{nodes:{id,title,type,x,y,w,h}[], links:{from,to,a:{x,y},b:{x,y}}[]}} snap
 *   x/y/w/h = rectángulo visible (con barra de título); a/b = sockets de salida y entrada.
 * @returns {{kind:"overlap"|"backward"|"underGrowing"|"hiddenWire", ids:any[], msg:string}[]}
 */
export function checkReadability({ nodes, links }) {
  const out = []
  const byId = new Map(nodes.map(n => [n.id, n]))
  const name = (n) => n.title || n.type || `#${n.id}`

  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      if (overlap(nodes[i], nodes[j]))
        out.push({ kind: "overlap", ids: [nodes[i].id, nodes[j].id], msg: `${name(nodes[i])} and ${name(nodes[j])} overlap` })

  for (const l of links) {
    const s = byId.get(l.from), t = byId.get(l.to)
    if (!s || !t) continue
    if (t.x < s.x + s.w - (t.w + COLUMN_GAP))
      out.push({ kind: "backward", ids: [t.id, s.id], msg: `Wire from ${name(s)} goes back into ${name(t)}` })
    for (const n of nodes) {
      if (n === s || n === t || !l.a || !l.b) continue
      if (segmentHits(l.a, l.b, n)) { out.push({ kind: "hiddenWire", ids: [n.id, s.id, t.id], msg: `${name(n)} hides the wire ${name(s)} → ${name(t)}` }); break }
    }
  }

  for (const g of nodes) {
    if (!GROWS.test(g.type ?? "")) continue
    for (const n of nodes) {
      if (n === g || n.y < g.y + g.h) continue
      if (n.x < g.x + g.w && g.x < n.x + n.w)
        out.push({ kind: "underGrowing", ids: [n.id, g.id], msg: `${name(n)} sits under ${name(g)}, which grows when it runs` })
    }
  }
  return out
}

// ─── Adaptador ──────────────────────────────────────────────────────────────

function snapshot(graph) {
  const nodes = (graph._nodes ?? []).filter(n => !n.flags?.collapsed).map(n => {
    n.updateArea?.()
    const [x, y, w, h] = n.getBounding()
    return { id: n.id, title: n.title, type: n.type, x, y, w, h }
  })
  const ids = new Set(nodes.map(n => n.id))
  const links = []
  const all = graph.links instanceof Map ? [...graph.links.values()] : Object.values(graph.links ?? {})
  for (const l of all) {
    if (!l || !ids.has(l.origin_id) || !ids.has(l.target_id)) continue
    const s = graph.getNodeById(l.origin_id), t = graph.getNodeById(l.target_id)
    const a = s.getOutputPos?.(l.origin_slot), b = t.getInputPos?.(l.target_slot)
    links.push({ from: l.origin_id, to: l.target_id, a: a && { x: a[0], y: a[1] }, b: b && { x: b[0], y: b[1] } })
  }
  return { nodes, links }
}

let _panel = null

export function showReadability(app) {
  const canvas = app.canvas, graph = canvas.graph
  const issues = checkReadability(snapshot(graph))
  _panel?.remove()
  if (!issues.length) {
    app.extensionManager?.toast?.add?.({ severity: "success", summary: "Readability", detail: "Nothing to fix.", life: 3000 })
    return
  }
  const panel = document.createElement("div")
  panel.style.cssText = "position:fixed;right:16px;top:80px;z-index:9999;width:min(340px,calc(100vw - 32px));max-height:60vh;overflow:auto;" +
    "background:var(--comfy-menu-bg,#222);color:var(--fg-color,#ddd);border:1px solid var(--border-color,#444);border-radius:8px;" +
    "font:12px/1.4 Inter,Arial,sans-serif;box-shadow:0 8px 30px #0008"
  const head = document.createElement("div")
  head.style.cssText = "display:flex;align-items:center;padding:8px 10px;border-bottom:1px solid var(--border-color,#444);font-weight:600"
  head.textContent = `Readability: ${issues.length} issue${issues.length > 1 ? "s" : ""}`
  const x = Object.assign(document.createElement("button"), { textContent: "✕", title: "Close" })
  x.style.cssText = "margin-left:auto;background:none;border:0;color:inherit;cursor:pointer;font-size:13px"
  x.onclick = () => { panel.remove(); _panel = null }
  head.append(x)
  panel.append(head)
  for (const it of issues) {
    const row = Object.assign(document.createElement("button"), { textContent: it.msg })
    row.style.cssText = "display:block;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid #8882;color:inherit;padding:6px 10px;cursor:pointer"
    row.onmouseenter = () => (row.style.background = "#8882")
    row.onmouseleave = () => (row.style.background = "none")
    // Clic = centrar el primer nodo implicado y seleccionar todos.
    row.onclick = () => {
      const nodes = it.ids.map(id => graph.getNodeById(id)).filter(Boolean)
      if (!nodes.length) return
      canvas.deselectAll?.()
      for (const n of nodes) canvas.select?.(n)
      canvas.centerOnNode?.(nodes[0])
      canvas.setDirty(true, true)
    }
    panel.append(row)
  }
  document.body.append(panel)
  _panel = panel
}

export const readabilityCommands = (app) => [
  { id: "nkd.reroutes.checkReadability", label: "NKD Reroutes: Check workflow readability", icon: "pi pi-eye", function: () => showReadability(app) },
]
