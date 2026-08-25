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
 * que los OCUPADos (`c.occupied` — una entrada con cable puesto), y dentro de
 * cada grupo por posición vertical del nodo (paridad con quick-connections).
 *
 * @param {{type:string, side:"input"|"output"}} origin  socket del que se arrastra
 * @param {Array<{nodeId:*, slot:number, side:"input"|"output", type:string,
 *                pos:[number,number], occupied?:boolean}>} candidates
 * @param {{max?:number, match?:(from:string,to:string)=>boolean}} [opts]
 * @returns {Array<candidate>}  hasta `max`
 */
export function computeQuickConnect(origin, candidates, opts = {}) {
  const max = opts.max ?? 15
  const match = opts.match ?? isTypeCompatible

  // Arrastrando desde una salida buscamos ENTRADAS, y al revés. El sentido del
  // enlace importa para la compatibilidad: siempre de salida hacia entrada.
  const want = origin.side === "output" ? "input" : "output"
  const out = candidates.filter((c) => {
    if (c.side !== want) return false
    const from = origin.side === "output" ? origin.type : c.type
    const to   = origin.side === "output" ? c.type : origin.type
    return match(from, to)
  })

  // Libres antes que ocupados; luego por vertical; empate estable por nodo+slot.
  out.sort((p, q) =>
    (p.occupied ? 1 : 0) - (q.occupied ? 1 : 0)
    || p.pos[1] - q.pos[1] || p.pos[0] - q.pos[0]
    || String(p.nodeId).localeCompare(String(q.nodeId)) || p.slot - q.slot)
  return out.slice(0, max)
}
