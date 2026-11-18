import assert from "node:assert/strict"
import { matchSize } from "./matchSize.js"

const a = { id: 1, w: 200, h: 100 }, b = { id: 2, w: 320, h: 60 }, c = { id: 3, w: 320, h: 140 }

// ancho: todos al mayor; el que ya lo tiene no se toca
assert.deepEqual(matchSize([a, b, c], "w"), [{ id: 1, w: 320, h: 100 }])
// alto: igual, sin tocar el ancho
assert.deepEqual(matchSize([a, b, c], "h"), [{ id: 1, w: 200, h: 140 }, { id: 2, w: 320, h: 140 }])
// un solo nodo o ya igualados: nada
assert.deepEqual(matchSize([a], "w"), [])
assert.deepEqual(matchSize([b, c], "w"), [])
// el mínimo propio manda si supera al objetivo
assert.deepEqual(matchSize([{ ...a, minW: 400 }, b], "w"), [{ id: 1, w: 400, h: 100 }])
// idempotente
const once = matchSize([a, b, c], "h")
const after = [a, b, c].map(n => ({ ...n, ...(once.find(o => o.id === n.id) ?? {}) }))
assert.deepEqual(matchSize(after, "h"), [])
console.log("matchSize ok")
