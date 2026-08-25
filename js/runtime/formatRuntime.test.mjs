import assert from "node:assert/strict"
import { test } from "node:test"
import { formatRuntime } from "./formatRuntime.js"

test("sub-segundo en ms redondeados", () => {
  assert.equal(formatRuntime(0), "0ms")
  assert.equal(formatRuntime(340.6), "341ms")
  assert.equal(formatRuntime(999), "999ms")
})

test("segundos con 2 y 1 decimales según magnitud", () => {
  assert.equal(formatRuntime(1234), "1.23s")
  assert.equal(formatRuntime(9999), "10.00s")   // <10000 aún 2 decimales
  assert.equal(formatRuntime(12300), "12.3s")
  assert.equal(formatRuntime(59900), "59.9s")
})

test("minutos + segundos a partir de 60s", () => {
  assert.equal(formatRuntime(60000), "1m 0s")
  assert.equal(formatRuntime(83000), "1m 23s")
  assert.equal(formatRuntime(600000), "10m 0s")
})

test("inválidos → cadena vacía", () => {
  assert.equal(formatRuntime(null), "")
  assert.equal(formatRuntime(undefined), "")
  assert.equal(formatRuntime(-5), "")
  assert.equal(formatRuntime(Infinity), "")
  assert.equal(formatRuntime(NaN), "")
})
