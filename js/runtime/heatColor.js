// PURE (sin app/DOM, testeable bajo node): color de heatmap para una duración,
// relativo al máximo de la tanda. Devuelve null cuando no hay medida o escala
// válida, para que quien pinte use su color normal.
//
// Rampa APTA PARA DALTONISMO: azul oscuro (rápido) → naranja intenso (lento). Se
// interpola en RGB, NO en tono, a propósito: un barrido de tono azul→naranja
// pasaría por el verde/rojo, que es justo la confusión que hay que evitar. El
// azul↔naranja es la pareja segura para las deficiencias de visión del color.
//
// Se normaliza por el MÁXIMO de la ejecución (no por umbrales absolutos): así el
// nodo más lento siempre sale naranja y el más rápido azul, compare lo que
// compare el workflow.
// Azul MEDIO (no oscuro) a propósito: el badge lleva texto oscuro (#111) y sobre
// un azul muy oscuro no se leía. Este tiene luminosidad suficiente para el texto.
const LO = [90, 143, 208]    // azul medio   #5a8fd0 (rápido)
const HI = [255, 120, 20]    // naranja      #ff7814 (lento)

export function heatColor(ms, maxMs) {
  if (ms == null || !isFinite(ms) || !(maxMs > 0)) return null
  const t = ms <= 0 ? 0 : Math.min(1, ms / maxMs)
  const r = Math.round(LO[0] + (HI[0] - LO[0]) * t)
  const g = Math.round(LO[1] + (HI[1] - LO[1]) * t)
  const b = Math.round(LO[2] + (HI[2] - LO[2]) * t)
  return `rgb(${r}, ${g}, ${b})`
}
