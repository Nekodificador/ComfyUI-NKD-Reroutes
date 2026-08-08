// Separación de tramos que comparten carril — función pura. Sin DOM, sin
// LiteGraph, sin app.
//
// Tomado de comfyui-cable-management (MIT), de Vedran Aberle Tokić:
// https://github.com/vtokic/comfyui-cable-management — fichero web/pathing/nudge.js.
// Copiado sin tocar, por lo mismo que router.js: es geometría pura y sus
// comentarios documentan casos medidos que no se ven en el código.
//
// MIT License — Copyright (c) 2026 Vedran Aberle Tokić
//
// ─────────────────────────────────────────────────────────────────────────────
// Qué resuelve: los carriles separan cables que comparten un lado de nodo, y
// las cintas agrupan los que van entre los mismos dos nodos. Ninguna de las dos
// cubre a cables SIN RELACIÓN que acaban recorriendo el mismo pasillo — se
// dibujan uno encima de otro y parecen un solo cable. Esto los reparte en
// hebras paralelas.
//
// Los rabitos (primer y último tramo) no se mueven nunca: tienen que acabar en
// el socket. Desplazar el primer giro cambia el LARGO del rabito, que es lo que
// abre en abanico los cables de un nodo plegado.

const LANE = 8
// Segments within this many px share a lane cluster. Must stay BELOW the registry's
// 5px STUB_PITCH: allocated neighbour lanes are deliberate geometry, and clustering
// them would re-spread the pin ladder back out to 8px.
const CLUSTER = 4
const MIN_STUB = 12
const OVERLAP = 2 // spans must share more than this along the lane to collide
const CLEAR = 6 // spread strands keep this many px off a node box

export function nudgePass(entries, obstacles = []) {
  for (const e of entries) e.pts = e.raw.map((p) => [p[0], p[1]])

  spread(entries, 0, obstacles) // vertical runs, shift x
  spread(entries, 1, obstacles) // horizontal runs, shift y
}

function spread(entries, axis, obstacles) {
  // axis 0: vertical segments (constant x, shift x). axis 1: horizontal (shift y).
  const along = axis === 0 ? 1 : 0
  const segs = []
  for (const e of entries) {
    const pts = e.pts
    for (let k = 1; k < pts.length - 2; k++) {
      const a = pts[k], b = pts[k + 1]
      const isV = Math.abs(a[0] - b[0]) < 0.1
      if ((axis === 0 && isV) || (axis === 1 && !isV && Math.abs(a[1] - b[1]) < 0.1)) {
        segs.push({
          e, k,
          coord: axis === 0 ? a[0] : a[1],
          span: [Math.min(a[along], b[along]), Math.max(a[along], b[along])]
        })
      }
    }
  }
  segs.sort((s, t) => s.coord - t.coord || String(s.e.key).localeCompare(String(t.e.key)))

  // Collision is PAIRWISE: within CLUSTER px on the lane axis AND longitudinally
  // overlapped by more than OVERLAP px. Groups form only through actual collision
  // edges -- proximity chains must not transfer membership. A span-disjoint segment
  // sitting between two properly spaced runs would otherwise bridge them into one
  // cluster and re-spread a ribbon it never touched (QA: the lora_stack kink opened
  // a gap between clip and vae strands whose own coords are a full lane apart).
  const parent = segs.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length && segs[j].coord - segs[i].coord <= CLUSTER; j++) {
      const a = segs[i].span, b = segs[j].span
      if (Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > OVERLAP) parent[find(j)] = find(i)
    }
  }
  const groups = new Map()
  segs.forEach((s, i) => {
    const root = find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(s)
  })
  for (const comp of groups.values()) {
    if (comp.length > 1) spreadComponent(comp, axis, along, obstacles)
  }
}

