import assert from "node:assert/strict"
import { test } from "node:test"
import { computeArrange } from "./arrange.js"

const OPTS = { gapX: 36, gapY: 12 }

// Fábrica: nodo con inputs por nombre. pos por defecto en el origen para que el
// resultado dependa del layout, no de la posición previa.
let _id = 0
const node = (over = {}) => ({
  id: over.id ?? ++_id,
  type: over.type ?? "Node",
  inputs: over.inputs ?? [],
  pos: over.pos ?? [0, 0],
  w: over.w ?? 200,
  h: over.h ?? 80,
  pinned: over.pinned ?? false,
})
const inp = (...names) => names.map(n => ({ name: n, type: "" }))
const SAMPLER_INPUTS = inp("model", "positive", "negative", "latent_image")

const xOf = (m, id) => m.get(id)[0]
const yOf = (m, id) => m.get(id)[1]

test("KSampler: bandas model/cond/latent y rank creciente a la derecha", () => {
  const ckpt = node({ id: 1, pos: [0, 0] })
  const lora = node({ id: 2, inputs: inp("model") })
  const clip1 = node({ id: 3, inputs: inp("clip") })
  const clip2 = node({ id: 4, inputs: inp("clip") })
  const latent = node({ id: 5 })
  const sampler = node({ id: 6, type: "KSampler", inputs: SAMPLER_INPUTS })
  const edges = [
    { from: 1, to: 2, toSlot: 0 },   // ckpt -> lora.model
    { from: 2, to: 6, toSlot: 0 },   // lora -> sampler.model
    { from: 1, to: 3, toSlot: 0 },   // ckpt -> clip1.clip
    { from: 1, to: 4, toSlot: 0 },   // ckpt -> clip2.clip
    { from: 3, to: 6, toSlot: 1 },   // clip1 -> sampler.positive
    { from: 4, to: 6, toSlot: 2 },   // clip2 -> sampler.negative
    { from: 5, to: 6, toSlot: 3 },   // latent -> sampler.latent_image
  ]
  const { nodeMoves } = computeArrange({ nodes: [ckpt, lora, clip1, clip2, latent, sampler], edges }, OPTS)

  // Feeders en orden de socket: model arriba, cond en medio, latent abajo.
  assert.ok(yOf(nodeMoves, 2) < yOf(nodeMoves, 3), "lora (model) por encima de clip (cond)")
  assert.ok(yOf(nodeMoves, 3) < yOf(nodeMoves, 5), "clip (cond) por encima de latent")
  // Nodo compartido (checkpoint → model Y clip): gana la banda model (mínimo) → arriba,
  // por encima del conditioning.
  assert.ok(yOf(nodeMoves, 1) < yOf(nodeMoves, 3), "checkpoint compartido en la banda model (arriba)")
  // Rank: fuentes a la izquierda, sampler a la derecha.
  assert.ok(xOf(nodeMoves, 6) > xOf(nodeMoves, 2), "sampler a la derecha de lora")
  assert.ok(xOf(nodeMoves, 2) > xOf(nodeMoves, 1), "lora a la derecha del checkpoint")
})

test("Dos samplers encadenados: el base queda a la izquierda del refiner", () => {
  const a = node({ id: 1, type: "KSampler", inputs: SAMPLER_INPUTS })
  const b = node({ id: 2, type: "KSampler", inputs: SAMPLER_INPUTS })
  const edges = [{ from: 1, to: 2, toSlot: 3 }]   // base.latent -> refiner.latent_image
  const { nodeMoves } = computeArrange({ nodes: [a, b], edges }, OPTS)
  assert.ok(xOf(nodeMoves, 2) > xOf(nodeMoves, 1), "refiner a la derecha del base")
  // Alineados salvo el desfase de sockets (la salida del base entra al latent del refiner).
  assert.ok(Math.abs(yOf(nodeMoves, 1) - yOf(nodeMoves, 2)) < 200, "samplers en la misma franja")
})

