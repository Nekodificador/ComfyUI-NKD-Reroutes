// Motor puro del bus de reroutes: sin DOM ni LiteGraph, para poder probarlo
// bajo node. El adaptador (busAdapter.js) le pasa coordenadas de grafo y un
// predicado de hit-test; aquí sólo hay geometría.

export const BAR_W   = 6   // ancho de la barra, en px de grafo
export const BAR_PAD = 8   // lo que sobresale la barra por encima del primer carril y por debajo del último

// Puntos a lo largo de la línea de corte, a no más de `step` px entre sí.
export function sampleCut(a, b, step = 4) {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step))
  const pts = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  return pts
}

// Qué segmentos corta la línea y por dónde. El punto de corte es el centro de
// la PRIMERA racha de muestras sobre el trazo: el cable tiene grosor, así que
// una línea inclinada lo toca en varias muestras seguidas.
// ponytail: muestreo con isPointInStroke, O(segmentos × muestras); basta para
// un gesto puntual. Si un grafo enorme lo nota, filtrar antes por bounding box.
export function hitSegments(cutPts, segments, onStroke) {
  const hits = []
  for (const seg of segments) {
    let first = -1, last = -1
    for (let i = 0; i < cutPts.length; i++) {
      if (onStroke(seg, cutPts[i][0], cutPts[i][1])) { if (first < 0) first = i; last = i }
      else if (first >= 0) break
    }
    if (first < 0) continue
    const [x, y] = cutPts[Math.floor((first + last) / 2)]
    hits.push({ seg, x, y })
  }
  return hits
}

// Carriles del bus: ordenados por la y en que la línea cruza cada cable —así no
// se cruzan entre sí—, centrados en la y media y separados `gap`. La barra va
// en la x media del corte.
export function layoutLanes(hits, gap) {
  if (!hits.length) return null
  const sorted = [...hits].sort((p, q) => p.y - q.y)
  const n  = sorted.length
  const x  = sorted.reduce((s, h) => s + h.x, 0) / n
  const cy = sorted.reduce((s, h) => s + h.y, 0) / n
  return { x, lanes: sorted.map((h, i) => ({ seg: h.seg, y: cy + (i - (n - 1) / 2) * gap })) }
}

// Lo que haya en graph.extra.nkdBuses contra los reroutes que existen de verdad.
// Alguien sin la extensión puede haber borrado reroutes: sus ids se descartan, y
// un bus con menos de 2 deja de serlo (sus reroutes se quedan sueltos).
export function reconcileBuses(buses, alive) {
  if (!Array.isArray(buses)) return []
  const out = []
  for (const b of buses) {
    const ids = (b?.rerouteIds ?? []).filter(id => alive.has(id))
    if (ids.length >= 2) out.push({ id: b.id, rerouteIds: ids })
  }
  return out
}

// La barra se deriva de sus reroutes en cada frame: no hay posición guardada
// que se pueda desincronizar.
export function busRect(members) {
  const x = members.reduce((s, m) => s + m.x, 0) / members.length
  let minY = Infinity, maxY = -Infinity
  for (const m of members) { minY = Math.min(minY, m.y); maxY = Math.max(maxY, m.y) }
  return { x: x - BAR_W / 2, y: minY - BAR_PAD, w: BAR_W, h: maxY - minY + 2 * BAR_PAD }
}

// Si el corte a→b cruza la barra, el carril más cercano al cruce; si no, null.
// Uno por corte: es el gesto de "sacar ESTE cable del bus".
export function memberAtCut(rect, members, a, b) {
  if (a[0] === b[0]) return null
  const cx = rect.x + rect.w / 2
  const t = (cx - a[0]) / (b[0] - a[0])
  if (t < 0 || t > 1) return null
  const y = a[1] + (b[1] - a[1]) * t
  if (y < rect.y || y > rect.y + rect.h) return null
  let best = null, bestD = Infinity
  for (const m of members) {
    const d = Math.abs(m.y - y)
    if (d < bestD) { bestD = d; best = m.id }
  }
  return best
}

export function nextBusId(buses) {
  return buses.reduce((m, b) => Math.max(m, b.id ?? 0), 0) + 1
}
