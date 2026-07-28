// Motor de magnetismo — función pura.
// Sin DOM, sin canvas, sin LiteGraph: se ejecuta bajo node para los tests.

// Escalón de prioridad entre reglas que compiten en el mismo eje.
// Un cable recto manda sobre meterse en un hueco, y ambos sobre alinear un borde.
const TIER = { socket: 3, gap: 2, edge: 1 }

// Valor actual de la referencia contra la que se mide un candidato.
function currentRef(rect, axis, t) {
  if (t.ref === "socket") return rect.y + t.offset
  if (axis === "x") return t.ref === "max" ? rect.x + rect.w : rect.x
  return t.ref === "max" ? rect.y + rect.h : rect.y
}

function bestOnAxis(rect, list, radius, axis) {
  let best = null
  for (const t of list) {
    const delta = t.value - currentRef(rect, axis, t)
    if (Math.abs(delta) > radius) continue
    const tier = TIER[t.kind] ?? 0
    const better = !best
      || tier > best.tier
      || (tier === best.tier && Math.abs(delta) < Math.abs(best.delta))
    if (better) best = { t, delta, tier }
  }
  return best
}

/**
 * @param {{x,y,w,h}} rect      envolvente de la selección arrastrada
 * @param {{x:Array,y:Array}} targets
 * @param {{radius:number, matchWidth:boolean, minWidth:number}} opts
 * @returns {{dx:number, dy:number, width:number|null, guides:Array}}
 */
export function computeSnap(rect, targets, opts) {
  const bx = bestOnAxis(rect, targets.x || [], opts.radius, "x")
  const by = bestOnAxis(rect, targets.y || [], opts.radius, "y")

  const guides = []
  if (bx?.t.guide) guides.push(bx.t.guide)
  if (by?.t.guide) guides.push(by.t.guide)

  return {
    dx: bx ? bx.delta : 0,
    dy: by ? by.delta : 0,
    width: null,
    guides,
  }
}