test("Sin sampler: no lanza y ordena por flujo (output a la derecha)", () => {
  const a = node({ id: 1 })
  const b = node({ id: 2, inputs: inp("in") })
  const c = node({ id: 3, type: "SaveImage", inputs: inp("images") })
  const edges = [{ from: 1, to: 2, toSlot: 0 }, { from: 2, to: 3, toSlot: 0 }]
  const { nodeMoves } = computeArrange({ nodes: [a, b, c], edges }, OPTS)
  assert.equal(nodeMoves.size, 3)
  assert.ok(xOf(nodeMoves, 3) > xOf(nodeMoves, 2), "output a la derecha")
  assert.ok(xOf(nodeMoves, 2) > xOf(nodeMoves, 1), "productor a la izquierda")
})

test("Set/Get: el Get visible entra en banda, el Set (unido por nombre) no se arrastra", () => {
  const producer = node({ id: 1 })
  const setNode = node({ id: 2, type: "SetNode", inputs: inp("*") })
  const getNode = node({ id: 3, type: "GetNode", inputs: [] })   // Get no tiene input real
  const latent = node({ id: 5 })
  const sampler = node({ id: 4, type: "KSampler", inputs: SAMPLER_INPUTS })
  const edges = [
    { from: 1, to: 2, toSlot: 0 },   // producer -> Set (cable visible)
    { from: 3, to: 4, toSlot: 0 },   // Get -> sampler.model (cable visible, banda top)
    { from: 5, to: 4, toSlot: 3 },   // latent -> sampler.latent_image (banda bottom)
    // NO hay edge Set->Get: es por nombre, invisible.
  ]
  const { nodeMoves } = computeArrange({ nodes: [producer, setNode, getNode, latent, sampler], edges }, OPTS)
  // El Get (cable visible) se ancla pegado a la izquierda del sampler.
  assert.ok(xOf(nodeMoves, 3) < xOf(nodeMoves, 4), "Get a la izquierda de su consumidor (sampler)")
  // El productor del Set NO tiene camino visible al sampler (puente por nombre) →
  // no se coloca pegado al sampler como el Get.
  assert.ok(xOf(nodeMoves, 1) < xOf(nodeMoves, 3), "productor del Set no arrastrado junto al sampler")
})

test("Link no-resoluble (extremo inexistente) se ignora sin lanzar", () => {
  const a = node({ id: 1 })
  const b = node({ id: 2, inputs: inp("in") })
  const edges = [
    { from: 1, to: 2, toSlot: 0 },
    { from: 999, to: 2, toSlot: 0 },   // 999 no existe
  ]
  assert.doesNotThrow(() => computeArrange({ nodes: [a, b], edges }, OPTS))
})

test("Loaders inline: un loader que alimenta al sampler queda a su izquierda", () => {
  const unet = node({ id: 1, type: "UNETLoader" })
  const clip = node({ id: 2, type: "CLIPLoader" })
  const sampler = node({ id: 5, type: "KSampler", inputs: SAMPLER_INPUTS })
  const edges = [
    { from: 1, to: 5, toSlot: 0 },   // UNET -> sampler.model
    { from: 2, to: 5, toSlot: 1 },   // CLIP -> sampler.positive
  ]
  const { nodeMoves } = computeArrange({ nodes: [unet, clip, sampler], edges }, OPTS)
  // Sin agrupar: los loaders son feeders normales, a la izquierda del sampler.
  assert.ok(xOf(nodeMoves, 1) < xOf(nodeMoves, 5), "UNETLoader a la izquierda del sampler")
  assert.ok(xOf(nodeMoves, 2) < xOf(nodeMoves, 5), "CLIPLoader a la izquierda del sampler")
})

