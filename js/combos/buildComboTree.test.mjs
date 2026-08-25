import assert from "node:assert/strict"
import { test } from "node:test"
import { buildComboTree } from "./buildComboTree.js"

test("raíz plana: valores sin separador son hojas de raíz", () => {
  const t = buildComboTree(["a", "b", "c"])
  assert.equal(t.folders.length, 0)
  assert.deepEqual(t.leaves.map((l) => l.label), ["a", "b", "c"])
})

test("anida por / y por \\, con label = último segmento", () => {
  const t = buildComboTree(["z", "a/x", "a/b/y", "c\\w"])
  // raíz: hoja z + carpetas a, c (en orden de aparición)
  assert.deepEqual(t.leaves.map((l) => l.label), ["z"])
  assert.deepEqual(t.folders.map((f) => f.name), ["a", "c"])
  // a: hoja x + carpeta b
  const a = t.folders[0].node
  assert.deepEqual(a.leaves.map((l) => l.label), ["x"])
  assert.deepEqual(a.folders.map((f) => f.name), ["b"])
  // a/b: hoja y (value completo conservado)
  assert.deepEqual(a.folders[0].node.leaves, [{ value: "a/b/y", label: "y" }])
  // c: hoja w
  assert.deepEqual(t.folders[1].node.leaves.map((l) => l.label), ["w"])
})

test("varias hojas en la misma carpeta se agrupan, sin duplicar carpeta", () => {
  const t = buildComboTree(["f/1", "f/2", "f/3"])
  assert.equal(t.folders.length, 1)
  assert.equal(t.folders[0].name, "f")
  assert.deepEqual(t.folders[0].node.leaves.map((l) => l.value), ["f/1", "f/2", "f/3"])
})

test("preserva el value completo para casar con la entrada del menú", () => {
  const t = buildComboTree(["SDXL/realistic/foo.safetensors"])
  const leaf = t.folders[0].node.folders[0].node.leaves[0]
  assert.equal(leaf.value, "SDXL/realistic/foo.safetensors")
  assert.equal(leaf.label, "foo.safetensors")
})
