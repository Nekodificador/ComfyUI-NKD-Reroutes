// Recorta un workflow serializado a unos nodos — puro (sin DOM ni app).
//
// Para exportar sólo la selección (p. ej. un nodo subgraph aislado): la imagen
// lleva dentro un workflow que, al arrastrarlo a ComfyUI, da justo esos nodos.
// Se quedan los cables ENTRE ellos; los que salen fuera se cortan en los dos
// extremos. Se conservan las definiciones de subgraph que usan los nodos que
// quedan, también las anidadas, y ninguna más. Grupos y reroutes fuera.

const linkId = (l) => Array.isArray(l) ? l[0] : l?.id
const linkEnds = (l) => Array.isArray(l) ? [l[1], l[3]] : [l?.origin_id, l?.target_id]

export function selectionWorkflow(wf, ids) {
  // Los ids de un nodo vivo pueden ser texto ("5") tras recargar la pestaña y
  // número en el JSON serializado (medido): se comparan como texto.
  const keep = new Set(ids.map(String))
  const has = (id) => keep.has(String(id))
  const nodes = (wf.nodes ?? []).filter(n => has(n.id))
  const links = (wf.links ?? []).filter(l => linkEnds(l).every(has))
  const live = new Set(links.map(linkId))

  const out = { ...wf, nodes: nodes.map(n => ({
    ...n,
    inputs: n.inputs?.map(i => (i.link != null && !live.has(i.link) ? { ...i, link: null } : i)),
    outputs: n.outputs?.map(o => (o.links ? { ...o, links: o.links.filter(id => live.has(id)) } : o)),
  })), links, groups: [], floatingLinks: [] }
  if (out.extra) out.extra = { ...out.extra, reroutes: undefined, linkExtensions: undefined }

  const defs = wf.definitions?.subgraphs
  if (defs?.length) {
    const byId = new Map(defs.map(d => [d.id, d]))
    const used = new Set()
    const visit = (list) => { for (const n of list ?? []) if (byId.has(n.type) && !used.has(n.type)) { used.add(n.type); visit(byId.get(n.type).nodes) } }
    visit(nodes)
    out.definitions = { ...wf.definitions, subgraphs: defs.filter(d => used.has(d.id)) }
  }
  return out
}
