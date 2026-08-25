import assert from "node:assert/strict"
import { test } from "node:test"
import { heatColor } from "./heatColor.js"

const rgb = (s) => s.match(/\d+/g).map(Number)

test("extremos: rápido = azul oscuro, lento = naranja", () => {
  assert.equal(heatColor(0, 100), "rgb(90, 143, 208)")    // azul medio (legible)
  assert.equal(heatColor(100, 100), "rgb(255, 120, 20)")  // naranja intenso
})

test("clamp por encima del máximo → naranja", () => {
  assert.equal(heatColor(200, 100), "rgb(255, 120, 20)")
})

test("más lento = más naranja (sube R, baja B) — monótono", () => {
  const fast = rgb(heatColor(20, 100)), slow = rgb(heatColor(80, 100))
  assert.ok(slow[0] > fast[0], "más rojo al ser más lento")
  assert.ok(slow[2] < fast[2], "menos azul al ser más lento")
})

test("sin medida o escala inválida → null", () => {
  assert.equal(heatColor(null, 100), null)
  assert.equal(heatColor(50, 0), null)
  assert.equal(heatColor(50, -1), null)
  assert.equal(heatColor(Infinity, 100), null)
})
