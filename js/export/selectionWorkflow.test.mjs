import assert from "node:assert/strict"
import { selectionWorkflow } from "./selectionWorkflow.js"

// Forma real medida en el frontend 1.59: links como arrays, subgraphs en definitions.
const SUB = "82b0a10c", INNER = "aaaa"
const wf = {
  nodes: [
    { id: 1, type: "LoadImage", inputs: [], outputs: [{ links: [7] }] },
    { id: 5, type: SUB, inputs: [{ link: 7 }, { link: null }], outputs: [{ links: [3, 9] }] },
    { id: 4, type: "VAEDecode", inputs: [{ link: 3 }], outputs: [{ links: null }] },
    { id: 6, type: "PreviewImage", inputs: [{ link: 9 }], outputs: [] },
  ],
  links: [[7, 1, 0, 5, 0, "IMAGE"], [3, 5, 0, 4, 0, "LATENT"], [9, 5, 0, 6, 0, "LATENT"]],
  groups: [{ title: "g" }],
  definitions: { subgraphs: [
    { id: SUB, nodes: [{ type: "KSampler" }, { type: INNER }] },
    { id: INNER, nodes: [{ type: "CLIPTextEncode" }] },
    { id: "unused", nodes: [] },
  ] },
  extra: { ds: { scale: 1 }, reroutes: [{ id: 1 }] },
}

// el subgraph solo: sin cables, con su definición y la anidada
const one = selectionWorkflow(wf, [5])
assert.deepEqual(one.nodes.map(n => n.id), [5])
assert.deepEqual(one.links, [])
assert.deepEqual(one.nodes[0].inputs.map(i => i.link), [null, null])
assert.deepEqual(one.nodes[0].outputs[0].links, [])
assert.deepEqual(one.definitions.subgraphs.map(d => d.id), [SUB, INNER])
assert.deepEqual(one.groups, [])
assert.equal(one.extra.reroutes, undefined)
assert.deepEqual(one.extra.ds, { scale: 1 })

// dos nodos: el cable entre ellos se queda, el de fuera se corta
const two = selectionWorkflow(wf, [5, 4])
assert.deepEqual(two.links, [[3, 5, 0, 4, 0, "LATENT"]])
assert.deepEqual(two.nodes.find(n => n.id === 5).outputs[0].links, [3])
assert.equal(two.nodes.find(n => n.id === 4).inputs[0].link, 3)

// ids como texto (nodo vivo tras recargar) contra números en el JSON
assert.deepEqual(selectionWorkflow(wf, ["5", "4"]).links, two.links)
// sin subgraphs: ninguna definición
assert.deepEqual(selectionWorkflow(wf, [1]).definitions.subgraphs, [])
// no toca el original
assert.equal(wf.nodes[1].inputs[0].link, 7)
assert.equal(wf.links.length, 3)
console.log("selectionWorkflow ok")
