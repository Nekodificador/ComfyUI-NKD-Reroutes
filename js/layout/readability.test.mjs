import assert from "node:assert/strict"
import { checkReadability } from "./readability.js"

const N = (id, x, y, w = 200, h = 100, type = "X") => ({ id, type, title: `n${id}`, x, y, w, h })
const L = (s, t) => ({ from: s.id, to: t.id, a: { x: s.x + s.w, y: s.y + 40 }, b: { x: t.x, y: t.y + 40 } })
const kinds = (r) => r.map(i => i.kind).sort()

// limpio: dos nodos en fila, cable recto
const a = N(1, 0, 0), b = N(2, 300, 0)
assert.deepEqual(checkReadability({ nodes: [a, b], links: [L(a, b)] }), [])

// solape
assert.deepEqual(kinds(checkReadability({ nodes: [a, N(3, 150, 50)], links: [] })), ["overlap"])

// cable hacia atrás: destino muy a la izquierda del origen
const far = N(4, -400, 0)
assert.deepEqual(kinds(checkReadability({ nodes: [a, far], links: [L(a, far)] })), ["backward"])
// tolerado: retrocede menos que el ancho del destino + un hueco (Conditioning Zero Out)
const near = N(5, 100, 200)
assert.ok(!checkReadability({ nodes: [a, near], links: [L(a, near)] }).some(i => i.kind === "backward"))

// cable tapado: un nodo en medio de la recta
const c = N(6, 700, 0), mid = N(7, 350, 0)
assert.deepEqual(kinds(checkReadability({ nodes: [a, c, mid], links: [L(a, c)] })), ["hiddenWire"])
// un nodo encima del cable, sin tocarlo, no cuenta
assert.deepEqual(checkReadability({ nodes: [a, c, N(8, 350, -300)], links: [L(a, c)] }), [])

// debajo de un nodo que crece (sampler), dentro de su ancho
const k = N(9, 0, 0, 300, 300, "KSampler")
assert.deepEqual(kinds(checkReadability({ nodes: [k, N(10, 50, 400)], links: [] })), ["underGrowing"])
// a un lado no cuenta; debajo de un nodo que no crece tampoco
assert.deepEqual(checkReadability({ nodes: [k, N(11, 400, 400)], links: [] }), [])
assert.deepEqual(checkReadability({ nodes: [N(12, 0, 0, 300, 300, "PreviewImage"), N(13, 50, 400)], links: [] }), [])
console.log("readability ok")
