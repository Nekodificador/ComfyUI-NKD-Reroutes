import assert from "node:assert/strict"
import { test } from "node:test"
import {
  sampleCut, hitSegments, layoutLanes, reconcileBuses,
  busRect, memberAtCut, nextBusId, onePerLink, busGap, catchBar, relayout, grabAt, BAR_W, BAR_PAD,
} from "./computeBus.js"

test("sampleCut: incluye los dos extremos y no supera el paso", () => {
  const pts = sampleCut([0, 0], [0, 10], 4)
  assert.deepEqual(pts[0], [0, 0])
  assert.deepEqual(pts.at(-1), [0, 10])
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i][1] - pts[i - 1][1] <= 4)
})

test("sampleCut: un clic sin arrastre da dos puntos iguales", () => {
  assert.deepEqual(sampleCut([5, 5], [5, 5]), [[5, 5], [5, 5]])
})

// Cables de prueba horizontales: "en el trazo" = a menos de 3 px de su y.
const segs = [{ id: "a", y: 0 }, { id: "b", y: 20 }, { id: "c", y: 200 }]
const onStroke = (s, x, y) => Math.abs(y - s.y) <= 3

test("hitSegments: sólo los cables que cruza la línea, por donde los cruza", () => {
  const hits = hitSegments(sampleCut([0, -10], [0, 30], 1), segs, onStroke)
  assert.deepEqual(hits.map(h => h.seg.id), ["a", "b"])
  assert.ok(Math.abs(hits[0].y - 0) <= 1)
  assert.ok(Math.abs(hits[1].y - 20) <= 1)
})

test("hitSegments: sin cruces, vacío", () => {
  assert.deepEqual(hitSegments(sampleCut([0, 50], [0, 60], 1), segs, onStroke), [])
})

test("layoutLanes: ordena por la y de corte, centra y separa por gap", () => {
  const out = layoutLanes([
    { seg: "b", x: 10, y: 30 },
    { seg: "a", x: 20, y: 10 },
    { seg: "c", x: 30, y: 50 },
  ], 20)
  assert.equal(out.x, 20)
  assert.deepEqual(out.lanes, [
    { seg: "a", y: 10 },
    { seg: "b", y: 30 },
    { seg: "c", y: 50 },
  ])
})

test("layoutLanes: dos carriles quedan simétricos respecto a la media", () => {
  const out = layoutLanes([{ seg: "a", x: 0, y: 0 }, { seg: "b", x: 0, y: 2 }], 20)
  assert.deepEqual(out.lanes.map(l => l.y), [-9, 11])
})

test("layoutLanes: sin impactos, null", () => {
  assert.equal(layoutLanes([], 20), null)
})

test("reconcileBuses: descarta ids muertos y buses de menos de 2", () => {
  const alive = new Set([1, 2, 3, 5])
  const out = reconcileBuses([
    { id: 1, rerouteIds: [1, 2, 9] },
    { id: 2, rerouteIds: [3, 8] },
    { id: 3, rerouteIds: [5, 3] },
  ], alive)
  assert.deepEqual(out, [
    { id: 1, rerouteIds: [1, 2] },
    { id: 3, rerouteIds: [5, 3] },
  ])
})

test("reconcileBuses: tolera basura en extra", () => {
  assert.deepEqual(reconcileBuses(undefined, new Set()), [])
  assert.deepEqual(reconcileBuses([null, { id: 1 }], new Set([1])), [])
})

test("busRect: barra vertical centrada en la x media, con margen", () => {
  const r = busRect([{ x: 100, y: 0 }, { x: 102, y: 40 }])
  assert.deepEqual(r, { x: 101 - BAR_W / 2, y: -BAR_PAD, w: BAR_W, h: 40 + 2 * BAR_PAD })
})

