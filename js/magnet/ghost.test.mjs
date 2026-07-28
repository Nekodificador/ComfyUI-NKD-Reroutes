import assert from "node:assert/strict"
import { test } from "node:test"
import { computeSnap } from "./computeSnap.js"

// El imán no mueve el nodo durante el arrastre: sólo calcula, y lo que se ve es
// la silueta. El nodo va libre siguiendo al ratón y el salto ocurre al soltar.
//
// Lo que se guarda aquí es que el enganche SUELTE cuando la posición libre sale
// del radio. Si no soltara, la silueta se quedaría clavada en un destino que ya
// has abandonado y acabarías soltando el nodo en un sitio que no querías.
//
// La posición libre se reconstruye del recorrido del puntero (ver dragAdapter),
// no de dónde está el nodo, porque los dos renderizadores lo mueven de forma
// incompatible: LiteGraph suma deltas y la ruta Vue reescribe la posición
// absoluta desde el origen del arrastre.
const RADIUS = 60
const OPTS = { radius: RADIUS, matchWidth: false, minWidth: 0 }
const targets = {
  x: [{ ref: "min", offset: 0, value: 100, kind: "edge", column: false, sourceWidth: null, guide: null }],
  y: [],
}

// Dónde caería el nodo en cada frame, según se aleja el ratón del enganche.
function ghostPath({ frames = 12, step = 10 } = {}) {
  const path = []
  for (let i = 1; i <= frames; i++) {
    const free = { x: 100 + i * step, y: 0, w: 200, h: 100 }
    const r = computeSnap(free, targets, OPTS)
    path.push(free.x + r.dx)
  }
  return path
}

test("la silueta aguanta en el enganche mientras el ratón está dentro del radio", () => {
  const path = ghostPath()
  assert.equal(path[0], 100, "engancha nada más entrar")
  assert.ok(path.slice(0, 5).every(x => x === 100), "y aguanta dentro del radio")
})

test("la silueta suelta y sigue al ratón al salir del radio", () => {
  const path = ghostPath()
  const libres = path.filter(x => x !== 100)
  assert.ok(libres.length > 0, "acaba soltándose")
  assert.ok(libres.at(-1) > 100 + RADIUS, "y a partir de ahí va con el ratón")
  assert.ok(
    libres.every((x, i) => i === 0 || x > libres[i - 1]),
    "sin volver atrás: una vez suelto, avanza monótonamente",
  )
})
