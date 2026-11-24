// Conector de pila — función pura (sin DOM, sin LiteGraph).
//
// Dos nodos uno encima del otro y casi pegados (una columna de LoRAs) no se
// unen con un cable que sale por un lado y entra por el otro dando la vuelta:
// se marca el borde de abajo del de arriba y el de arriba del de abajo, y un
// trazo corto los une por el hueco. Lee como "estos dos van en cadena".
// Es sólo dibujo: el workflow no cambia, y sin la
// extensión se ven los cables de siempre.

/**
 * ¿Forman pila estos dos rectángulos [x, y, w, h]? Se solapan en horizontal y
 * el hueco vertical entre ellos va de 0 a `maxGap`. Da igual cuál esté arriba.
 * @returns {{upper:number[], lower:number[], gap:number}|null}
 */
export function stackPair(ra, rb, maxGap) {
  if (!ra || !rb) return null
  const overlapX = Math.min(ra[0] + ra[2], rb[0] + rb[2]) - Math.max(ra[0], rb[0])
  if (overlapX <= 0) return null
  const [upper, lower] = ra[1] <= rb[1] ? [ra, rb] : [rb, ra]
  const gap = lower[1] - (upper[1] + upper[3])
  if (gap < 0 || gap > maxGap) return null
  return { upper, lower, gap }
}

/**
 * Forma exacta de la soldadura: el hueco entre los dos nodos más las muescas
 * que dejan sus esquinas redondeadas, recortadas por el arco de cada esquina.
 * No se mete NADA bajo los nodos: con un rectángulo que entraba un radio bajo cada uno, lo que caía
 * debajo se transparentaba en los nodos translúcidos (Bypassed), y la
 * soldadura se veía por encima.
 *
 * Una esquina sólo se recorta si ese borde del nodo coincide con el del tramo
 * común; si el nodo es más ancho, su borde sigue recto por ahí y no hay muesca.
 * @returns {Array} órdenes de trazo: ["M", x, y] | ["L", x, y] | ["A", cx, cy, r, a0, a1]
 *   (los arcos van en sentido antihorario de canvas: anticlockwise = true)
 */
export function weldPath(pair, radius = 8) {
  const { upper, lower } = pair
  const x0 = Math.max(upper[0], lower[0])
  const x1 = Math.min(upper[0] + upper[2], lower[0] + lower[2])
  const yb = upper[1] + upper[3]   // borde de abajo del de arriba
  const yt = lower[1]              // borde de arriba del de abajo
  const r = Math.max(0, Math.min(radius, (x1 - x0) / 2))
  const near = (a, b) => Math.abs(a - b) < 1
  const uL = near(upper[0], x0), uR = near(upper[0] + upper[2], x1)
  const lL = near(lower[0], x0), lR = near(lower[0] + lower[2], x1)
  const P = Math.PI
  const ops = []
  // Borde de abajo del nodo de arriba, de izquierda a derecha.
  if (uL && r) { ops.push(["M", x0, yb - r], ["A", x0 + r, yb - r, r, P, P / 2]) } else ops.push(["M", x0, yb])
  if (uR && r) { ops.push(["L", x1 - r, yb], ["A", x1 - r, yb - r, r, P / 2, 0]) } else ops.push(["L", x1, yb])
  // Borde de arriba del nodo de abajo, de derecha a izquierda.
  if (lR && r) { ops.push(["L", x1, yt + r], ["A", x1 - r, yt + r, r, 0, -P / 2]) } else ops.push(["L", x1, yt])
  if (lL && r) { ops.push(["L", x0 + r, yt], ["A", x0 + r, yt + r, r, -P / 2, -P]) } else ops.push(["L", x0, yt])
  return ops
}

const SEP = 2   // separación entre los tramos de dos cables del mismo par

/**
 * Geometría del conector número `index` de `count` entre el mismo par.
 *
 * Cada marca es una lente apoyada PLANA en el borde del nodo y abombada hacia
 * el hueco: gruesa en el centro y a cero en las puntas. Llega hasta donde
 * empieza la curva de la esquina (`radius`), así que el borde entero se lee
 * marcado y la marca muere justo donde el nodo se redondea.
 *
 * Con varios cables entre el mismo par (model y clip) el ancho común se parte
 * en tramos iguales, uno por cable en orden de socket, cada uno con su lente y
 * su trazo por el centro.
 * @returns {{top:{x0,x1,y,dir}, bottom:{x0,x1,y,dir}, line:number[]}}
 *   `dir` = hacia dónde abomba la lente (+1 abajo, -1 arriba); line = [x0, y0, x1, y1]
 */
