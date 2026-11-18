// Opciones de la imagen del workflow — puro (sin DOM ni app).
//
// El diálogo arranca de DEFAULTS con lo último usado encima (idea de
// nomadoor/ComfyUI-Workflow-Image-Export, sin su código). Lo guardado viene del
// navegador y puede ser viejo o estar roto: se sanea campo a campo y lo que no
// vale vuelve a su valor por defecto.

export const MAX_SIDE = 16383   // tope de WebP; también un tamaño de canvas seguro

export const DEFAULTS = Object.freeze({
  format: "webp",          // "webp" | "png"
  embed: true,             // workflow dentro del fichero
  background: "ui",        // "ui" (el del tema, con rejilla) | "transparent" | "solid"
  color: "#202020",        // para "solid"
  padding: 50,
  maxSide: MAX_SIDE,       // lado largo máximo; si se pasa, se reduce
})

const clampInt = (v, lo, hi, d) => Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : d

export function sanitize(raw) {
  const o = raw && typeof raw === "object" ? raw : {}
  return {
    format: o.format === "png" ? "png" : "webp",
    embed: typeof o.embed === "boolean" ? o.embed : DEFAULTS.embed,
    background: ["ui", "transparent", "solid"].includes(o.background) ? o.background : DEFAULTS.background,
    color: /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : DEFAULTS.color,
    padding: clampInt(o.padding, 0, 500, DEFAULTS.padding),
    maxSide: clampInt(o.maxSide, 256, MAX_SIDE, DEFAULTS.maxSide),
  }
}

/** Escala de captura: la del monitor, salvo que el lado largo pase de maxSide. */
export const scaleFor = (w, h, dpr, maxSide) => Math.min(dpr || 1, maxSide / w, maxSide / h)
