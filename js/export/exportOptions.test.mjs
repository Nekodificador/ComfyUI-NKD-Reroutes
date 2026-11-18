import assert from "node:assert/strict"
import { deflateSync } from "node:zlib"
import { DEFAULTS, sanitize, scaleFor, footerText, padToMinShort } from "./exportOptions.js"

// lado corto mínimo, con margen centrado
assert.deepEqual(padToMinShort(1280, 593), [1280, 960, 0, 184])   // el subgraph apaisado que Discord perdía
assert.deepEqual(padToMinShort(1280, 958), [1280, 960, 0, 1])
assert.deepEqual(padToMinShort(600, 1280), [960, 1280, 180, 0])   // vertical: margen a los lados
assert.deepEqual(padToMinShort(3000, 2000), [3000, 2000, 0, 0])   // ya grande: nada
import { embedPngWorkflow } from "./pngWorkflow.js"

// ── opciones ──
assert.deepEqual(sanitize(null), { ...DEFAULTS })
assert.deepEqual(sanitize({ format: "gif", embed: "yes", background: "x", color: "red", padding: -9, maxSide: 99999 }),
  { ...DEFAULTS, padding: 0 })
assert.deepEqual(sanitize({ format: "png", embed: false, background: "solid", color: "#AbCdEf", padding: "120", maxSide: 4000, dim: 35 }),
  { ...DEFAULTS, format: "png", embed: false, background: "solid", color: "#AbCdEf", padding: 120, maxSide: 4000, dim: 35 })
// branding
assert.equal(footerText("{title} · nkd.dev · {date}", { title: "Klein", date: new Date("2026-11-18T10:00:00Z") }), "Klein · nkd.dev · 2026-11-18")
assert.equal(footerText("", { title: "x" }), "")
assert.equal(sanitize({ brandLogo: "javascript:alert(1)" }).brandLogo, "")               // sólo data:image/…
assert.equal(sanitize({ brandLogo: "data:image/png;base64,AAAA" }).brandLogo, "data:image/png;base64,AAAA")
assert.equal(sanitize({ brandLogo: "data:image/png;base64," + "A".repeat(2_000_000) }).brandLogo, "")  // demasiado grande
assert.equal(sanitize({ brandText: "x".repeat(500) }).brandText.length, 200)
assert.equal(sanitize({ dim: 150 }).dim, 90)   // el resto nunca tapa a la selección
assert.equal(sanitize({ dim: -5 }).dim, 0)
assert.equal(scaleFor(1000, 500, 2, 16383), 2)
assert.equal(scaleFor(8000, 500, 2, 4000), 0.5)   // el lado largo manda
// imagen pequeña (un subgraph suelto): se redibuja hasta 1280 de lado largo
assert.equal(scaleFor(320, 256, 1, 16383), 4)
assert.equal(scaleFor(2000, 1000, 1, 16383), 1)    // ya es grande: se queda
assert.equal(scaleFor(320, 256, 1, 640), 2)        // el tope del usuario manda sobre el mínimo

// ── PNG ── un PNG mínimo de 1×1 real, y el lector nativo copiado (frontend 1.59, getFromPngBuffer)
function crc(b) { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1 } return ~c >>> 0 }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0); out.write(type, 4, "latin1"); data.copy(out, 8)
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}
const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from([0, 1, 2, 3, 4]))), chunk("IEND", Buffer.alloc(0))])

function nativeRead(t) {
  const n = new DataView(t.buffer, t.byteOffset, t.byteLength); let r = 8; const i = {}
  for (; r < t.length;) {
    const e = n.getUint32(r), a = String.fromCharCode(...t.slice(r + 4, r + 8))
    if (a === "tEXt") {
      let p = r + 8; for (; t[p] !== 0;) p++
      i[String.fromCharCode(...t.slice(r + 8, p))] = new TextDecoder().decode(t.slice(p + 1, r + 8 + e))
    }
    r += 12 + e
  }
  return i
}

const json = JSON.stringify({ nodes: [{ title: "Carga de imágenes 画像" }] })
const out = embedPngWorkflow(new Uint8Array(png), json)
assert.equal(nativeRead(out).workflow, json)
// CRC de cada chunk correcto (un PNG con CRC malo no lo abre el navegador)
const v = new DataView(out.buffer)
for (let r = 8; r < out.length;) {
  const len = v.getUint32(r)
  assert.equal(v.getUint32(r + 8 + len), crc(out.subarray(r + 4, r + 8 + len)))
  r += 12 + len
}
// el orden de chunks es válido: tEXt entre IHDR e IDAT, nada más cambia
const types = []
for (let r = 8; r < out.length;) { const len = v.getUint32(r); types.push(String.fromCharCode(...out.slice(r + 4, r + 8))); r += 12 + len }
assert.deepEqual(types, ["IHDR", "tEXt", "IDAT", "IEND"])
console.log("exportOptions + pngWorkflow ok")
