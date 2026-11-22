import assert from "node:assert/strict"
import { cornerAt, resizeFrom } from "./groupResize.js"

const r = { x: 100, y: 100, w: 400, h: 300 }
// cuatro esquinas, con margen hacia fuera y hacia dentro
assert.equal(cornerAt(r, 100, 100), "NW")
assert.equal(cornerAt(r, 97, 97), "NW")          // 3 px fuera
assert.equal(cornerAt(r, 115, 115), "NW")        // 15 px dentro
assert.equal(cornerAt(r, 117, 100), null)        // pasado de 16
assert.equal(cornerAt(r, 95, 100), null)         // pasado de 4 fuera
assert.equal(cornerAt(r, 500, 100), "NE")
assert.equal(cornerAt(r, 100, 400), "SW")
assert.equal(cornerAt(r, 500, 400), "SE")
assert.equal(cornerAt(r, 300, 250), null)
// un grupo pequeño: lo de dentro se topa a 1/4
const s = { x: 0, y: 0, w: 40, h: 40 }
assert.equal(cornerAt(s, 10, 10), "NW")
assert.equal(cornerAt(s, 11, 11), null)

// estirar: el lado opuesto se queda
assert.deepEqual(resizeFrom(r, "NW", -50, -20, 140, 80), { x: 50, y: 80, w: 450, h: 320 })
assert.deepEqual(resizeFrom(r, "NE", 30, 40, 140, 80), { x: 100, y: 140, w: 430, h: 260 })
assert.deepEqual(resizeFrom(r, "SW", 10, 10, 140, 80), { x: 110, y: 100, w: 390, h: 310 })
// topar con el mínimo sin mover el lado opuesto
const t = resizeFrom(r, "NW", 1000, 1000, 140, 80)
assert.deepEqual(t, { x: 360, y: 320, w: 140, h: 80 })
assert.equal(t.x + t.w, r.x + r.w)
assert.equal(t.y + t.h, r.y + r.h)
// sin estado: volver al punto de partida devuelve el rect original
assert.deepEqual(resizeFrom(r, "SW", 0, 0, 140, 80), r)
console.log("groupResize ok")
