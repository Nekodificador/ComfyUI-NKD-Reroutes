import { app } from "../../scripts/app.js"

// Al volver de Nodes 2.0 a los nodos clásicos, cada nodo conserva la altura que
// tenía como elemento DOM —casi siempre de más, porque el layout de Vue reserva
// sitio que el dibujado clásico no usa— y queda una franja vacía bajo los
// widgets. Aquí se recorta cada nodo a su altura mínima.
const VUE_NODES = "Comfy.VueNodes.Enabled"

function shrinkAll() {
  const graph = app.graph
  if (!graph?.nodes?.length) return

  // Todo en una transacción: un solo Ctrl+Z deshace el recorte entero.
  graph.beforeChange()
  try {
    for (const node of graph.nodes) {
      if (node.flags?.collapsed || node.flags?.pinned || node.resizable === false) continue
      const min = node.computeSize?.()
      // Sólo el alto: el ancho lo has elegido tú y no sobra por el cambio de
      // renderizador. Y sólo hacia abajo, para no estirar lo que ya está justo.
      if (min && node.size[1] > min[1]) node.setSize([node.size[0], min[1]])
    }
  } finally {
    graph.afterChange()
  }
  app.canvas?.setDirty(true, true)
}

export function installShrinkOnLegacy() {
  // Sólo dispara "<id>.change"; el evento genérico "change" no existe.
  app.ui?.settings?.addEventListener?.(`${VUE_NODES}.change`, (e) => {
    if (e.detail?.value) return   // sólo al VOLVER a los clásicos, no al ir a 2.0
    // En el frame siguiente: al aplicarse el cambio de renderizador los tamaños
    // aún se están reasentando, y medir antes daría el alto viejo.
    requestAnimationFrame(shrinkAll)
  })
}
