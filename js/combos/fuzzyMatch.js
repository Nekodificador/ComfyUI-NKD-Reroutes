// PURE (sin DOM, testeable bajo node): filtro MULTI-PALABRA. La consulta se parte
// en palabras por espacios y CADA palabra debe aparecer (como substring) en el
// objetivo, en cualquier orden — "foto real" exige "foto" Y "real".
//
// Por qué no subsecuencia pura: sobre rutas largas ("estilo/realista/foto_v1…")
// una subsecuencia corta casa con caracteres sueltos y filtra casi nada. El AND
// de substrings por palabra es lo intuitivo de una caja de búsqueda y lo que el
// substring ÚNICO del core no hace (buscaría la cadena literal "dos palabras" con
// el espacio, que nunca está en un nombre de fichero).
//
// Consulta vacía → todo casa.
export function fuzzyMatch(query, target) {
  target = String(target).toLowerCase()
  const tokens = String(query).toLowerCase().split(/\s+/).filter(Boolean)
  return tokens.every((t) => target.includes(t))
}
