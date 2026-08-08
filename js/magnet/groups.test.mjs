import assert from "node:assert/strict"
import { test } from "node:test"
import { computeSnap } from "./computeSnap.js"
import { collectResizeTargets, collectSnapTargets, expandDragged, rectOf } from "./snapTargets.js"

// Doble de LGraphGroup: lo mínimo que mira el imán —pos, size, children y el
// método que lo distingue de un nodo—.
const group = (x, y, w, h, children = []) => ({
  pos: [x, y], size: [w, h], children: new Set(children),
  recomputeInsideNodes() {},
})

// rectOf mira LiteGraph para la barra de título de los nodos.
globalThis.LiteGraph ??= { NODE_TITLE_HEIGHT: 30, NODE_COLLAPSED_WIDTH: 80 }

const node = (x, y, w, h) => ({ pos: [x, y], size: [w, h], inputs: [], outputs: [], flags: {} })
const graphOf = (...groups) => ({ nodes: [], groups })
const OPTS = { gapX: 36, gapY: 12 }
const SNAP = { radius: 20, matchWidth: false, minWidth: 0 }

test("el rectángulo del grupo NO descuenta barra de título", () => {
  assert.deepEqual(rectOf(group(10, 20, 300, 200)), { x: 10, y: 20, w: 300, h: 200 })
})

test("expandDragged arrastra a los hijos del grupo", () => {
  const child = { pos: [0, 0] }
  const g = group(0, 0, 100, 100, [child])
  const out = expandDragged(new Set([g]))
  assert.ok(out.has(child))
})

test("un grupo se adosa al de al lado con el hueco horizontal", () => {
  const dragged = group(500, 100, 200, 300)
  const other   = group(100, 100, 300, 300)
  const targets = collectSnapTargets(graphOf(dragged, other), new Set([dragged]),
    rectOf(dragged), OPTS)

  // libre a 8 px del destino (400 + gapX = 436)
  const out = computeSnap({ x: 444, y: 100, w: 200, h: 300 }, targets, SNAP)
  assert.equal(out.dx, -8)
})

test("un grupo adopta el ancho de la columna de grupos", () => {
  const dragged = group(110, 400, 200, 300)
  const other   = group(100, 100, 300, 300)
  const targets = collectSnapTargets(graphOf(dragged, other), new Set([dragged]),
    rectOf(dragged), OPTS)

  const out = computeSnap(rectOf(dragged), targets, { ...SNAP, matchWidth: true })
  assert.equal(out.width, 300)
})

test("un nodo no se imanta con los grupos", () => {
  const dragged = node(500, 100, 200, 300)
  const graph   = { nodes: [dragged], groups: [group(100, 100, 300, 300)] }
  const targets = collectSnapTargets(graph, new Set([dragged]), rectOf(dragged), OPTS)
  assert.deepEqual(targets, { x: [], y: [] })
})

test("un grupo no se imanta con los nodos", () => {
  const dragged = group(500, 100, 200, 300)
  const graph   = { nodes: [node(100, 100, 300, 300)], groups: [dragged] }
  const targets = collectSnapTargets(graph, new Set([dragged]), rectOf(dragged), OPTS)
  assert.deepEqual(targets, { x: [], y: [] })
})

test("redimensionar un grupo sólo mira a otros grupos", () => {
  const g = group(100, 100, 300, 200)
  const graph = { nodes: [node(500, 100, 300, 230)], groups: [g] }
  assert.deepEqual(collectResizeTargets(graph, g, OPTS), { x: [], y: [] })
})

test("redimensionar cuadra el borde inferior con el del vecino", () => {
  const g     = group(100, 100, 300, 200)
  const other = group(500, 100, 300, 260)   // fondo en 360
  const targets = collectResizeTargets(graphOf(g, other), g, OPTS)

  // g mide 200 de alto (fondo en 300); el vecino acaba en 360 → +60 fuera
  // del radio. A 250 de alto (fondo 350) sí engancha: +10.
  const out = computeSnap({ x: 100, y: 100, w: 300, h: 250 }, targets, SNAP)
  assert.equal(out.dy, 10)
})

test("por la esquina NW se enganchan los bordes izquierdo y superior", () => {
  const item  = group(300, 300, 300, 200)
  const other = group(100, 100, 300, 260)
  const targets = collectResizeTargets(graphOf(item, other), item, OPTS, "NW")

  // Todos los candidatos miran al borde mínimo: por el noroeste no se mueve
  // ni el borde derecho ni el inferior.
  assert.ok(targets.x.every(t => t.ref === "min"))
  assert.ok(targets.y.every(t => t.ref === "min"))

  // Arrastrada la esquina hasta 108,108: engancha con el origen del vecino.
  const out = computeSnap({ x: 108, y: 108, w: 492, h: 392 }, targets, SNAP)
  assert.equal(out.dx, -8)
  assert.equal(out.dy, -8)
})

test("redimensionar ignora al propio grupo y a sus hijos", () => {
  const child = { pos: [110, 110], size: [50, 50], children: new Set(), recomputeInsideNodes() {} }
  const g = group(100, 100, 300, 200, [child])
  const targets = collectResizeTargets(graphOf(g, child), g, OPTS)
  assert.deepEqual(targets, { x: [], y: [] })
})

// ── Nodos virtuales (Set/Get) ───────────────────────────────────────────────
//
// Son pastillas de sólo frontend, pero con sockets y enlaces de verdad. El
// imán los excluía de la regla del socket, así que enganchaban por los bordes y
// nunca por el cable — justo lo contrario de lo que uno quiere al colocar una
// variable junto a la salida de la que cuelga.
test("un nodo virtual cuadra su socket con el vecino del cable", () => {
  const emisor = {
    id: 1, pos: [0, 100], size: [200, 80], flags: {}, inputs: [], outputs: [{ links: [5] }],
    getConnectionPos: () => [200, 140],
  }
  // La pastilla: virtual, un input conectado, y arrastrada doce píxeles por debajo.
  const pastilla = {
    id: 2, pos: [300, 142], size: [120, 26], flags: {}, isVirtualNode: true,
    inputs: [{ link: 5 }], outputs: [],
    getConnectionPos: () => [300, 152],
  }
  const graph = {
    nodes: [emisor, pastilla], groups: [],
    links: new Map([[5, { id: 5, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 }]]),
    getNodeById: (id) => (id === 1 ? emisor : pastilla),
    reroutes: new Map(),
  }

  const out = collectSnapTargets(graph, new Set([pastilla]), rectOf(pastilla), OPTS)
  const socket = out.y.find(t => t.kind === "socket")
  assert.ok(socket, "tiene que salir un objetivo de socket para el nodo virtual")
  assert.equal(socket.value, 140, "y apuntar a la altura del socket del emisor")

  // Y que el imán lo aplique: el socket sube de 152 a 140, doce píxeles, que
  // caben dentro del radio.
  assert.equal(computeSnap(rectOf(pastilla), out, SNAP).dy, -12)
})
