import assert from "node:assert/strict"
import { test } from "node:test"
import { embedWorkflow } from "./webpWorkflow.js"

// Copia del lector nativo (frontend 1.59, getFromWebpFile + parseExifData):
// si esto lo lee, arrastrar el fichero a ComfyUI lo carga.
function nativeRead(t) {
  const n = new DataView(t.buffer, t.byteOffset)
  if (n.getUint32(0) !== 1380533830 || n.getUint32(8) !== 1464156752) return {}
  let r = 12; const out = {}
  for (; r < t.length;) {
    const e = n.getUint32(r + 4, true)
    if (String.fromCharCode(...t.slice(r, r + 4)) === "EXIF") {
      let s = r + 8, a = e
      if (String.fromCharCode(...t.slice(s, s + 6)) == "Exif\0\0") { s += 6; a -= 6 }
      const o = parseExif(t.slice(s, s + a))
      for (const k in o) {
        const v = o[k]
        if (typeof v == "string") { const i = v.indexOf(":"); out[v.slice(0, i)] = v.slice(i + 1) }
      }
      break
    }
    r += 8 + e + e % 2
  }
  return out
}
function parseExif(e) {
  const le = String.fromCharCode(...e.slice(0, 2)) === "II"
  const rd = (o, n) => { const d = new DataView(e.buffer, e.byteOffset + o, n); return n === 2 ? d.getUint16(0, le) : d.getUint32(0, le) }
  const ifd = rd(4, 4), cnt = rd(ifd, 2), res = {}
  for (let a = 0; a < cnt; a++) {
    const p = ifd + 2 + a * 12, tag = rd(p, 2), type = rd(p + 2, 2), c = rd(p + 4, 4), off = rd(p + 8, 4)
    res[tag] = type === 2 ? new TextDecoder().decode(e.subarray(off, off + c - 1)) : undefined
  }
  return res
}

const chunk = (id, len) => {
  const pad = len & 1, c = new Uint8Array(8 + len + pad)
  for (let i = 0; i < 4; i++) c[i] = id.charCodeAt(i)
  new DataView(c.buffer).setUint32(4, len, true)
  c.fill(0xab, 8, 8 + len)
  return c
}
const riff = (...chunks) => {
  const body = chunks.reduce((s, c) => s + c.length, 0), out = new Uint8Array(12 + body)
  out.set([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])
  new DataView(out.buffer).setUint32(4, 4 + body, true)
  let o = 12; for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}
const fourccs = (b) => {
  const ids = []
  for (let o = 12; o < b.length;) {
    const s = new DataView(b.buffer).getUint32(o + 4, true)
    ids.push(String.fromCharCode(...b.slice(o, o + 4))); o += 8 + s + (s & 1)
  }
  return ids
}

const WF = JSON.stringify({ nodes: [{ title: "Señal 😺 ñandú" }], links: [] })

test("WebP simple (VP8 de longitud impar): el lector nativo recupera el workflow", () => {
  const out = embedWorkflow(riff(chunk("VP8 ", 37)), WF, 1920, 900)
  assert.equal(nativeRead(out).workflow, WF)
  assert.deepEqual(fourccs(out), ["VP8X", "VP8 ", "EXIF"])
  const v = new DataView(out.buffer)
  assert.equal(v.getUint32(4, true), out.length - 8, "tamaño RIFF")
  assert.equal(out[20], 0x08, "flag EXIF")
  assert.equal(out[24] | out[25] << 8 | out[26] << 16, 1919, "ancho-1")
  assert.equal(out[27] | out[28] << 8 | out[29] << 16, 899, "alto-1")
  assert.equal(out.length % 2, 0)
})

test("WebP que ya trae VP8X y un EXIF viejo: se reutiliza la cabecera y se sustituye el EXIF", () => {
  const vp8x = chunk("VP8X", 10); vp8x.fill(0, 8); vp8x[8] = 0x10
  const out = embedWorkflow(riff(vp8x, chunk("ALPH", 5), chunk("VP8 ", 20), chunk("EXIF", 9)), WF, 10, 10)
  assert.deepEqual(fourccs(out), ["VP8X", "ALPH", "VP8 ", "EXIF"])
  assert.equal(out[20], 0x18, "conserva alpha y añade EXIF")
  assert.equal(nativeRead(out).workflow, WF)
})

test("no es WebP → error (toBlob puede caer a PNG)", () => {
  assert.throws(() => embedWorkflow(new Uint8Array([137, 80, 78, 71, 0, 0, 0, 0, 0, 0, 0, 0]), WF, 1, 1))
})
