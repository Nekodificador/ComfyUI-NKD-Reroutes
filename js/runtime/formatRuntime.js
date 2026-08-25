// PURE (sin app/DOM, testeable bajo node): formatea una duración en ms a texto
// corto para el badge del nodo. Devuelve "" para valores inválidos (así el badge
// no muestra basura si aún no hay medida).
export function formatRuntime(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return ""
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 10000) return `${(ms / 1000).toFixed(2)}s`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60000)
  const s = Math.round((ms % 60000) / 1000)
  return `${m}m ${s}s`
}
