import assert from "node:assert/strict"
import { test } from "node:test"
import { computeQuickConnect, isTypeCompatible } from "./computeQuickConnect.js"

// --- compatibilidad de tipos (regla calcada de LiteGraph) ---

test("tipos: igualdad y comodín", () => {
  assert.equal(isTypeCompatible("IMAGE", "IMAGE"), true)
  assert.equal(isTypeCompatible("IMAGE", "LATENT"), false)
  assert.equal(isTypeCompatible("*", "IMAGE"), true)
  assert.equal(isTypeCompatible("IMAGE", "*"), true)
  assert.equal(isTypeCompatible("", "IMAGE"), true)
  assert.equal(isTypeCompatible(0, "IMAGE"), true)
})

test("tipos: case-insensitive y listas por comas", () => {
  assert.equal(isTypeCompatible("image", "IMAGE"), true)
  assert.equal(isTypeCompatible("IMAGE,LATENT", "LATENT"), true)
  assert.equal(isTypeCompatible("MASK", "IMAGE,LATENT"), false)
  assert.equal(isTypeCompatible("A,B", "C,B"), true)
})

// --- filtrado y orden de candidatos ---

const cand = (over) => ({ nodeId: 1, slot: 0, side: "input", type: "IMAGE", pos: [0, 0], ...over })

test("arrastrando desde salida sólo ofrece entradas compatibles", () => {
  const origin = { type: "IMAGE", side: "output" }
  const candidates = [
    cand({ nodeId: "in",  side: "input",  type: "IMAGE",  pos: [0, 100] }),
    cand({ nodeId: "bad", side: "input",  type: "LATENT", pos: [0, 200] }),
    cand({ nodeId: "out", side: "output", type: "IMAGE",  pos: [0, 50] }),  // lado equivocado
  ]
  assert.deepEqual(computeQuickConnect(origin, candidates, {}).map(r => r.nodeId), ["in"])
})

test("arrastrando desde entrada sólo ofrece salidas", () => {
  const origin = { type: "IMAGE", side: "input" }
  const candidates = [
    cand({ nodeId: "o", side: "output", type: "IMAGE", pos: [0, 0] }),
    cand({ nodeId: "i", side: "input",  type: "IMAGE", pos: [0, 0] }),
  ]
  assert.deepEqual(computeQuickConnect(origin, candidates, {}).map(r => r.nodeId), ["o"])
})

test("ordena por posición vertical del nodo", () => {
  const origin = { type: "IMAGE", side: "output" }
  const candidates = [
    cand({ nodeId: "low",  side: "input", pos: [999, 500] }),
    cand({ nodeId: "high", side: "input", pos: [10, 100] }),
    cand({ nodeId: "mid",  side: "input", pos: [50, 300] }),
  ]
  assert.deepEqual(computeQuickConnect(origin, candidates, {}).map(r => r.nodeId), ["high", "mid", "low"])
})

test("libres antes que ocupados, y dentro de cada grupo por Y", () => {
  const origin = { type: "IMAGE", side: "output" }
  const candidates = [
    cand({ nodeId: "busyHigh", side: "input", pos: [0, 100], occupied: true }),
    cand({ nodeId: "freeLow",  side: "input", pos: [0, 400], occupied: false }),
    cand({ nodeId: "freeHigh", side: "input", pos: [0, 200], occupied: false }),
    cand({ nodeId: "busyLow",  side: "input", pos: [0, 500], occupied: true }),
  ]
  const res = computeQuickConnect(origin, candidates, {})
  assert.deepEqual(res.map(r => r.nodeId), ["freeHigh", "freeLow", "busyHigh", "busyLow"])
})

test("ordena por cercanía real, no sólo por Y (diagonal cercano gana a lejano alineado)", () => {
  const origin = { type: "IMAGE", side: "output", pos: [0, 0] }
  const candidates = [
    cand({ nodeId: "farAligned", side: "input", pos: [0, 300] }),   // mismo eje, lejos
    cand({ nodeId: "nearDiag",   side: "input", pos: [50, 60] }),   // diagonal, cerca
  ]
  assert.deepEqual(computeQuickConnect(origin, candidates, {}).map(r => r.nodeId), ["nearDiag", "farAligned"])
})

test("max recorta el número de sugerencias", () => {
  const origin = { type: "*", side: "output" }
  const candidates = Array.from({ length: 20 }, (_, i) =>
    cand({ nodeId: `n${i}`, side: "input", pos: [0, i] }))
  assert.equal(computeQuickConnect(origin, candidates, { max: 5 }).length, 5)
})

test("dentro del mismo nodo manda el orden de los sockets, no cuál está más cerca", () => {
  const origin = { type: "VIDEO", side: "output", pos: [0, 240] }
  const rect = [100, 0, 300, 400]
  const candidates = [
    cand({ nodeId: "viewer", slot: 2, name: "reference", side: "input", type: "VIDEO", pos: [100, 240], nodeRect: rect }),
    cand({ nodeId: "viewer", slot: 0, name: "media",     side: "input", type: "VIDEO", pos: [100, 20],  nodeRect: rect }),
  ]
  assert.deepEqual(computeQuickConnect(origin, candidates, {}).map(r => r.slot), [0, 2])
})

test("entre nodos manda la cercanía del nodo entero, y los ocupados van después", () => {
  const origin = { type: "IMAGE", side: "output", pos: [0, 0] }
  const candidates = [
    cand({ nodeId: "far",  slot: 0, pos: [500, 0],  nodeRect: [500, -50, 200, 100] }),
    cand({ nodeId: "near", slot: 1, pos: [100, 90], nodeRect: [100, -50, 200, 100] }),   // socket lejos, nodo cerca
    cand({ nodeId: "near", slot: 0, pos: [100, 0],  nodeRect: [100, -50, 200, 100], occupied: true }),
  ]
  const res = computeQuickConnect(origin, candidates, {})
  assert.deepEqual(res.map(r => `${r.nodeId}:${r.slot}`), ["near:1", "far:0", "near:0"])
})
