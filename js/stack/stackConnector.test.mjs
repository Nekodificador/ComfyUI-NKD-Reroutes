import assert from "node:assert/strict"
import { test } from "node:test"
import { stackPair, connectorGeometry } from "./stackConnector.js"

const A = [100, 30, 300, 160]    // arriba
const B = [100, 208, 300, 160]   // debajo, a 18 px

test("pila: solapan en horizontal y el hueco cabe en el umbral", () => {
  assert.deepEqual(stackPair(A, B, 30), { upper: A, lower: B, gap: 18 })
  assert.deepEqual(stackPair(B, A, 30), { upper: A, lower: B, gap: 18 })   // da igual el orden
  assert.equal(stackPair(A, B, 10), null)                                  // más hueco que el umbral
  assert.equal(stackPair(A, [600, 208, 300, 160], 30), null)               // al lado, no debajo
  assert.equal(stackPair(A, [100, 150, 300, 160], 30), null)               // se pisan
  assert.deepEqual(stackPair(A, [100, 190, 300, 160], 30).gap, 0)          // pegados
})

test("un cable: lentes planas en cada borde, de esquina a esquina, trazo por el centro", () => {
  const g = connectorGeometry(stackPair(A, B, 30), 0, 1, 12)
  // empiezan justo donde acaba la curva de la esquina (radio 12)
  assert.deepEqual(g.top, { x0: 112, x1: 388, y: 190, dir: 1 })
  assert.deepEqual(g.bottom, { x0: 112, x1: 388, y: 208, dir: -1 })
  assert.deepEqual(g.line, [250, 190, 250, 208])
})

test("dos cables entre el mismo par: tramos uno al lado del otro, sin pisarse", () => {
  const p = stackPair(A, B, 30)
  const g0 = connectorGeometry(p, 0, 2, 12), g1 = connectorGeometry(p, 1, 2, 12)
  assert.equal(g0.top.x0, 112)
  assert.equal(g1.top.x1, 388)
  assert.ok(g0.top.x1 < g1.top.x0)
  assert.ok(g0.line[0] < g1.line[0])
})

test("anchos distintos: sólo el tramo que comparten", () => {
  const g = connectorGeometry(stackPair([100, 30, 300, 160], [250, 200, 400, 100], 30), 0, 1, 8)
  assert.equal(g.top.x0, 258)
  assert.equal(g.top.x1, 392)
})

test("forma de la soldadura: hueco + muescas, nada bajo los nodos", async () => {
  const { weldPath } = await import("./stackConnector.js")
  const P = Math.PI
  // mismo ancho: las cuatro esquinas recortadas por su arco
  assert.deepEqual(weldPath(stackPair(A, B, 30), 12), [
    ["M", 100, 178], ["A", 112, 178, 12, P, P / 2],
    ["L", 388, 190], ["A", 388, 178, 12, P / 2, 0],
    ["L", 400, 220], ["A", 388, 220, 12, 0, -P / 2],
    ["L", 112, 208], ["A", 112, 220, 12, -P / 2, -P],
  ])
  // nunca se mete por debajo: lo más alto es el arranque de la esquina de arriba
  // y lo más bajo el de la de abajo, y en el centro del ancho sólo hay hueco
  const ys = weldPath(stackPair(A, B, 30), 12).filter(o => o[0] !== "A").map(o => o[2])
  assert.ok(Math.min(...ys) >= 190 - 12 && Math.max(...ys) <= 208 + 12)
  // el de abajo más ancho por la derecha: su esquina derecha no toca el tramo, borde recto
  const wide = weldPath(stackPair(A, [100, 208, 500, 160], 30), 12)
  assert.deepEqual(wide[4], ["L", 400, 208])
})

test("bloques: pares que comparten nodo se juntan, los sueltos no", async () => {
  const { stackGroups } = await import("./stackConnector.js")
  const g = stackGroups([{ a: 1, b: 2 }, { a: 2, b: 3 }, { a: 7, b: 8 }, { a: 1, b: 2 }])
  assert.equal(g.length, 2)
  assert.deepEqual([...g[0].ids].sort(), [1, 2, 3])
  assert.equal(g[0].pairs.length, 3)   // los dos cables 1→2 cuentan como pares
  assert.deepEqual([...g[1].ids].sort(), [7, 8])
})

test("cambiar de alto mueve al bloque de debajo; arrastrar no", async () => {
  const { growPushes } = await import("./stackConnector.js")
  const prev = new Map([[1, [0, 0, 200, 100]], [2, [0, 118, 200, 80]], [3, [0, 216, 200, 80]], [4, [300, 0, 200, 80]]])
  const pairs = [{ up: 1, low: 2 }, { up: 2, low: 3 }]
  const con = (id, r) => new Map([...prev, [id, r]])
  assert.deepEqual([...growPushes(prev, pairs, con(1, [0, 0, 200, 160]))], [[2, 60], [3, 60]])   // crece: cadena entera, el 4 no
  assert.deepEqual([...growPushes(prev, pairs, con(1, [0, 0, 200, 70]))], [[2, -30], [3, -30]])  // encoge: suben
  assert.equal(growPushes(prev, pairs, con(1, [0, 40, 200, 100])).size, 0)                       // arrastrar el de arriba
  assert.equal(growPushes(prev, pairs, con(2, [0, 300, 200, 80])).size, 0)                       // arrastrar el de en medio: el de abajo se queda
  assert.deepEqual([...growPushes(prev, pairs, con(2, [0, 118, 200, 100]))], [[3, 20]])          // el de en medio
  // crecen dos a la vez: el de abajo del todo suma los dos
  const dos = new Map([...prev, [1, [0, 0, 200, 150]], [2, [0, 118, 200, 90]]])
  assert.deepEqual([...growPushes(prev, pairs, dos)], [[2, 50], [3, 60]])
  // estirar el de abajo por ARRIBA: sube lo que tiene encima, en cadena
  assert.deepEqual([...growPushes(prev, pairs, con(3, [0, 186, 200, 110]))], [[2, -30], [1, -30]])
  // encogerlo por arriba: baja lo de encima
  assert.deepEqual([...growPushes(prev, pairs, con(3, [0, 236, 200, 60]))], [[2, 20], [1, 20]])
  // el de en medio por arriba: sube el 1 y el 3 se queda
  assert.deepEqual([...growPushes(prev, pairs, con(2, [0, 98, 200, 100]))], [[1, -20]])
})