test("Orden de inputs manda: feeders de un nodo multi-input van en orden de slot", () => {
  // Region Prompter: tile_data(0), mask_0(1), mask_1(2). El tile_data (slot 0) arriba.
  const tileSrc = node({ id: 1 })
  const maskA = node({ id: 2 })
  const maskB = node({ id: 3 })
  const region = node({ id: 4, inputs: inp("tile_data", "mask_0", "mask_1") })
  const save = node({ id: 5, type: "SaveImage", inputs: inp("images") })
  const edges = [
    { from: 1, to: 4, toSlot: 0 }, { from: 2, to: 4, toSlot: 1 }, { from: 3, to: 4, toSlot: 2 },
    { from: 4, to: 5, toSlot: 0 },
  ]
  const { nodeMoves } = computeArrange({ nodes: [tileSrc, maskA, maskB, region, save], edges }, OPTS)
  assert.ok(yOf(nodeMoves, 1) < yOf(nodeMoves, 2), "tile_data (slot 0) por encima de mask_0")
  assert.ok(yOf(nodeMoves, 2) < yOf(nodeMoves, 3), "mask_0 (slot 1) por encima de mask_1")
})

test("Cadena de model plana: sin escalones al alinear por socket primario", () => {
  const ckpt = node({ id: 1 })
  const lora = node({ id: 2, inputs: inp("model") })
  const cfg = node({ id: 3, inputs: inp("model") })
  const sampler = node({ id: 4, type: "KSampler", inputs: SAMPLER_INPUTS })
  const latent = node({ id: 5 })
  const edges = [
    { from: 1, to: 2, toSlot: 0 }, { from: 2, to: 3, toSlot: 0 },
    { from: 3, to: 4, toSlot: 0 }, { from: 5, to: 4, toSlot: 3 },
  ]
  const { nodeMoves } = computeArrange({ nodes: [ckpt, lora, cfg, sampler, latent], edges }, OPTS)
  // ckpt → lora → cfg, todos por model slot0 → misma altura (cable recto, sin escalones).
  assert.ok(Math.abs(yOf(nodeMoves, 1) - yOf(nodeMoves, 2)) < 1, "ckpt y lora alineados")
  assert.ok(Math.abs(yOf(nodeMoves, 2) - yOf(nodeMoves, 3)) < 1, "lora y cfg alineados")
})

test("Guider (SamplerCustomAdvanced) se desenvuelve: model arriba, conditioning en medio", () => {
  const modelSrc = node({ id: 1, inputs: inp("model") })       // p.ej. ModelSamplingFlux
  const condSrc = node({ id: 2, inputs: inp("conditioning") }) // p.ej. TextEncode
  const guider = node({ id: 3, type: "CFGGuider", inputs: inp("model", "positive", "negative") })
  const sampler = node({ id: 4, type: "SamplerCustomAdvanced", inputs: inp("noise", "guider", "sampler", "sigmas", "latent_image") })
  const latent = node({ id: 5 })
  const edges = [
    { from: 1, to: 3, toSlot: 0 },   // modelSrc -> guider.model
    { from: 2, to: 3, toSlot: 1 },   // condSrc -> guider.positive
    { from: 3, to: 4, toSlot: 1 },   // guider -> sampler.guider
    { from: 5, to: 4, toSlot: 4 },   // latent -> sampler.latent_image
  ]
  const { nodeMoves } = computeArrange({ nodes: [modelSrc, condSrc, guider, sampler, latent], edges }, OPTS)
  // El model del guider se separa hacia ARRIBA (banda propia), por encima del
  // conditioning y del latente.
  assert.ok(yOf(nodeMoves, 1) < yOf(nodeMoves, 2), "model del guider por encima del conditioning")
  assert.ok(yOf(nodeMoves, 1) < yOf(nodeMoves, 5), "model del guider por encima del latente")
})

test("Loader → Set nodes: los Set van a la DERECHA del loader (no se voltea)", () => {
  const loader = node({ id: 1, type: "NKDFluxKleinLoader", pos: [0, 0] })
  const setM = node({ id: 2, type: "SetNode", inputs: inp("*"), pos: [300, 0] })
  const setC = node({ id: 3, type: "SetNode", inputs: inp("*"), pos: [300, 60] })
  const setV = node({ id: 4, type: "SetNode", inputs: inp("*"), pos: [300, 120] })
  const edges = [
    { from: 1, to: 2, toSlot: 0, fromSlot: 0 },
    { from: 1, to: 3, toSlot: 0, fromSlot: 1 },
    { from: 1, to: 4, toSlot: 0, fromSlot: 2 },
  ]
  const { nodeMoves } = computeArrange({ nodes: [loader, setM, setC, setV], edges }, OPTS)
  assert.ok(xOf(nodeMoves, 2) > xOf(nodeMoves, 1), "Set(model) a la derecha del loader")
  assert.ok(xOf(nodeMoves, 3) > xOf(nodeMoves, 1), "Set(clip) a la derecha del loader")
  assert.ok(xOf(nodeMoves, 4) > xOf(nodeMoves, 1), "Set(vae) a la derecha del loader")
})

