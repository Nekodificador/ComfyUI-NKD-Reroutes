import assert from "node:assert/strict"
import { test } from "node:test"
import { computePush } from "./computePush.js"

const R = (x, y, w, h) => ({ x, y, w, h })
const G = { gapX: 36, gapY: 12 }
const at = (r, dx, dy = 0) => R(r.x + dx, r.y + dy, r.w, r.h)

// Escena de la captura: Refine a la izquierda, Output a la derecha, 10 px entre ellos.
const refine = R(0, 0, 770, 840)
const output = R(780, 0, 560, 490)

test("sin recorrido no se mueve nada", () => {
  assert.deepEqual(computePush(output, output, [refine], G), [{ dx: 0, dy: 0 }])
})

test("mover Output a la izquierda empuja a Refine lo mismo, respetando el hueco que había", () => {
  const [p] = computePush(output, at(output, -100), [refine], G)
  assert.deepEqual(p, { dx: -100, dy: 0 })
})

test("hacia la derecha no lo toca: Refine queda detrás", () => {
  const [p] = computePush(output, at(output, 200), [refine], G)
  assert.deepEqual(p, { dx: 0, dy: 0 })
})

test("cadena: el empujado empuja al siguiente", () => {
  const a = R(0, 0, 100, 100), b = R(200, 0, 100, 100), c = R(320, 0, 100, 100)
  // Arrastro `a` 150 a la derecha: hueco a→b era 100 (tope 36) → b se corre 86.
  // b→c tenía 20 de hueco → c se corre lo mismo que b.
  const [pb, pc] = computePush(a, at(a, 150), [b, c], G)
  assert.equal(pb.dx, 86)
  assert.equal(pc.dx, 86)
})

test("lo que no se cruza de través no se empuja", () => {
  const a = R(0, 0, 100, 100), lejos = R(150, 500, 100, 100)
  assert.deepEqual(computePush(a, at(a, 300), [lejos], G), [{ dx: 0, dy: 0 }])
})

test("pasar de largo no lo devuelve atrás: sigue delante", () => {
  const a = R(0, 0, 100, 100), b = R(200, 0, 100, 100)
  const [p] = computePush(a, at(a, 1000), [b], G)
  assert.equal(200 + p.dx, 1100 + 36)   // b queda a la derecha de a.hi, con el hueco
})

test("elástico: volver al origen deja todo como estaba", () => {
  const a = R(0, 0, 100, 100), b = R(200, 0, 100, 100)
  computePush(a, at(a, 400), [b], G)
  assert.deepEqual(computePush(a, at(a, 0), [b], G), [{ dx: 0, dy: 0 }])
})

test("eje dominante vertical: empuja hacia abajo con gapY", () => {
  const a = R(0, 0, 100, 100), b = R(0, 150, 100, 100)
  const [p] = computePush(a, at(a, 5, 100), [b], G)
  assert.deepEqual(p, { dx: 0, dy: 62 })   // a.hi 200 + 12 - 150
})
