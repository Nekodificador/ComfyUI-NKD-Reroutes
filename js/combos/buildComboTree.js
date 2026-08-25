// PURE (sin DOM, testeable bajo node): convierte una lista de valores de combo con
// rutas ("a/b/foo") en un árbol de carpetas. El adaptador (comboNest.js) recorre
// este árbol para reorganizar las entradas reales del menú clásico.
//
// Cada nodo del árbol: { folders: [{name, node}], leaves: [{value, label}] }, en
// orden de aparición (para respetar el orden del combo). `label` es el último
// segmento; el prefijo de ruta lo deriva el adaptador de value.slice(0, -label).
//
// ponytail: la búsqueda de subcarpeta por nombre es lineal (node.folders.find).
// Para tamaños de combo (cientos) sobra; si algún día hay miles, un Map por nodo.
export function buildComboTree(values, splitOn = /[\\/]/) {
  const root = { folders: [], leaves: [] }
  for (const value of values) {
    const parts = String(value).split(splitOn)
    const label = parts[parts.length - 1]
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i]
      let child = node.folders.find((f) => f.name === name)
      if (!child) { child = { name, node: { folders: [], leaves: [] } }; node.folders.push(child) }
      node = child.node
    }
    node.leaves.push({ value, label })
  }
  return root
}