// Free corridor around a cluster's lane: nearest obstacle edge on each side of the
// shift axis, among obstacles that longitudinally overlap the cluster's union span.
// A rect the lane already runs THROUGH is skipped -- the router priced that; no
// sideways shuffle inside a node helps.
function corridor(cluster, axis, along, obstacles, center) {
  let s0 = Infinity, s1 = -Infinity
  for (const s of cluster) {
    if (s.span[0] < s0) s0 = s.span[0]
    if (s.span[1] > s1) s1 = s.span[1]
  }
  let lo = -Infinity, hi = Infinity
  for (const r of obstacles) {
    const rl = axis === 0 ? r[1] : r[0], rh = rl + (axis === 0 ? r[3] : r[2])
    if (Math.min(rh, s1) - Math.max(rl, s0) <= OVERLAP) continue
    const b0 = axis === 0 ? r[0] : r[1], b1 = b0 + (axis === 0 ? r[2] : r[3])
    if (b1 <= center && b1 + CLEAR > lo) lo = b1 + CLEAR
    else if (b0 >= center && b0 - CLEAR < hi) hi = b0 - CLEAR
  }
  return [lo, hi]
}

function spreadComponent(cluster, axis, along, obstacles) {
  // Anti-braid lane order, pairwise: for members L and R of one corridor, placing
  // L on the -perp side costs one crossing for every R attachment (the horizontal
  // entering/leaving R's run) that extends toward -perp THROUGH L's span, and vice
  // versa. Sorting by that comparator picks the right order for both the staircase
  // pattern (stepped entries, stepped exits) and the nested pattern (entries
  // inside each other's spans) -- no single-key ordering covers both. Comparator
  // may be non-transitive in pathological mixes; "prefer to avoid" is the spec.
  const meta = cluster.map((s) => {
    const pts = s.e.pts
    const a = pts[s.k], b = pts[s.k + 1]
    const lane = a[axis]
    const att = []
    const prev = pts[s.k - 1], next = pts[s.k + 2]
    if (prev) att.push({ y: a[along], dir: Math.sign(prev[axis] - lane) || 0 })
    if (next) att.push({ y: b[along], dir: Math.sign(next[axis] - lane) || 0 })
    return { s, span: s.span, att }
  })
  const covers = (span, y) => y > span[0] + 1 && y < span[1] - 1
  const cost = (L, R) => {
    let c = 0
    for (const a of R.att) if (a.dir < 0 && covers(L.span, a.y)) c++
    for (const a of L.att) if (a.dir > 0 && covers(R.span, a.y)) c++
    return c
  }
  meta.sort((p, q) => cost(p, q) - cost(q, p) || String(p.s.e.key).localeCompare(String(q.s.e.key)))
  const ordered = meta.map((m) => m.s)
  const mid = (ordered.length - 1) / 2
  // Bias the fan away from the nearest node instead of centring it blindly on the
  // lane -- the lane is an inflated node edge, so half the spread otherwise walks
  // INTO the node (polish round: bunched gap runs pushed under neighbours). Minimal
  // shift when the corridor fits the fan; corridor centre when it cannot (overflow
  // splits evenly instead of one side eating all of it).
  let cmin = Infinity, cmax = -Infinity
  for (const s of cluster) {
    if (s.coord < cmin) cmin = s.coord
    if (s.coord > cmax) cmax = s.coord
  }
  const centre = (cmin + cmax) / 2
  const half = mid * LANE
  const [lo, hi] = corridor(cluster, axis, along, obstacles, centre)
  let shift = 0
  if (hi - lo >= 2 * half) {
    if (centre - half < lo) shift = lo - (centre - half)
    else if (centre + half > hi) shift = hi - (centre + half)
  } else {
    shift = (lo + hi) / 2 - centre // narrow corridor: both bounds are finite here
  }
  ordered.forEach((s, i) => {
    const offset = (i - mid) * LANE + shift
    if (offset === 0) return
    const pts = s.e.pts
    const a = pts[s.k], b = pts[s.k + 1]
    const orig = a[axis]
    const nv = orig + offset
    // Keep the adjacent stubs honest: same side as the pin, never shorter than MIN_STUB.
    // (Perpendicularity is guaranteed -- simplify() merged collinear runs -- so a shift
    // only ever changes a stub's length, not its orientation.)
    if (s.k === 1 && !stubOk(pts[0][axis], orig, nv)) return
    if (s.k === pts.length - 3 && !stubOk(pts[pts.length - 1][axis], orig, nv)) return
    a[axis] = nv
    b[axis] = nv
  })
}

function stubOk(pin, orig, nv) {
  const d = nv - pin
  return Math.sign(d) === Math.sign(orig - pin) && Math.abs(d) >= MIN_STUB
}
