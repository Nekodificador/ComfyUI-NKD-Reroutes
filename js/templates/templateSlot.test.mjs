import assert from "node:assert/strict"
import { test } from "node:test"
import { templateForSlot } from "./templateSlot.js"

const store = JSON.stringify([
  { name: "A", data: "{\"nodes\":[]}" },
  { name: "B", data: "{\"nodes\":[1]}" },
])

test("devuelve la plantilla del slot (1-based)", () => {
  assert.equal(templateForSlot(store, 1).name, "A")
  assert.equal(templateForSlot(store, 2).name, "B")
})

test("fuera de rango o slot inválido → null", () => {
  assert.equal(templateForSlot(store, 3), null)
  assert.equal(templateForSlot(store, 0), null)
})

test("localStorage vacío o JSON roto → null (no revienta)", () => {
  assert.equal(templateForSlot(null, 1), null)
  assert.equal(templateForSlot("", 1), null)
  assert.equal(templateForSlot("{no json", 1), null)
  assert.equal(templateForSlot("{}", 1), null)                 // no es array
})

test("plantilla sin data string → null", () => {
  assert.equal(templateForSlot(JSON.stringify([{ name: "X" }]), 1), null)
})
