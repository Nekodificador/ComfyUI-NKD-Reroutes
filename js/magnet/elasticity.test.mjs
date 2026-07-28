import assert from "node:assert/strict"
import { test } from "node:test"
import { computeSnap } from "./computeSnap.js"

// Simula el bucle de frames del arrastre tal como lo hace dragAdapter:
// LiteGraph suma el delta del ratón y el imán corrige encima.
//
// Lo que se guarda aquí es que el imán mida desde la posición LIBRE —dónde
// estaría el nodo sin imán— y no desde donde él mismo lo dejó. Midiendo desde
// sí mismo la distancia al enganche nunca crece y el nodo se queda pegado
// para siempre: sólo escaparía moviendo más de `radius` px en un solo frame.
const RADIUS = 60
const OPTS = { radius: RADIUS, matchWidth: false, minWidth: 0 }
const targets = {
  x: [{ ref: "min", offset: 0, value: 100, kind: "edge", column: false, sourceWidth: null, guide: null }],
  y: [],
}

function drag({ measureFromFree, frames = 12, step = 10 }) {
  let nodeX = 100                 // arranca ya enganchado
  let applied = { x: 0, y: 0 }
  const path = []
  for (let i = 0; i < frames; i++) {
    nodeX += step                                     // LiteGraph mueve el ratón
    const rect = { x: nodeX, y: 0, w: 200, h: 100 }
    const measured = measureFromFree ? { ...rect, x: rect.x - applied.x } : rect
    const r = computeSnap(measured, targets, OPTS)
    nodeX += (measured.x + r.dx) - rect.x             // el imán corrige
    applied = { x: r.dx, y: r.dy }
    path.push(nodeX)
  }
  return path
}

test("midiendo desde la posición libre, el nodo escapa al salir del radio", () => {
  const path = drag({ measureFromFree: true })
  assert.equal(path[0], 100, "engancha mientras está cerca")
  assert.ok(path.slice(0, 5).every(x => x === 100), "aguanta dentro del radio")

  const escaped = path.filter(x => x !== 100)
  assert.ok(escaped.length > 0, "acaba soltándose")
  assert.ok(escaped.at(-1) > 100 + RADIUS, "y sigue al ratón una vez suelto")
})

test("midiendo desde la posición ya corregida, se queda pegado para siempre", () => {
  // Regresión: éste es el comportamiento que había y que se sentía atascado.
  const path = drag({ measureFromFree: false })
  assert.ok(path.every(x => x === 100), "nunca escapa por mucho que arrastres")
})
