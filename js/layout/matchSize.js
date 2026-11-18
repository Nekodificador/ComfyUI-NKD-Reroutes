// Igualar ancho / alto de la selección — función pura (sin DOM ni LiteGraph).
//
// Todos toman la medida del mayor: igualar al menor podría dejar un nodo por
// debajo de lo que necesita su contenido. El mínimo de cada nodo se respeta
// igualmente, por si su tamaño actual ya estaba por debajo (pasa en Nodes 2.0).
// Sólo devuelve los que cambian: con todo igualado no hay nada que deshacer.

/**
 * @param {{id:any, w:number, h:number, minW?:number, minH?:number}[]} items
 * @param {"w"|"h"} dim
 * @returns {{id:any, w:number, h:number}[]}
 */
export function matchSize(items, dim) {
  if (items.length < 2) return []
  const target = Math.max(...items.map(i => i[dim]))
  const min = dim === "w" ? "minW" : "minH"
  const out = []
  for (const i of items) {
    const v = Math.max(target, i[min] ?? 0)
    if (v !== i[dim]) out.push({ id: i.id, w: dim === "w" ? v : i.w, h: dim === "h" ? v : i.h })
  }
  return out
}

// ─── Adaptador ──────────────────────────────────────────────────────────────
// Recibe `app` por parámetro (no lo importa) para que el módulo cargue bajo node.
// setSize sincroniza también el layout de Nodes 2.0. Plegados y no-nodos fuera.

function selectedNodes(canvas) {
  return [...(canvas?.selectedItems || [])].filter(n =>
    n?.inputs !== undefined && !n.flags?.collapsed && typeof n.setSize === "function")
}

export function applyMatchSize(app, dim) {
  const canvas = app?.canvas, graph = canvas?.graph
  const nodes = selectedNodes(canvas)
  const changes = matchSize(nodes.map(n => {
    const min = n.computeSize?.() ?? [0, 0]
    return { id: n.id, w: n.size[0], h: n.size[1], minW: min[0], minH: min[1] }
  }), dim)
  if (!changes.length) return
  const byId = new Map(nodes.map(n => [n.id, n]))
  graph.beforeChange()
  try {
    for (const c of changes) byId.get(c.id).setSize([c.w, c.h])
  } finally {
    graph.afterChange()
  }
  // afterChange no apunta el estado si el comando llega sin clic ni tecla
  // (paleta, script): se apunta a mano para que Ctrl+Z lo encuentre.
  const tracker = app.extensionManager?.workflow?.activeWorkflow?.changeTracker
  ;(tracker?.captureCanvasState ?? tracker?.checkState)?.call(tracker)
  canvas.setDirty(true, true)
}

export const matchSizeCommands = (app) => [
  { id: "nkd.reroutes.matchWidth", label: "NKD Reroutes: Match width of selected nodes", function: () => applyMatchSize(app, "w") },
  { id: "nkd.reroutes.matchHeight", label: "NKD Reroutes: Match height of selected nodes", function: () => applyMatchSize(app, "h") },
]

// Entrada del clic derecho del canvas: sólo con 2+ nodos seleccionados.
export function matchSizeMenuItems(app) {
  if (selectedNodes(app?.canvas).length < 2) return []
  return [{
    content: "Match size",
    submenu: {
      options: [
        { content: "Match width", callback: () => applyMatchSize(app, "w") },
        { content: "Match height", callback: () => applyMatchSize(app, "h") },
      ],
    },
  }]
}
