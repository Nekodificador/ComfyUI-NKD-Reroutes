// Motor de "conectar desde lejos" — función pura.
// Sin DOM, sin canvas, sin LiteGraph: se ejecuta bajo node para los tests.
//
// El adaptador resuelve, a partir del grafo, la lista de sockets candidatos
// (posición, tipo, lado, ocupado) y este motor decide CUÁLES son válidos y en
// qué orden sugerirlos. Toda la geometría de canvas y el connect() real viven en
// el adaptador; aquí sólo hay reglas de compatibilidad y orden.

// Compatibilidad de tipos, calcada de LiteGraph.isValidConnection: comodín
// (falsy / "*" / ""), igualdad, y listas separadas por comas (un socket que
// acepta "IMAGE,LATENT" casa con cualquiera de los dos). Case-insensitive.
//
// El motor trae su propia regla —en vez de exigir que el adaptador pase
// LiteGraph.isValidConnection— para poder probarse solo bajo node; el adaptador
// puede seguir delegando en LiteGraph cuando exista, pero el default es fiel.
export function isTypeCompatible(a, b) {
  if (a === "" || a === "*") a = 0
  if (b === "" || b === "*") b = 0
  if (!a || !b || a === b) return true
  a = String(a).toLowerCase()
  b = String(b).toLowerCase()
  if (a.indexOf(",") === -1 && b.indexOf(",") === -1) return a === b
  const as = a.split(","), bs = b.split(",")
  for (const x of as) for (const y of bs) if (x === y) return true
  return false
}

/**
 * Candidatos compatibles del lado buscado, ordenados: los sockets LIBRES antes
 * que los OCUPADOS (`c.occupied` — una entrada con cable puesto); dentro de cada
 * grupo por cercanía del NODO al socket de origen (distancia al rectángulo
 * `c.nodeRect`, 0 si el origen cae dentro; sin rect, la del propio socket); y
 * dentro del mismo nodo, por orden de aparición del socket (`slot`). Así el nodo
 * más cercano ofrece primero su primer input compatible, aunque otro input suyo
 * quede físicamente más cerca del cable.
 *
 * @param {{type:string, side:"input"|"output", pos?:[number,number]}} origin  socket del que se arrastra
 * @param {Array<{nodeId:*, slot:number, side:"input"|"output", type:string,
 *                pos:[number,number], nodeRect?:[number,number,number,number],
 *                occupied?:boolean}>} candidates
 * @param {{max?:number, match?:(from:string,to:string)=>boolean}} [opts]
 * @returns {Array<candidate>}  hasta `max`
 */
export function computeQuickConnect(origin, candidates, opts = {}) {
  const max = opts.max ?? 15
  const match = opts.match ?? isTypeCompatible
  const [ox, oy] = origin.pos ?? [0, 0]

  // Arrastrando desde una salida buscamos ENTRADAS, y al revés. El sentido del
  // enlace importa para la compatibilidad: siempre de salida hacia entrada.
  const want = origin.side === "output" ? "input" : "output"
  const out = candidates.filter((c) => {
    if (c.side !== want) return false
    const from = origin.side === "output" ? origin.type : c.type
    const to   = origin.side === "output" ? c.type : origin.type
    return match(from, to)
  })

  // Distancia² del origen al nodo del candidato: al rectángulo si lo hay, si no
  // al socket. Dentro del rectángulo es 0.
  const dist2 = (c) => {
    const r = c.nodeRect
    if (!r) return (c.pos[0] - ox) ** 2 + (c.pos[1] - oy) ** 2
    const dx = Math.max(r[0] - ox, 0, ox - (r[0] + r[2]))
    const dy = Math.max(r[1] - oy, 0, oy - (r[1] + r[3]))
    return dx * dx + dy * dy
  }

  // Libres antes que ocupados; luego por cercanía del nodo; dentro del nodo por
  // orden de aparición; empate estable por id.
  out.sort((p, q) =>
    (p.occupied ? 1 : 0) - (q.occupied ? 1 : 0)
    || dist2(p) - dist2(q)
    || (p.nodeId === q.nodeId ? p.slot - q.slot : String(p.nodeId).localeCompare(String(q.nodeId))))
  return out.slice(0, max)
}
