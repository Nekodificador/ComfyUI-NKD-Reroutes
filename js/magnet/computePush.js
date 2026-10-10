// Empuje: lo que arrastras aparta a los vecinos que pisa, y éstos a los suyos.
//
// Sin estado: se calcula SIEMPRE desde los rectángulos del inicio del arrastre.
// Por eso es elástico — si retrocedes, lo empujado vuelve a su sitio — y no
// puede acumular deriva por mucho que se repita.
//
// El empuje va por un solo eje, el del recorrido dominante, y sólo hacia
// delante. Quién está "delante" se decide con las posiciones ORIGINALES: si se
// mirara la actual, al pasar de largo sobre un vecino éste cambiaría de lado y
// saltaría hacia atrás.

/**
 * @param {{x,y,w,h}} from  rectángulo arrastrado al empezar
 * @param {{x,y,w,h}} to    rectángulo arrastrado ahora (donde caerá)
 * @param {Array<{x,y,w,h}>} rects  vecinos empujables, posición original
 * @param {{gapX:number, gapY:number}} opts  hueco que se deja al empujar
 * @returns {Array<{dx:number, dy:number}>} desplazamiento de cada vecino, mismo orden
 */
export function computePush(from, to, rects, { gapX, gapY }) {
  const out = rects.map(() => ({ dx: 0, dy: 0 }))
  const tx = to.x - from.x
  const ty = to.y - from.y
  if (!tx && !ty) return out

  const horizontal = Math.abs(tx) >= Math.abs(ty)
  const dir = Math.sign(horizontal ? tx : ty)
  const gap = horizontal ? gapX : gapY

  // Se proyecta todo a "eje de empuje hacia +": lo/hi a lo largo, a/b de través.
  // Empujar a la izquierda es empujar a la derecha en el espejo.
  const proj = (r) => {
    const lo = horizontal ? r.x : r.y
    const hi = lo + (horizontal ? r.w : r.h)
    const a  = horizontal ? r.y : r.x
    const b  = a + (horizontal ? r.h : r.w)
    return dir > 0 ? { lo, hi, a, b } : { lo: -hi, hi: -lo, a, b }
  }

  const origin = proj(from)
  const mid = (p) => (p.lo + p.hi) / 2
  // Cada empujador lleva su rectángulo original (p0) y el actual (p).
  const movers = [{ p0: origin, p: proj(to) }]

  const ahead = rects
    .map((r, i) => ({ i, p0: proj(r) }))
    .filter(o => mid(o.p0) > mid(origin))
    .sort((u, v) => u.p0.lo - v.p0.lo)   // el más cercano primero: así basta una pasada

  for (const o of ahead) {
    let shift = 0
    for (const m of movers) {
      if (o.p0.b <= m.p.a || o.p0.a >= m.p.b) continue   // no se cruzan de través
      // El hueco nunca es mayor que el que ya había: si no, un vecino pegado
      // daría un salto nada más empezar a arrastrar.
      const g = Math.min(gap, o.p0.lo - m.p0.hi)
      shift = Math.max(shift, m.p.hi + g - o.p0.lo)
    }
    if (shift <= 0) continue
    movers.push({ p0: o.p0, p: { ...o.p0, lo: o.p0.lo + shift, hi: o.p0.hi + shift } })
    out[o.i] = horizontal ? { dx: shift * dir, dy: 0 } : { dx: 0, dy: shift * dir }
  }
  return out
}
