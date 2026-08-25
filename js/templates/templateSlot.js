// PURE (sin app/DOM, testeable bajo node): la plantilla del slot N (1-based) a
// partir del texto crudo de Comfy.NodeTemplates. Parseo defensivo —el localStorage
// lo puede tocar cualquiera y un JSON roto no debe tirar el atajo—; devuelve null
// si no hay plantilla válida en ese slot.
export function templateForSlot(rawJson, slot) {
  if (!rawJson || slot < 1) return null
  let list
  try { list = JSON.parse(rawJson) } catch { return null }
  if (!Array.isArray(list)) return null
  const tpl = list[slot - 1]
  return tpl && typeof tpl.data === "string" ? tpl : null
}
