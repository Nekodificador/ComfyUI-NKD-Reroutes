// Plegar un nodo sin que se le muevan los cables.
//
// Un nodo plegado se dibuja sólo con su barra de título, y todos sus sockets se
// juntan en ella — que está POR ENCIMA del primer socket del nodo desplegado.
// Así que al plegar, los cables pegan un salto hacia arriba. Con una pastilla
// Set/Get es especialmente molesto: la colocas a la altura de la salida de la
// que cuelga y al plegarla se sube sola.
//
// La corrección es mover el nodo lo justo para que su primer socket se quede
// donde estaba. Y sale simétrica gratis: al desplegar se mide igual y el nodo
// vuelve exactamente a su sitio, sin guardar nada. No hay estado que se
// desincronice ni que haya que serializar en el workflow.
//
// ALCANCE: el canvas clásico. La geometría de arriba es la de LiteGraph, y con
// Nodes 2.0 la posición de los sockets la manda el layout de Vue, que ni se
// mide igual ni está actualizado cuando se sale de collapse(). Hubo un intento
// de cubrir los dos —leyendo `getInputPos`/`getOutputPos` y reintentando al
// frame siguiente— y empujaba el nodo hacia el lado contrario, así que se
// retiró. Si algún día se retoma: hace falta medir de verdad la geometría de la
// pastilla en Vue antes de escribir nada, no deducirla del modelo clásico.

// La altura de referencia: el primer socket del nodo. La entrada manda —es lo
// que uno mira al colocar un nodo— y si no tiene, la salida (el caso de una Get).
function anchorY(node) {
  const p = node.inputs?.length  ? node.getConnectionPos?.(true,  0, [0, 0])
          : node.outputs?.length ? node.getConnectionPos?.(false, 0, [0, 0])
          : null
  return p ? p[1] : null
}

// Se exporta aparte del parche para poder probarla sin navegador.
export function wrapCollapse(orig, state) {
  return function (...args) {
    if (!state.collapseKeepsWire) return orig.apply(this, args)

    const plegadoAntes = this.flags?.collapsed
    const yAntes = anchorY(this)
    const r = orig.apply(this, args)
    // Un nodo no plegable no cambia de estado: entonces no hay nada que mover.
    if (this.flags?.collapsed === plegadoAntes) return r

    const yDespues = anchorY(this)
    if (yAntes != null && yDespues != null) this.pos[1] += yAntes - yDespues
    return r
  }
}

export function installCollapseAnchor(state) {
  const proto = globalThis.LiteGraph?.LGraphNode?.prototype ?? globalThis.LGraphNode?.prototype
  if (typeof proto?.collapse !== "function") {
    console.warn("[NKD Reroutes] este frontend no expone LGraphNode.collapse; " +
                 "plegar seguirá moviendo los cables")
    return
  }
  // Es el embudo único: el menú contextual, el clic en el punto de plegado y la
  // ruta de Nodes 2.0 acaban todos aquí, así que un solo parche los cubre.
  // Este fichero no importa `app` a propósito, para poder probarlo bajo node;
  // redibujar tampoco hace falta, el propio collapse() ya ensucia el canvas.
  proto.collapse = wrapCollapse(proto.collapse, state)
}
