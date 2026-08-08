import assert from "node:assert/strict"
import { test } from "node:test"
import { wrapCollapse } from "./collapseAnchor.js"

// Doble de nodo con la geometría real de LiteGraph: `pos[1]` es el borde
// superior del CUERPO, la barra de título va justo encima, y un nodo plegado se
// dibuja sólo con esa barra —así que sus sockets caen a media barra, POR ENCIMA
// del primer socket del nodo desplegado. Ese salto es lo que se corrige.
const TITULO = 30
const PRIMER_SLOT = 10   // el primer socket, contando desde el cuerpo

function nodo(y, { inputs = 1, outputs = 0 } = {}) {
  return {
    pos: [500, y],
    flags: { collapsed: false },
    inputs: Array.from({ length: inputs }, () => ({})),
    outputs: Array.from({ length: outputs }, () => ({})),
    getConnectionPos(isInput, slot, out = []) {
      const y = this.flags.collapsed
        ? this.pos[1] - TITULO / 2
        : this.pos[1] + PRIMER_SLOT + slot * 20
      out[0] = this.pos[0]
      out[1] = y
      return out
    },
    collapse() { this.flags.collapsed = !this.flags.collapsed },
  }
}

const encendido = { collapseKeepsWire: true }
const socketY = (n) => n.getConnectionPos(n.inputs.length > 0, 0, [])[1]

test("plegar no mueve el cable de sitio", () => {
  const n = nodo(300)
  n.collapse = wrapCollapse(n.collapse, encendido)
  const antes = socketY(n)

  n.collapse()
  assert.equal(n.flags.collapsed, true, "se ha plegado")
  assert.equal(socketY(n), antes, "el socket tiene que quedarse donde estaba")
})

test("desplegar devuelve el nodo a su sitio exacto", () => {
  const n = nodo(300)
  n.collapse = wrapCollapse(n.collapse, encendido)
  const posOriginal = n.pos[1]

  n.collapse()
  assert.notEqual(n.pos[1], posOriginal, "plegar sí mueve el NODO (para no mover el cable)")
  n.collapse()
  assert.equal(n.pos[1], posOriginal, "y desplegar lo devuelve exactamente")
})

// Ida y vuelta muchas veces: si el cálculo no fuera simétrico, el nodo iría
// derivando un poco en cada ciclo y al cabo de un rato estaría en otro sitio.
test("plegar y desplegar en bucle no va desplazando el nodo", () => {
  const n = nodo(300)
  n.collapse = wrapCollapse(n.collapse, encendido)
  const posOriginal = n.pos[1]
  for (let i = 0; i < 20; i++) { n.collapse(); n.collapse() }
  assert.equal(n.pos[1], posOriginal)
})

// Una Get no tiene entradas: la referencia pasa a ser su salida.
test("un nodo sin entradas se ancla a su salida", () => {
  const n = nodo(300, { inputs: 0, outputs: 1 })
  n.collapse = wrapCollapse(n.collapse, encendido)
  const antes = n.getConnectionPos(false, 0, [])[1]
  n.collapse()
  assert.equal(n.getConnectionPos(false, 0, [])[1], antes)
})

test("apagado, se pliega como siempre y el nodo no se mueve", () => {
  const n = nodo(300)
  n.collapse = wrapCollapse(n.collapse, { collapseKeepsWire: false })
  n.collapse()
  assert.equal(n.pos[1], 300, "sin la corrección el nodo se queda quieto")
  assert.notEqual(socketY(n), 310, "y por eso el cable sí pega el salto")
})

// Un nodo que no se deja plegar no puede acabar desplazado por intentarlo.
test("si el nodo no se pliega, no se mueve", () => {
  const n = nodo(300)
  n.collapse = wrapCollapse(function () { /* no colapsable: no hace nada */ }, encendido)
  n.collapse()
  assert.equal(n.pos[1], 300)
})