export function connectorGeometry(pair, index = 0, count = 1, radius = 8) {
  const { upper, lower } = pair
  const x0 = Math.max(upper[0], lower[0]) + radius
  const x1 = Math.min(upper[0] + upper[2], lower[0] + lower[2]) - radius
  const n = Math.max(1, count)
  const span = Math.max(0, x1 - x0) / n
  const a = x0 + span * index + (index > 0 ? SEP / 2 : 0)
  const b = x0 + span * (index + 1) - (index < n - 1 ? SEP / 2 : 0)
  const yTop = upper[1] + upper[3]
  const yBot = lower[1]
  const x = (a + b) / 2
  return {
    top:    { x0: a, x1: b, y: yTop, dir: 1 },
    bottom: { x0: a, x1: b, y: yBot, dir: -1 },
    line:   [x, yTop, x, yBot],
  }
}

/**
 * Agrupa los pares soldados en bloques: dos pares que comparten un nodo son el
 * mismo bloque (una columna de tres nodos = un bloque, no dos).
 * @param {Array<{a:any, b:any}>} pairs  a/b = id de cada nodo del par
 * @returns {Array<{ids:Set, pairs:Array}>}
 */
export function stackGroups(pairs) {
  const parent = new Map()
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x)
    while (parent.get(x) !== x) x = parent.get(x)
    return x
  }
  for (const p of pairs) parent.set(find(p.a), find(p.b))
  const groups = new Map()
  for (const p of pairs) {
    const root = find(p.a)
    if (!groups.has(root)) groups.set(root, { ids: new Set(), pairs: [] })
    const g = groups.get(root)
    g.ids.add(p.a); g.ids.add(p.b); g.pairs.push(p)
  }
  return [...groups.values()]
}

/**
 * Bloque pegado al cambiar de tamaño. Cada nodo se clasifica por qué borde se
 * ha movido desde el frame anterior:
 *  · sólo el de abajo → estirado/encogido por abajo: lo soldado DEBAJO le sigue.
 *  · sólo el de arriba → estirado/encogido por arriba: lo soldado ENCIMA le sigue.
 *  · los dos → arrastre: ni empuja ni se le mueve, y corta la cadena.
 * Se compara con el frame anterior porque al crecer el hueco se vuelve
 * negativo (y al encoger puede pasarse del máximo): en este frame ya no hay par.
 * Se conserva el HUECO de cada par, no se suman incrementos: si un frame se
 * queda atrás, el siguiente lo recoloca entero en vez de arrastrar el desfase.
 * @param {Map<any, number[]>} prevRects  id → [x,y,w,h] del frame anterior
 * @param {Array<{up:any, low:any}>} prevPairs  pares soldados del frame anterior
 * @param {Map<any, number[]>} rects  id → [x,y,w,h] ahora
 * @returns {Map<any, number>} id → cuánto moverlo en vertical (+ abajo)
 */
export function growPushes(prevRects, prevPairs, rects) {
  const edge = (id) => {
    const a = prevRects.get(id), b = rects.get(id)
    if (!a || !b) return "drag"
    const top = Math.abs(b[1] - a[1]) > 0.5
    const bottom = Math.abs((b[1] + b[3]) - (a[1] + a[3])) > 0.5
    return top && bottom ? "drag" : top ? "top" : bottom ? "bottom" : "still"
  }
  const gapOf = (up, low) => prevRects.get(low)[1] - (prevRects.get(up)[1] + prevRects.get(up)[3])
  const moves = new Map()
  // Hacia abajo, de arriba abajo: cada par ve ya movido a su nodo de arriba.
  for (const { up, low } of [...prevPairs].sort((p, q) => prevRects.get(p.up)?.[1] - prevRects.get(q.up)?.[1])) {
    const eu = edge(up), el = edge(low)
    if (!(eu === "bottom" || moves.has(up)) || !(el === "still" || el === "bottom")) continue
    const u = rects.get(up)
    const dy = (u[1] + (moves.get(up) ?? 0) + u[3] + gapOf(up, low)) - rects.get(low)[1]
    if (Math.abs(dy) > 0.5) moves.set(low, dy)
  }
  // Hacia arriba, de abajo arriba: el espejo.
  const up_ = new Map()
  for (const { up, low } of [...prevPairs].sort((p, q) => prevRects.get(q.low)?.[1] - prevRects.get(p.low)?.[1])) {
    const eu = edge(up), el = edge(low)
    if (!(el === "top" || up_.has(low)) || !(eu === "still" || eu === "top") || moves.has(up)) continue
    const l = rects.get(low), u = rects.get(up)
    const dy = (l[1] + (up_.get(low) ?? 0) - gapOf(up, low) - u[3]) - u[1]
    if (Math.abs(dy) > 0.5) up_.set(up, dy)
  }
  for (const [id, dy] of up_) moves.set(id, dy)
  return moves
}
