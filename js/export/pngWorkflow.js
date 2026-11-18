// Mete el workflow en un PNG como lo deja el SaveImage nativo: un chunk tEXt
// con clave "workflow". El lector del frontend (getFromPngBuffer) decodifica el
// valor como UTF-8, así que títulos con tildes o CJK viajan bien aunque tEXt
// sea Latin-1 en la especificación.
//
// Puro (sin DOM ni app) para poder probarlo bajo node.

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function textChunk(key, value) {
  const body = new Uint8Array([...new TextEncoder().encode(key), 0, ...new TextEncoder().encode(value)])
  const out = new Uint8Array(12 + body.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, body.length)
  out.set([0x74, 0x45, 0x58, 0x74], 4) // "tEXt"
  out.set(body, 8)
  v.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)))
  return out
}

/** PNG con el chunk tEXt "workflow" justo después de IHDR. */
export function embedPngWorkflow(png, json) {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength)
  if (v.getUint32(0) !== 0x89504e47) throw new Error("Not a PNG")
  const afterIhdr = 8 + 12 + v.getUint32(8)   // firma + (len, tipo, datos, crc) de IHDR
  const chunk = textChunk("workflow", json)
  const out = new Uint8Array(png.length + chunk.length)
  out.set(png.subarray(0, afterIhdr))
  out.set(chunk, afterIhdr)
  out.set(png.subarray(afterIhdr), afterIhdr + chunk.length)
  return out
}
