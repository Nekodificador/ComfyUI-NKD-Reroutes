import assert from "node:assert/strict"
import { test } from "node:test"
import { route } from "./router.js"
import { gapLanes } from "./pcb.js"

// Una columna de LoRAs como la de la captura: 300×160, 18 px entre uno y otro.
const H = 160, GAP = 18
const col = [0, 1, 2, 3].map(i => [100, 30 + i * (H + GAP), 300, H])
const out = (r) => [r[0] + r[2], r[1] + 56]
const inp = (r) => [r[0], r[1] + 56]

test("un carril por el centro de cada hueco estrecho, y ninguno en los anchos", () => {
  assert.deepEqual(gapLanes(col), { xs: [], ys: [199, 377, 555] })
  // hueco de 40 px: los bordes inflados (16) ya dejan carril libre, no hace falta
  assert.deepEqual(gapLanes([[0, 0, 100, 100], [0, 140, 100, 100]]), { xs: [], ys: [] })
  // uno al lado del otro: carril vertical
  assert.deepEqual(gapLanes([[0, 0, 100, 100], [110, 0, 100, 100]]), { xs: [105], ys: [] })
  // sin solaparse en el otro eje no hay hueco entre ellos
  assert.deepEqual(gapLanes([[0, 0, 100, 100], [500, 110, 100, 100]]), { xs: [], ys: [] })
})

test("nodos apilados: el cable baja por el hueco en vez de rodear la columna", () => {
  const lanes = gapLanes(col)
  const r = route({ start: out(col[0]), end: inp(col[1]), obstacles: col, clearance: 16, lanes })
  assert.deepEqual(r, [[400, 86], [424, 86], [424, 199], [76, 199], [76, 264], [100, 264]])
  // sin el carril, la vuelta entera por encima (lo que pasaba)
  const old = route({ start: out(col[0]), end: inp(col[1]), obstacles: col, clearance: 16 })
  assert.ok(old.some(([, y]) => y < col[0][1]), "rodeaba por encima de la columna")
})

test("con esquivar a 1 cruzar sale gratis y se sigue cruzando (es lo que pide ese valor)", () => {
  const r = route({ start: out(col[0]), end: inp(col[1]), obstacles: col, clearance: 16, lanes: gapLanes(col), blockedMult: 1 })
  assert.deepEqual(r, [[400, 86], [76, 86], [76, 264], [100, 264]])
})

test("apilados: se solapan en horizontal y no en vertical", async () => {
  const { apilados } = await import("./pcb.js")
  assert.equal(apilados([100, 30, 300, 160], [100, 208, 300, 160]), true)
  assert.equal(apilados([100, 30, 300, 160], [600, 208, 300, 160]), false)  // al lado, no encima
  assert.equal(apilados([100, 30, 300, 160], [300, 100, 300, 160]), false)  // se pisan en vertical
})

test("con esquivar = 1, un cable entre nodos apilados baja igualmente por el hueco", async () => {
  const { beginFrame, routeFor } = await import("./pcb.js")
  const mk = (id, r) => ({ id, boundingRect: r, pos: [r[0], r[1]], size: [r[2], r[3]], inputs: [{ link: null }], outputs: [{ links: [] }] })
  const nodes = col.map((r, i) => mk(i + 1, r))
  const link = { id: 77, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 }
  nodes[0].outputs[0].links = [77]; nodes[1].inputs[0].link = 77
  const graph = { _nodes: nodes, links: new Map([[77, link]]), getNodeById: (id) => nodes.find(n => n.id === id) }
  beginFrame(graph, { avoidance: 1, spread: false, ignoreShorterThan: 0 })
  const pts = routeFor(77, out(col[0]), inp(col[1]), { graph, link })
  assert.ok(pts.some(([, y]) => y === 199), `baja por el hueco: ${JSON.stringify(pts)}`)
})

test("con esquivar = 1, un cable que vuelve atrás no atraviesa su propio nodo", async () => {
  const { beginFrame, routeFor } = await import("./pcb.js")
  // La captura: salida de un nodo (620..1024 × 120..335) hacia un reroute abajo a la izquierda.
  const src = { id: 1, boundingRect: [620, 120, 404, 215], pos: [620, 150], size: [404, 185], inputs: [], outputs: [{ links: [9] }] }
  const otro = { id: 2, boundingRect: [145, 120, 404, 215], pos: [145, 150], size: [404, 185], inputs: [{ link: null }], outputs: [] }
  const link = { id: 9, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 }
  const nodes = [src, otro]
  const graph = { _nodes: nodes, links: new Map([[9, link]]), getNodeById: (id) => nodes.find(n => n.id === id) }
  beginFrame(graph, { avoidance: 1, spread: false, ignoreShorterThan: 0 })
  const pts = routeFor(9, [1024, 195], [665, 505], { graph, link, endIsReroute: true })
  // sale a la derecha y baja por fuera del nodo antes de volver a la izquierda
  assert.ok(pts[1][0] >= 1024, `primero a la derecha: ${JSON.stringify(pts)}`)
  const cruza = pts.some((p, k) => k > 0 && p[1] === pts[k - 1][1] && p[1] > 120 && p[1] < 335 &&
    Math.min(p[0], pts[k - 1][0]) < 1020 && Math.max(p[0], pts[k - 1][0]) > 624)
  assert.ok(!cruza, `no atraviesa el nodo de salida: ${JSON.stringify(pts)}`)
})
