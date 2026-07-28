import assert from "node:assert/strict"
import { test } from "node:test"
import { computeSnap } from "./computeSnap.js"

const OPTS = { radius: 20, matchWidth: false, minWidth: 0 }
const rect = (x, y, w, h) => ({ x, y, w, h })
const target = (over) => ({
  ref: "min", offset: 0, value: 0, kind: "edge",
  column: false, sourceWidth: null, guide: null, ...over,
})

test("engancha el borde izquierdo cuando está dentro del radio", () => {
  const r = rect(108, 50, 200, 80)
  const targets = { x: [target({ ref: "min", value: 100 })], y: [] }
  const out = computeSnap(r, targets, OPTS)
  assert.equal(out.dx, -8)
  assert.equal(out.dy, 0)
})

test("ignora candidatos fuera del radio", () => {
  const r = rect(150, 50, 200, 80)
  const targets = { x: [target({ ref: "min", value: 100 })], y: [] }
  const out = computeSnap(r, targets, OPTS)
  assert.equal(out.dx, 0)
})

test("un eje sin candidatos queda intacto", () => {
  const r = rect(108, 50, 200, 80)
  const targets = { x: [target({ ref: "min", value: 100 })], y: [] }
  const out = computeSnap(r, targets, OPTS)
  assert.equal(out.dy, 0)
})

test("el socket gana al borde aunque esté más lejos", () => {
  const r = rect(0, 100, 200, 80)
  const targets = {
    x: [],
    y: [
      target({ ref: "min",    value: 98,  kind: "edge" }),   // delta -2
      target({ ref: "socket", value: 130, offset: 18, kind: "socket" }), // delta +12
    ],
  }
  const out = computeSnap(r, targets, OPTS)
  assert.equal(out.dy, 12)
})

test("el hueco gana al borde pero pierde contra el socket", () => {
  const r = rect(0, 100, 200, 80)
  const conHueco = {
    x: [],
    y: [
      target({ ref: "min", value: 96,  kind: "edge" }), // delta -4
      target({ ref: "min", value: 110, kind: "gap" }),  // delta +10
    ],
  }
  assert.equal(computeSnap(r, conHueco, OPTS).dy, 10)

  const conSocket = {
    x: [],
    y: [
      target({ ref: "min", value: 110, kind: "gap" }),
      target({ ref: "socket", value: 118, offset: 0, kind: "socket" }),
    ],
  }
  assert.equal(computeSnap(r, conSocket, OPTS).dy, 18)
})

test("dentro del mismo escalón gana el más cercano", () => {
  const r = rect(100, 0, 200, 80)
  const targets = {
    x: [
      target({ ref: "min", value: 115, kind: "edge" }), // delta +15
      target({ ref: "min", value: 104, kind: "edge" }), // delta +4
    ],
    y: [],
  }
  assert.equal(computeSnap(r, targets, OPTS).dx, 4)
})

const OPTS_W = { radius: 20, matchWidth: true, minWidth: 120 }

test("adopta el ancho de la columna al alinear izquierda con izquierda", () => {
  const r = rect(108, 50, 200, 80)
  const targets = {
    x: [target({ ref: "min", value: 100, column: true, sourceWidth: 260 })],
    y: [],
  }
  assert.equal(computeSnap(r, targets, OPTS_W).width, 260)
})

test("no toca el ancho al adosar en fila", () => {
  const r = rect(108, 50, 200, 80)
  const targets = {
    x: [target({ ref: "min", value: 100, column: false, sourceWidth: null })],
    y: [],
  }
  assert.equal(computeSnap(r, targets, OPTS_W).width, null)
})

test("no estrecha por debajo del mínimo del nodo", () => {
  const r = rect(108, 50, 200, 80)
  const targets = {
    x: [target({ ref: "min", value: 100, column: true, sourceWidth: 90 })],
    y: [],
  }
  const out = computeSnap(r, targets, OPTS_W)
  assert.equal(out.width, null)   // 90 < minWidth 120
  assert.equal(out.dx, -8)        // pero se alinea igual
})

test("matchWidth desactivado nunca devuelve ancho", () => {
  const r = rect(108, 50, 200, 80)
  const targets = {
    x: [target({ ref: "min", value: 100, column: true, sourceWidth: 260 })],
    y: [],
  }
  assert.equal(computeSnap(r, targets, OPTS).width, null)
})
