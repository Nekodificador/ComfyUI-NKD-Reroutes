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
  dim: 0,                  // con «sólo la selección»: opacidad (%) del resto; 0 = no se ve
  brand: false,            // pie con logo y texto, en una franja aparte bajo la imagen
  brandText: "{title}",    // admite {title} y {date}
  brandLogo: "",           // data:image/… elegido por el usuario
})

const MAX_LOGO = 1_500_000   // ~1 MB de imagen: cabe en localStorage con holgura

/** Texto del pie con {title} y {date} sustituidos. */
export function footerText(template, { title = "", date = new Date() } = {}) {
  const d = date instanceof Date ? date : new Date(date)
  const iso = Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10)
  return String(template ?? "").replaceAll("{title}", title).replaceAll("{date}", iso).trim()
}

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
    dim: clampInt(o.dim, 0, 90, DEFAULTS.dim),
    brand: typeof o.brand === "boolean" ? o.brand : DEFAULTS.brand,
    brandText: typeof o.brandText === "string" ? o.brandText.slice(0, 200) : DEFAULTS.brandText,
    brandLogo: typeof o.brandLogo === "string" && /^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(o.brandLogo) &&
      o.brandLogo.length <= MAX_LOGO ? o.brandLogo : "",
  }
}

// Lado largo mínimo de la imagen. Discord pierde el workflow de las imágenes
// pequeñas (un subgraph suelto, ~270×200, lo perdía; la misma exportada a
// ~1070 px lo conservaba: probado). Discord no publica el límite: 1280 deja margen.
export const MIN_SIDE = 1280
// Y el lado corto: una de 1280×593 (un subgraph apaisado) también lo perdía,
// mientras 1280×958 y ~1070×1000 lo conservaban (probado). Con 1280 y 960 se
// cubre tanto un límite por lado corto como uno por píxeles totales (~1 MP).
// El lado corto no se alcanza escalando —una imagen apaisada se dispararía— sino
// con margen de fondo alrededor.
export const MIN_SHORT = 960

/** Lienzo final con el lado corto ≥ MIN_SHORT: [ancho, alto, dx, dy] para centrar la imagen. */
export function padToMinShort(w, h) {
  const W = w >= h ? w : Math.max(w, MIN_SHORT)
  const H = w >= h ? Math.max(h, MIN_SHORT) : h
  return [W, H, Math.round((W - w) / 2), Math.round((H - h) / 2)]
}

/**
 * Escala de captura: la del monitor; si la imagen saldría con el lado largo por
 * debajo de MIN_SIDE, la que lo alcanza (se redibuja más grande, así que sale
 * nítida); y nunca por encima de maxSide.
 */
export function scaleFor(w, h, dpr, maxSide) {
  const long = Math.max(w, h)
  const s = Math.max(dpr || 1, MIN_SIDE / long)
  return Math.min(s, maxSide / w, maxSide / h)
}
