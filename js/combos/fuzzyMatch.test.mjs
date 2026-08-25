import assert from "node:assert/strict"
import { test } from "node:test"
import { fuzzyMatch } from "./fuzzyMatch.js"

const ANIME = "styles\\anime\\dreamy_portrait_v2.safetensors"
const REAL  = "styles\\realism\\photo_real_v1.safetensors"

test("multi-palabra AND: todas las palabras deben aparecer", () => {
  assert.equal(fuzzyMatch("styles real", ANIME), false)   // tiene 'styles' pero NO 'real'
  assert.equal(fuzzyMatch("styles real", REAL), true)      // tiene ambas
  assert.equal(fuzzyMatch("styles anime", ANIME), true)
})

test("orden independiente", () => {
  assert.equal(fuzzyMatch("anime styles", ANIME), true)
  assert.equal(fuzzyMatch("real styles", REAL), true)
})

test("una palabra = substring", () => {
  assert.equal(fuzzyMatch("anime", ANIME), true)
  assert.equal(fuzzyMatch("real", ANIME), false)
})

test("case-insensitive y espacios colapsados", () => {
  assert.equal(fuzzyMatch("STYLES   Real", REAL), true)
})

test("consulta vacía → todo casa", () => {
  assert.equal(fuzzyMatch("", ANIME), true)
  assert.equal(fuzzyMatch("   ", ANIME), true)
})