test("Idempotente: re-ejecutar sobre el resultado no mueve nada", () => {
  const mk = () => {
    const ckpt = node({ id: 1, pos: [0, 0] })
    const lora = node({ id: 2, inputs: inp("model"), pos: [0, 40] })
    const clip = node({ id: 3, inputs: inp("clip"), pos: [0, 80] })
    const latent = node({ id: 5, pos: [0, 160] })
    const sampler = node({ id: 6, type: "KSampler", inputs: SAMPLER_INPUTS, pos: [0, 200] })
    const save = node({ id: 7, type: "SaveImage", inputs: inp("images"), pos: [0, 260] })
    return [ckpt, lora, clip, latent, sampler, save]
  }
  const edges = [
    { from: 1, to: 2, toSlot: 0 }, { from: 2, to: 6, toSlot: 0 },
    { from: 1, to: 3, toSlot: 0 }, { from: 3, to: 6, toSlot: 1 },
    { from: 5, to: 6, toSlot: 3 }, { from: 6, to: 7, toSlot: 0 },
  ]
  const nodes = mk()
  const run1 = computeArrange({ nodes, edges }, OPTS).nodeMoves
  // aplicar posiciones y re-ejecutar
  for (const n of nodes) { const p = run1.get(n.id); if (p) n.pos = [p[0], p[1]] }
  const run2 = computeArrange({ nodes, edges }, OPTS).nodeMoves
  for (const n of nodes) {
    const a = run1.get(n.id), b = run2.get(n.id)
    if (!a || !b) continue
    assert.ok(Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5, `nodo ${n.id} no debe moverse al re-ejecutar (${a} vs ${b})`)
  }
})

test("Dos clusters desconectados se ordenan por separado, sin pisarse", () => {
  // Cluster A cerca de x=0, cluster B cerca de x=2000 — dos workflows independientes.
  const a1 = node({ id: 1, pos: [0, 0] })
  const a2 = node({ id: 2, pos: [0, 120], inputs: inp("in") })
  const b1 = node({ id: 3, pos: [2000, 0] })
  const b2 = node({ id: 4, pos: [2000, 120], inputs: inp("in") })
  const edges = [{ from: 1, to: 2, toSlot: 0 }, { from: 3, to: 4, toSlot: 0 }]
  const { nodeMoves } = computeArrange({ nodes: [a1, a2, b1, b2], edges }, OPTS)
  // Cada cluster se queda en su zona: B a la derecha de A, sin solaparse.
  const maxA = Math.max(xOf(nodeMoves, 1), xOf(nodeMoves, 2))
  const minB = Math.min(xOf(nodeMoves, 3), xOf(nodeMoves, 4))
  assert.ok(minB > maxA + 500, "el cluster B queda lejos, a la derecha del cluster A")
})

test("Nodos pinned y aislados se dejan en su sitio", () => {
  const a = node({ id: 1, pinned: true })
  const b = node({ id: 2, inputs: inp("in") })
  const island = node({ id: 3 })   // sin cables
  const edges = [{ from: 1, to: 2, toSlot: 0 }]
  const { nodeMoves } = computeArrange({ nodes: [a, b, island], edges }, OPTS)
  assert.ok(!nodeMoves.has(1), "pinned no se mueve")
  assert.ok(!nodeMoves.has(3), "aislado no se mueve")
  assert.ok(nodeMoves.has(2), "el conectado sí se coloca")
})