test("memberAtCut: el carril más cercano al punto de cruce", () => {
  const ms = [{ id: 7, y: 0 }, { id: 8, y: 20 }, { id: 9, y: 40 }]
  const rect = busRect(ms.map(m => ({ x: 100, y: m.y })))
  assert.equal(memberAtCut(rect, ms, [80, 18], [120, 26]), 8)
})

test("memberAtCut: no cruza la barra → null", () => {
  const ms = [{ id: 7, y: 0 }, { id: 8, y: 20 }]
  const rect = busRect(ms.map(m => ({ x: 100, y: m.y })))
  assert.equal(memberAtCut(rect, ms, [10, 10], [50, 10]), null)       // no llega a la x
  assert.equal(memberAtCut(rect, ms, [80, 200], [120, 200]), null)    // pasa por debajo
  assert.equal(memberAtCut(rect, ms, [100, -50], [100, 50]), null)    // vertical: no cruza
})

test("nextBusId: uno más que el mayor", () => {
  assert.equal(nextBusId([]), 1)
  assert.equal(nextBusId([{ id: 3 }, { id: 7 }]), 8)
})

test("onePerLink: un carril por cable aunque el corte cruce dos de sus tramos", () => {
  const hits = [
    { seg: { links: [1] },    y: 0 },
    { seg: { links: [2] },    y: 10 },
    { seg: { links: [1] },    y: 20 },   // otro tramo del cable 1
    { seg: { links: [2, 3] }, y: 30 },   // reroute compartido que incluye el 2
  ]
  assert.deepEqual(onePerLink(hits, s => s.links).map(h => h.y), [0, 10])
})

test("busGap: la separación que ya tiene el bus, o la de los ajustes", () => {
  assert.equal(busGap([{ y: 0 }, { y: 30 }, { y: 60 }], 20), 30)
  assert.equal(busGap([{ y: 5 }], 20), 20)
})

test("catchBar: cerca del eje y dentro de la altura, con margen", () => {
  const rects = [busRect([{ x: 100, y: 0 }, { x: 100, y: 40 }])]
  assert.equal(catchBar(rects, [110, 20], 15), 0)
  assert.equal(catchBar(rects, [130, 20], 15), -1)   // demasiado a un lado
  assert.equal(catchBar(rects, [100, 90], 15), -1)   // muy por debajo
})

test("relayout: reordenar baja un carril al hueco de abajo sin mover el de arriba", () => {
  // carriles a(0) b(20) c(40); se suelta a en y=30, entre b y c
  const out = relayout([{ id: "b", y: 20 }, { id: "c", y: 40 }], "a", 30, 20)
  assert.deepEqual(out, [{ id: "b", y: 20 }, { id: "a", y: 40 }, { id: "c", y: 60 }])
})

test("relayout: unir por arriba lo pone el primero", () => {
  const out = relayout([{ id: "b", y: 20 }, { id: "c", y: 40 }], "n", -100, 20)
  assert.deepEqual(out.map(m => m.id), ["n", "b", "c"])
  assert.deepEqual(out.map(m => m.y), [20, 40, 60])
})

test("grabAt: las tapas mueven el bus, el resto el carril más cercano", () => {
  const ms = [{ id: 1, y: 0 }, { id: 2, y: 20 }, { id: 3, y: 40 }]
  assert.deepEqual(grabAt(ms, -10), { bus: true })
  assert.deepEqual(grabAt(ms, 50), { bus: true })
  assert.deepEqual(grabAt(ms, 18), { lane: 2 })
  assert.deepEqual(grabAt(ms, -3), { lane: 1 })
})

test("relayout: con top explícito, levantar el carril de arriba no baja el bus", () => {
  // a(0) b(20) c(40); se levanta a y se suelta abajo del todo
  const out = relayout([{ id: "b", y: 20 }, { id: "c", y: 40 }], "a", 99, 20, 0)
  assert.deepEqual(out, [{ id: "b", y: 0 }, { id: "c", y: 20 }, { id: "a", y: 40 }])
})
