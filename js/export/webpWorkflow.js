// Mete el workflow dentro de un WebP, en el mismo sitio donde lo deja el
// SaveAnimatedWEBP nativo: un chunk EXIF con un TIFF cuya etiqueta 0x010F
// (Make) es la cadena "workflow:<json>". Así el fichero se carga arrastrándolo
// a cualquier ComfyUI, sin esta extensión.
//
// Puro (sin DOM ni app) para poder probarlo bajo node.

const TAG_WORKFLOW = 0x010f
const FLAG_EXIF = 0x08

const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])

function chunk(id, payload) {
  const pad = payload.length & 1
  const out = new Uint8Array(8 + payload.length + pad)
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i)
  new DataView(out.buffer).setUint32(4, payload.length, true)
  out.set(payload, 8)
  return out
}

// TIFF little-endian con un único IFD de una sola entrada ASCII.
function tiffWithString(tag, text) {
  const str = new TextEncoder().encode(text)
  const dataAt = 8 + 2 + 12 + 4
  const out = new Uint8Array(dataAt + str.length + 1) // +1 = NUL final
  const v = new DataView(out.buffer)
  out.set([0x49, 0x49, 0x2a, 0x00]) // "II*\0"
  v.setUint32(4, 8, true)            // IFD0 en el byte 8
  v.setUint16(8, 1, true)            // una entrada
  v.setUint16(10, tag, true)
  v.setUint16(12, 2, true)           // tipo ASCII
  v.setUint32(14, str.length + 1, true)
  v.setUint32(18, dataAt, true)
  v.setUint32(22, 0, true)           // no hay IFD siguiente
  out.set(str, dataAt)
  return out
}

/**
 * Devuelve un WebP nuevo con el workflow embebido.
 * @param {Uint8Array} webp  salida de canvas.toBlob("image/webp")
 * @param {string} json      workflow serializado
 * @param {number} width     tamaño del lienzo en px (el de la imagen)
 * @param {number} height
 */
export function embedWorkflow(webp, json, width, height) {
  if (fourcc(webp, 0) !== "RIFF" || fourcc(webp, 8) !== "WEBP") throw new Error("Not a WebP file")

  // Recorre los chunks, tirando cualquier EXIF previo.
  const chunks = []
  for (let o = 12; o + 8 <= webp.length;) {
    const size = new DataView(webp.buffer, webp.byteOffset + o + 4, 4).getUint32(0, true)
    const end = o + 8 + size + (size & 1)
    const id = fourcc(webp, o)
    if (id !== "EXIF") chunks.push(webp.slice(o, end))
    o = end
  }

  // El EXIF exige la cabecera extendida VP8X; el WebP simple (VP8/VP8L) no la trae.
  if (fourcc(chunks[0], 0) === "VP8X") {
    chunks[0][8] |= FLAG_EXIF
  } else {
    const x = new Uint8Array(10)
    x[0] = FLAG_EXIF
    const w = width - 1, h = height - 1
    x[4] = w & 0xff; x[5] = (w >> 8) & 0xff; x[6] = (w >> 16) & 0xff
    x[7] = h & 0xff; x[8] = (h >> 8) & 0xff; x[9] = (h >> 16) & 0xff
    chunks.unshift(chunk("VP8X", x))
  }
  chunks.push(chunk("EXIF", tiffWithString(TAG_WORKFLOW, "workflow:" + json)))

  const total = 12 + chunks.reduce((s, c) => s + c.length, 0)
  const out = new Uint8Array(total)
  out.set(webp.subarray(0, 12))
  new DataView(out.buffer).setUint32(4, total - 8, true)
  let o = 12
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}
