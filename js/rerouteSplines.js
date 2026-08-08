import { app } from "../../scripts/app.js"
import { installMagnet } from "./magnet/dragAdapter.js"
import { installShrinkOnLegacy } from "./shrinkOnLegacy.js"
import { computeTension } from "./spline/tension.js"
import { beginFrame, emitRoute, routeFor } from "./route/pcb.js"
import { DEFAULTS, PRESETS, PRESET_KEYS, SETTING_ID_MAP } from "./spline/config.js"

// ─── NKD Reroutes — Rewritten v2.0 ──────────────────────────────────────────
//
// Changes from v1:
//   • Config separated into DEFAULTS / live state / presets
//   • Settings registered declaratively via helpers (100+ lines → ~40)
//   • Tension math extracted into pure functions
//   • Reroute detection consolidated into a single function
//   • Reroute patching uses a WeakSet (survives canvas recreation)
//   • User-facing labels rewritten for clarity + real tooltips
//   • Preset system ("Clean & Tight", "Flowy & Organic", "Straight Business")
//   • Minimum dot radius enforced at 3 to stay clickable
// ─────────────────────────────────────────────────────────────────────────────

// ─── Defaults & State ────────────────────────────────────────────────────────
// DEFAULTS, PRESETS y SETTING_ID_MAP viven en ./spline/config.js: el
// laboratorio (js/lab.html) importa exactamente lo mismo, así que no hay dos
// copias que se separen.

// Live mutable state — always reflects current user config
const state = { ...DEFAULTS }

// ─── Entry Point ─────────────────────────────────────────────────────────────

app.registerExtension({
  name: "NKD Reroutes",
  setup() {
    registerSettings()
    patchLiteGraph()
    registerSidebarPanel()
    installMagnet(state)
    installShrinkOnLegacy()
    installLabBridge()
  },
})

// ─── Declarative Settings Descriptors ───────────────────────────────────────
// Defined at module scope so buildPanel can reuse tips as sidebar tooltips.

const SLIDER_DEFS = [
  { id: "WireCurvature",            key: "handleFactor",         label: "Wire Curvature",          tip: "Overall roundness of every wire. Low = almost straight lines, high = wide sweeping curves.", min: 0.1, max: 2.0,  step: 0.1  },
  { id: "NodePull",                 key: "nodeFactor",           label: "Node Pull",                tip: "Extra roundness at the wire ends that touch a node socket.",                                 min: 0.1, max: 2.0,  step: 0.1  },
  { id: "ReroutePull",              key: "rerouteFactor",        label: "Reroute Pull",             tip: "Same, for the ends that touch a reroute dot. Below Node Pull keeps chains of reroutes tight.", min: 0.1, max: 2.0, step: 0.1 },
  { id: "RerouteDotSize",           key: "rerouteRadius",        label: "Reroute Dot Size",         tip: "How big the reroute dot looks on screen. It never goes below 3 so it stays easy to click.", min: 3,   max: 15,   step: 1    },
  { id: "NonLinear",                key: "nonLinear",            label: "Elasticity",               tip: "Makes short and long wires look more different from each other. Above 1.0 = long wires open up while short ones stay tight; below 1.0 = every wire curves about the same. The turning point is Socket Offset Max.", min: 0.1, max: 2.0,  step: 0.1  },
  { id: "DistFactor",               key: "distFactor",           label: "Distance Stretch",         tip: "Grows every handle in direct proportion to how far apart the nodes are — this is what makes long wires look stretched instead of flat. 0 = off, 1 = close to ComfyUI's classic look.",                     min: 0,   max: 2.0,  step: 0.05 },
  { id: "CrossingMargin",           key: "crossingMargin",       label: "Crossing Width",           tip: "How much horizontal travel the forward-to-backward transition is spread over. The wire starts growing its loop this many pixels BEFORE the target crosses the source, and finishes this many pixels after. Small values make the loop pop in abruptly.",                                          min: 0,   max: 300,  step: 10   },
  { id: "MaxHandleRatio",           key: "maxHandleRatio",       label: "Handle Ceiling",           tip: "Caps each handle to this fraction of the horizontal gap between the two sockets. At 0.5 the two handles together never exceed the gap, which is exactly the point where the curve stops doubling back on itself — that S-shape short, steep wires get. 0 = no ceiling.",                                     min: 0,   max: 1.5,  step: 0.05 },
  { id: "BackwardStretch",          key: "backwardStretch",      label: "Backward Stretch",         tip: "How much the backward loop grows with distance. A neighbour further to the left and further down gets more curve, at the same rate whatever the angle — so the wire clears the socket instead of hugging the node.",                                                                                       min: 0,   max: 1.0,  step: 0.05 },
  { id: "MinHandle",                key: "minSplineOffset",      label: "Minimum Handle",           tip: "Hard floor for every handle. Too high and it swallows the curve: every wire ends up the same shape whatever its length.",                                                                                   min: 0,   max: 60,   step: 1    },
  { id: "CornerRadius",             key: "cornerRadius",         label: "PCB Corner Radius",        tip: "How rounded the right-angle corners are when PCB routing is on. 0 = sharp corners. Each corner is limited to half of its shortest side, so tight zig-zags stay clean instead of collapsing.", min: 0, max: 30, step: 1 },
  { id: "NodeAvoidance",            key: "nodeAvoidance",        label: "PCB Node Avoidance",       tip: "How hard a wire tries to go around a node instead of passing under it, when PCB routing is on. Each detour costs corners, so this is really a trade: at 1 the wire ignores nodes and runs straight through, high values make it wrap around whatever is in the way.", min: 1, max: 20, step: 1 },
  { id: "IgnoreShorterThan",        key: "ignoreShorterThan",    label: "PCB Ignore Short Nodes",   tip: "Nodes shorter than this stop pushing wires around, so Set/Get pills, collapsed nodes and other small helpers can sit anywhere without sending every wire on a detour. 0 = every node counts.", min: 0, max: 100, step: 5 },
  { id: "StubLength",               key: "stubLength",           label: "Socket Stub",              tip: "Length of the straight tail every wire leaves the socket with before the curve starts. 0 = none, straight from the dot. On short wires it shrinks with the wire so the curve between the two tails never folds over itself.", min: 0, max: 60, step: 1 },
  { id: "InversionPull",            key: "inversionPull",        label: "Inversion Pull",           tip: "How wide the 'C' loop is when a wire has to travel backwards (target node to the LEFT of the source). Stays the same no matter how far apart the nodes are.",                                 min: 10,  max: 150,  step: 5    },
  { id: "NodeBodyClearance",        key: "nodeBodyClearance",    label: "Node Body Clearance",      tip: "Keeps a minimum amount of curve when two nodes sit almost on top of each other, so the wire doesn't vanish into the node's edge.",                                                           min: 0,   max: 80,   step: 2    },
  { id: "MagnetRadius", key: "magnetRadius", label: "Magnet Radius",         tip: "How close you have to drag a node before it snaps onto a neighbour.",              min: 5, max: 60,  step: 1 },
  { id: "MagnetGapY",   key: "magnetGapY",   label: "Magnet Vertical Gap",   tip: "Space left between nodes when one snaps below another in the same column.",        min: 0, max: 60,  step: 2 },
  { id: "MagnetGapX",   key: "magnetGapX",   label: "Magnet Horizontal Gap", tip: "Space left between nodes when one snaps beside another in the same row.",          min: 0, max: 120, step: 2 },
]

// Quick lookup: stateKey → tip (for sidebar tooltips)
const TIPS = Object.fromEntries(SLIDER_DEFS.map(d => [d.key, d.tip]))

// ─── Declarative Settings ────────────────────────────────────────────────────

function registerSettings() {
  const add = app.ui?.settings?.addSetting?.bind(app.ui.settings)
  if (!add) return

  // --- Hidden: override native spline offset so tension is fully managed here ---
  add({
    id:           "LiteGraph.Reroute.SplineOffset",
    name:         "Reroute spline offset (hidden, managed by NKD Reroutes)",
    type:         "hidden",
    defaultValue: 250,
  })

  // --- Hidden: invertBackward persisted via sidebar toggle ---
  add({
    id:           "NKD Reroutes.InvertBackward",
    name:         "Invert sign on backward wires (managed by sidebar)",
    type:         "hidden",
    defaultValue: true,
    onChange(v) { state.invertBackward = Boolean(v) },
  })

  // --- Hidden: mode (Simple|Advanced), persisted via sidebar toggle ---
  add({
    id:           "NKD Reroutes.Mode",
    name:         "Mode (managed by sidebar)",
    type:         "hidden",
    defaultValue: "Simple",
    onChange(v)  { state.mode = v === "Advanced" ? "Advanced" : "Simple"; redraw() },
  })

  // --- Hidden: simple-mode reroute handle offset ---
  add({
    id:           "NKD Reroutes.SimpleRerouteOffset",
    name:         "Simple-mode reroute handle offset (managed by sidebar)",
    type:         "hidden",
    defaultValue: 40,
    onChange(v)  { state.simpleRerouteOffset = Number(v); redraw() },
  })

  // --- Hidden: ruteo PCB, persistido desde el panel ---
  add({
    id:           "NKD Reroutes.PcbEnabled",
    name:         "PCB routing (managed by sidebar)",
    type:         "hidden",
    defaultValue: false,
    onChange(v)  { state.pcbEnabled = Boolean(v); redraw() },
  })

  // --- Hidden: reparto de pasillos, persistido desde el panel ---
  add({
    id:           "NKD Reroutes.SpreadCorridors",
    name:         "Spread shared corridors (managed by sidebar)",
    type:         "hidden",
    defaultValue: true,
    onChange(v)  { state.spreadCorridors = Boolean(v); redraw() },
  })

  // --- Magnetismo: los tres interruptores van ocultos, se manejan desde el panel ---
  for (const [id, key] of [
    ["MagnetEnabled",    "magnetEnabled"],
    ["MagnetGuides",     "magnetGuides"],
    ["MagnetMatchWidth", "magnetMatchWidth"],
  ]) {
    add({
      id:           `NKD Reroutes.${id}`,
      name:         `${id} (managed by sidebar)`,
      type:         "hidden",
      defaultValue: DEFAULTS[key],
      onChange(v) { state[key] = Boolean(v); redraw() },
    })
  }

  // --- Presets del usuario (los gestiona el panel) ---
  add({
    id:           USER_PRESETS_ID,
    name:         "Saved wire presets (managed by sidebar)",
    type:         "hidden",
    defaultValue: "{}",
  })

  // --- Preset selector ---
  add({
    id:           "NKD Reroutes.Preset",
    name:         "Wire Style Preset",
    tooltip:      "Sets every wire setting at once. Pick one as a starting point, then fine-tune with the sliders below.",
    type:         "combo",
    // Incluye los guardados por el usuario. Los que se creen después salen al
    // recargar; el sitio vivo para gestionarlos es el panel.
    options:      ["Custom", ...Object.keys(allPresets())],
    defaultValue: "Custom",
    onChange(v) { applyPreset(v) },
  })

  for (const s of SLIDER_DEFS) {
    add({
      id:           `NKD Reroutes.${s.id}`,
      name:         s.label,
      tooltip:      s.tip,
      type:         "slider",
      attrs:        { min: s.min, max: s.max, step: s.step },
      defaultValue: DEFAULTS[s.key],
      onChange(v) { state[s.key] = Number(v); redraw() },
    })
  }

}

// ─── Presets ─────────────────────────────────────────────────────────────────
//
// "Classic Comfy" viene de fábrica como referencia; los demás los guarda el
// usuario. Van en un ajuste de ComfyUI y no en localStorage: así viajan con el
// perfil, sobreviven a un cambio de navegador y están en todas las pestañas.
// Se guardan como texto JSON para que ningún intermediario les cambie el tipo.

const USER_PRESETS_ID = "NKD Reroutes.UserPresets"

function userPresets() {
  try {
    const raw = app.ui?.settings?.getSettingValue?.(USER_PRESETS_ID)
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw
    return obj && typeof obj === "object" ? obj : {}
  } catch {
    return {}   // un JSON corrupto no puede tumbar el panel
  }
}

function allPresets() {
  return { ...PRESETS, ...userPresets() }
}

// Sólo geometría: guardar el tamaño del punto o los ajustes del imán aquí haría
// que recuperar un estilo de cable te cambiara cosas que no son del cable.
function saveUserPreset(name) {
  const preset = {}
  for (const key of PRESET_KEYS) preset[key] = state[key]
  const next = { ...userPresets(), [name]: preset }
  app.ui?.settings?.setSettingValue?.(USER_PRESETS_ID, JSON.stringify(next))
}

function deleteUserPreset(name) {
  const next = { ...userPresets() }
  delete next[name]
  app.ui?.settings?.setSettingValue?.(USER_PRESETS_ID, JSON.stringify(next))
}

function applyPreset(name) {
  const preset = allPresets()[name]
  if (!preset) return // "Custom" — do nothing, user tweaks manually
  applyConfig(preset)
}

// Aplica una config venga de donde venga: un preset o el laboratorio.
//
// Filtra la entrada porque esto acaba escribiendo en los ajustes del servidor:
// sólo pasan claves conocidas y del mismo tipo que su valor por defecto.
function applyConfig(obj, persist = true) {
  const clean = {}
  for (const [key, value] of Object.entries(obj || {})) {
    const def = DEFAULTS[key]
    if (def === undefined || typeof value !== typeof def) continue
    if (typeof def === "number" && !Number.isFinite(value)) continue
    clean[key] = value
  }
  if (!Object.keys(clean).length) return

  Object.assign(state, clean)

  // Sincroniza los ajustes de ComfyUI. Las claves sin id —las que aún no tienen
  // setting propio— se aplican en vivo pero no persisten: es lo que toca
  // mientras se afinan en el laboratorio.
  if (persist && app.ui?.settings?.setSettingValue) {
    for (const [settingId, stateKey] of Object.entries(SETTING_ID_MAP)) {
      if (stateKey in clean) app.ui.settings.setSettingValue(settingId, clean[stateKey])
    }
  }

  syncPanelFromState()
  redraw()
}

// Puente con el laboratorio (js/lab.html). Mismo origen ⇒ mismo localStorage, y
// el evento `storage` sólo llega a las OTRAS pestañas: mueves un slider allí y
// los cables de aquí cambian al momento.
//
// La persistencia va aparte, con retardo: arrastrar un slider dispara decenas de
// escrituras y cada `setSettingValue` es un viaje al servidor.
let _labTimer = null
function installLabBridge() {
  addEventListener("storage", (e) => {
    if (e.key !== "nkd.lab.config" || !e.newValue) return
    let obj
    try { obj = JSON.parse(e.newValue) } catch { return }
    applyConfig(obj, false)          // al vuelo, sin tocar el servidor
    clearTimeout(_labTimer)
    _labTimer = setTimeout(() => applyConfig(obj, true), 400)   // y al parar, se guarda
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function redraw() {
  // Los dos canvas, no sólo el de delante. Con `links_ontop` desactivado —que es
  // el defecto— los cables se dibujan en el canvas de FONDO, así que ensuciar
  // sólo el frente dejaba los cambios de curvatura sin repintar hasta que algo
  // más ensuciaba el fondo: pasar el ratón por encima del canvas, típicamente.
  // Desde el panel eso se notaba como que los sliders no hacían nada en vivo.
  app.graph?.setDirtyCanvas(true, true)
}

// ─── Reroute Detection ───────────────────────────────────────────────────────
// Consolidated into a single function instead of 3 scattered heuristics.

function isRerouteEndpoint(dir, extras, link, side) {
  // Heuristic 1: dir === 0 means "any direction" → reroute convention
  if (dir === 0) return true

  // Heuristic 2: extras carry a pre-computed control point (reroute adapter)
  const controlKey = side === "start" ? "startControl" : "endControl"
  if (extras && extras[controlKey] !== undefined) return true
  if (side === "end" && extras?.reroute) return true

  // Heuristic 3: actual node type check via graph lookup
  if (link && app.graph?.getNodeById) {
    const nodeId = side === "start" ? link.origin_id : link.target_id
    const node = app.graph.getNodeById(nodeId)
    if (node?.type?.includes("Reroute")) return true
  }

  return false
}

// ─── Tension Math ────────────────────────────────────────────────────────────
// La geometría vive en ./spline/tension.js, pura y testeada. Aquí queda sólo
// el adaptador: resolver si cada extremo es un reroute —eso necesita el grafo
// de ComfyUI— y pasarle el state vivo como configuración.

function computeSegmentTension(a, b, startDir, endDir, extras, link) {
  return computeTension(a, b, {
    startDir, endDir, extras,
    startIsReroute: isRerouteEndpoint(startDir, extras, link, "start"),
    endIsReroute:   isRerouteEndpoint(endDir,   extras, link, "end"),
  }, state)
}

// ─── LiteGraph Patches ──────────────────────────────────────────────────────

function patchLiteGraph() {
  patchDrawLink()
  patchRenderLink()
  patchPathRenderer()
  patchReroutes()          // directo, si el frontend expone la clase
  patchDrawConnections()   // plan B perezoso para los que no la expongan
}

// El tamaño del punto se aplicaba SÓLO cuando el dibujado de conexiones pasaba
// por nuestro envoltorio y además el grafo ya tenía algún reroute: dos
// condiciones que dependen del orden de arranque y de que nadie más haya
// envuelto drawConnections antes. Cuando alguna fallaba, los puntos se quedaban
// con el aspecto nativo y el slider no hacía nada — sin ningún aviso.
//
// El frontend actual expone la clase, así que se parchea de una y en el sitio,
// sin esperar a que se dibuje nada.
function patchReroutes() {
  const proto = globalThis.LiteGraph?.Reroute?.prototype
  if (!proto || _patchedReroutes.has(proto)) return
  applyReroutePatches(proto)
  _patchedReroutes.add(proto)
}

// --- 1. Legacy drawLink (used for basic canvas spline rendering) ---

function patchDrawLink() {
  const orig = LGraphCanvas.prototype.drawLink

  LGraphCanvas.prototype.drawLink = function (
    ctx, start, end, link_data, skip_border, is_selected, link_color, start_node, end_node
  ) {
    if (!start || !end) return orig.apply(this, arguments)

    // Simple mode: only take over rendering when a reroute is involved.
    // Pure node↔node wires fall through to LiteGraph's native renderer.
    // El ruteo PCB se salta esta puerta: es otro renderizador, no un afinado de
    // la curva, y aquí dejaba sin rutear justo los cables nodo↔nodo — que son
    // los que de verdad tienen nodos que esquivar.
    if (state.mode === "Simple" && !state.pcbEnabled) {
      const startIsReroute = start_node?.type?.includes("Reroute")
      const endIsReroute   = end_node?.type?.includes("Reroute")
      if (!startIsReroute && !endIsReroute) return orig.apply(this, arguments)
    }

    ctx.save()
    ctx.lineWidth   = is_selected ? 4 : 3
    ctx.strokeStyle = link_color || "#999"

    if (is_selected) {
      ctx.shadowColor = link_color || "#fff"
      ctx.shadowBlur  = 4
    }

    ctx.beginPath()

    const renderMode = app.canvas?.links_render_mode ?? 2

    const pcb = state.pcbEnabled && drawRoute(ctx, this, start, end, link_data, start_node, end_node)
    if (pcb) {
      ctx.stroke()
      ctx.restore()
      return
    }

    if (renderMode === 1) {
      // LINEAR
      ctx.moveTo(start[0], start[1])
      ctx.lineTo(start[0] + 15, start[1])
      ctx.lineTo(end[0] - 15, end[1])
      ctx.lineTo(end[0], end[1])
    } else if (renderMode === 0) {
      // STRAIGHT
      ctx.moveTo(start[0], start[1])
      ctx.lineTo(start[0] + 10, start[1])
      const midX = (start[0] + 10 + (end[0] - 10)) * 0.5
      ctx.lineTo(midX, start[1])
      ctx.lineTo(midX, end[1])
      ctx.lineTo(end[0] - 10, end[1])
      ctx.lineTo(end[0], end[1])
    } else {
      // SPLINE
      const startIsReroute = start_node?.type?.includes("Reroute")
      const endIsReroute   = end_node?.type?.includes("Reroute")
      // Puntas del rabito: por defecto los propios extremos, así que con el
      // rabito apagado el trazo es exactamente el de antes.
      let sCtl, eCtl, sP = start, eP = end
      if (state.mode === "Simple") {
        // We only get here if at least one endpoint is a reroute (gate above).
        // Fixed-direction handles (start → right, end → left) — same convention
        // as a real socket, so backward wires loop instead of inverting.
        const off = state.simpleRerouteOffset
        sCtl = [ off, 0]
        eCtl = [-off, 0]
      } else {
        const tension = computeSegmentTension(
          start, end,
          startIsReroute ? 0 : undefined,
          endIsReroute   ? 0 : undefined,
          {}, link_data
        )
        sCtl = tension.startControl
        eCtl = tension.endControl
        sP   = tension.startPoint
        eP   = tension.endPoint
      }
      // Un solo trazo: rabito, curva, rabito. Con stubLength = 0 las puntas
      // son los extremos y los dos lineTo no dibujan nada.
      ctx.moveTo(start[0], start[1])
      ctx.lineTo(sP[0], sP[1])
      ctx.bezierCurveTo(
        sP[0] + sCtl[0], sP[1] + sCtl[1],
        eP[0] + eCtl[0], eP[1] + eCtl[1],
        eP[0],           eP[1]
      )
      ctx.lineTo(end[0], end[1])
    }

    ctx.stroke()
    ctx.restore()
  }
}

// --- 2. Modern renderLink (new ComfyUI frontend path renderer) ---

function patchRenderLink() {
  const orig = LGraphCanvas.prototype.renderLink
  if (!orig) return

  LGraphCanvas.prototype.renderLink = function (
    ctx, a, b, link, skip_border, flow, color, start_dir, end_dir, extras
  ) {
    if (!extras) extras = {}

    // En PCB la geometría la pone el ruteo, en el patch del renderizador de
    // trazos. Aquí no hay tensión que calcular ni rabito que pintar.
    if (this.links_render_mode === 2 && !state.pcbEnabled) {
      if (state.mode === "Simple") {
        // Only override handles at reroute endpoints; let Vanilla handle node endpoints.
        const startIsReroute = isRerouteEndpoint(start_dir, extras, link, "start")
        const endIsReroute   = isRerouteEndpoint(end_dir,   extras, link, "end")
        if (startIsReroute || endIsReroute) {
          const off = state.simpleRerouteOffset
          // Reroute handles are fixed-direction (start → right, end → left), like
          // real sockets. Sign never depends on dx, so backward wires form a clean
          // C-loop instead of inverting at the dot.
          if (startIsReroute) extras.startControl = [ off, 0]
          if (endIsReroute)   extras.endControl   = [-off, 0]
        }
      } else {
        const tension = computeSegmentTension(a, b, start_dir, end_dir, extras, link)
        extras.startControl = tension.startControl
        extras.endControl   = tension.endControl
        // El renderer nativo dibuja la curva entre los dos puntos que le
        // pasemos: le damos las PUNTAS del rabito y los tramos rectos los
        // pintamos aquí. El color se resuelve una vez y se le pasa explícito
        // — con color nulo lo resuelve él por dentro y no lo publica, así que
        // era la única forma de garantizar que curva y rabito son del mismo.
        const stubColor = drawStubs(this, ctx, a, b, tension, link, color)
        if (stubColor) {
          a     = tension.startPoint
          b     = tension.endPoint
          color = stubColor
        }
      }
    }

    return orig.call(this, ctx, a, b, link, skip_border, flow, color, start_dir, end_dir, extras)
  }
}

// Los dos tramos rectos que salen de cada socket antes de que empiece la
// curva. Devuelve el color con el que los ha pintado —el que hay que pasarle
// también al renderer nativo— o null si no hay rabito que pintar.
function drawStubs(canvas, ctx, a, b, tension, link, color) {
  const { startPoint, endPoint } = tension
  if (startPoint[0] === a[0] && endPoint[0] === b[0]) return null

  // La misma cadena que usa el frontend para resolver el color de un cable.
  // Si no sale nada, mejor sin rabito que un rabito de otro color.
  const c = color || link?.color ||
            LGraphCanvas.link_type_colors?.[link?.type] || canvas.default_link_color
  if (!c) return null

  ctx.save()
  ctx.strokeStyle = c
  ctx.lineWidth   = canvas.connections_width ?? 3
  ctx.beginPath()
  // Sólo el lado que de verdad tiene rabito: en un tramo nodo→reroute el otro
  // mide cero, y un trazo de longitud cero pinta un punto si el lineCap que
  // haya quedado puesto es redondo.
  if (startPoint[0] !== a[0]) { ctx.moveTo(a[0], a[1]); ctx.lineTo(startPoint[0], startPoint[1]) }
  if (endPoint[0]   !== b[0]) { ctx.moveTo(b[0], b[1]); ctx.lineTo(endPoint[0],   endPoint[1]) }
  ctx.stroke()
  ctx.restore()
  return c
}

// --- 2b. Ruteo en el frontend moderno ---
//
// La Bézier del camino moderno se controla desde renderLink pasando handles,
// pero una polilínea no cabe en dos handles: hay que entrar más abajo, en el
// renderizador de trazos, que es quien construye el Path2D. Enganchar ahí es
// además lo que hace que el clic sobre el cable y el marcador central sigan la
// traza — todo eso se deriva del mismo trazo.
//
// Se instala en diferido: app.canvas no existe cuando corre setup().
function patchPathRenderer() {
  let tries = 0
  const timer = setInterval(() => {
    const pr = app.canvas?.linkRenderer?.pathRenderer
    if (pr) {
      clearInterval(timer)
      applyPathRendererPatches(Object.getPrototypeOf(pr))
      return
    }
    // Silencio absoluto es el modo de fallo peor: el modo PCB se quedaría sin
    // hacer nada en el canvas moderno y sin decir por qué.
    if (++tries === 50) {
      clearInterval(timer)
      console.warn("[NKD Reroutes] este frontend no expone el renderizador de trazos; " +
                   "el modo PCB sólo funcionará en el canvas clásico")
    }
  }, 200)
}

function applyPathRendererPatches(proto) {
  const origDraw = proto.drawLink
  proto.drawLink = function (ctx, linkData, context) {
    linkData.__nkdRoute = null
    // Los cables en vuelo (arrastrando desde un socket) se quedan como están:
    // sus extremos cambian cada frame y rutearlos es tirar el trabajo.
    if (state.pcbEnabled && linkData.id !== "temp" && linkData.id !== "dragging") {
      const s = linkData.startPoint, e = linkData.endPoint
      // Aquí sólo llega el id, y los carriles necesitan saber en qué socket de
      // qué nodo empieza el cable — eso vive en el grafo.
      const graph = app.canvas?.graph
      // 'none' es la marca de reroute: el frontend pone CENTER en los dos lados
      // de un tramo que toca un punto, y nada más recibe esa dirección.
      linkData.__nkdRoute = routeFor(linkData.id, [s.x, s.y], [e.x, e.y], {
        pointerDown:    Boolean(app.canvas?.pointer?.isDown),
        startIsReroute: linkData.startDirection === "none",
        endIsReroute:   linkData.endDirection   === "none",
        graph,
        link:           graph?._links?.get?.(Number(linkData.id)) ?? null,
      })
    }
    return origDraw.call(this, ctx, linkData, context)
  }

  const origPath = proto.drawLinkPath
  proto.drawLinkPath = function (ctx, path, link, context, lineWidth, color) {
    if (!link.__nkdRoute) return origPath.call(this, ctx, path, link, context, lineWidth, color)
    ctx.strokeStyle = color
    ctx.lineWidth   = lineWidth
    ctx.lineJoin    = "round"
    emitRoute(path, link.__nkdRoute, state.cornerRadius)
    ctx.stroke(path)
  }

  const origCentre = proto.calculateCenterPoint
  proto.calculateCenterPoint = function (link, context) {
    if (!link.__nkdRoute) return origCentre.call(this, link, context)
    // En el tramo recto MÁS LARGO, no a mitad de recorrido: el punto medio del
    // recorrido puede caer justo en una esquina, que es donde peor se lee.
    const pts = link.__nkdRoute
    let best = 1, bestLen = -1
    for (let k = 1; k < pts.length; k++) {
      const len = Math.abs(pts[k][0] - pts[k - 1][0]) + Math.abs(pts[k][1] - pts[k - 1][1])
      if (len > bestLen) { bestLen = len; best = k }
    }
    const a = pts[best - 1], b = pts[best]
    link.centerPos   = { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 }
    link.centerAngle = Math.atan2(b[1] - a[1], b[0] - a[0])
  }
}

// Pide la ruta de este cable y la vuelca en el trazo abierto. Devuelve false si
// no hay ruta —caso trivial, arrastre, o el motor se rindió— y entonces manda la
// Bézier de siempre.
function drawRoute(ctx, canvas, start, end, link, start_node, end_node) {
  const pts = routeFor(link?.id ?? "temp", start, end, {
    pointerDown:    Boolean(canvas.pointer?.isDown),
    startIsReroute: Boolean(start_node?.type?.includes("Reroute")),
    endIsReroute:   Boolean(end_node?.type?.includes("Reroute")),
    graph:          canvas.graph,
    link,
  })
  if (!pts) return false
  emitRoute(ctx, pts, state.cornerRadius)
  return true
}

// --- 3. Hook into drawConnections to patch reroute prototypes lazily ---

const _patchedReroutes = new WeakSet()

function patchDrawConnections() {
  const orig = LGraphCanvas.prototype.drawConnections

  LGraphCanvas.prototype.drawConnections = function (ctx) {
    // Snapshot de obstáculos: una vez por frame, antes de que se dibuje ningún
    // cable. Va aquí y no dentro del ruteo de cada cable porque leer todos los
    // rectángulos del grafo por cable sería cuadrático.
    if (state.pcbEnabled) {
      try {
        beginFrame(this.graph, {
          avoidance:         state.nodeAvoidance,
          spread:            state.spreadCorridors,
          ignoreShorterThan: state.ignoreShorterThan,
        })
      } catch (err) {
        console.warn("[NKD Reroutes] snapshot de obstáculos fallido", err)
      }
    }
    if (app.graph?.reroutes?.size > 0) {
      const firstReroute = app.graph.reroutes.values().next().value
      const proto = Object.getPrototypeOf(firstReroute)

      if (!_patchedReroutes.has(proto)) {
        applyReroutePatches(proto)
        _patchedReroutes.add(proto)
      }
    }
    return orig.apply(this, arguments)
  }
}

// ─── Reroute Visual Patches ─────────────────────────────────────────────────

function applyReroutePatches(proto) {

  // A. Draw as a dot with custom radius
  proto.draw = function (ctx, backgroundPattern) {
    const globalAlpha = ctx.globalAlpha
    const pos = this.pos
    const r   = state.rerouteRadius

    ctx.save()
    ctx.beginPath()
    ctx.arc(pos[0], pos[1], r, 0, Math.PI * 2)

    // Dimmed fill when the reroute has no connections
    if (this.linkIds && this.linkIds.size === 0) {
      ctx.fillStyle = backgroundPattern || "#797979"
      ctx.fill()
      ctx.globalAlpha = globalAlpha * 0.33
    }

    ctx.fillStyle = this.colour || "#999"
    ctx.fill()

    if (this.selected) {
      ctx.strokeStyle = "white"
      ctx.lineWidth   = 2
    } else {
      ctx.strokeStyle = "rgba(0,0,0,0.5)"
      ctx.lineWidth   = 1
    }
    ctx.stroke()

    // Ghost ring on hover for tiny dots — always visible regardless of radius
    // (uses a slightly larger transparent ring to help the eye locate the dot)
    if (r < 5) {
      ctx.beginPath()
      ctx.arc(pos[0], pos[1], r + 4, 0, Math.PI * 2)
      ctx.strokeStyle = "rgba(255,255,255,0.08)"
      ctx.lineWidth   = 1
      ctx.stroke()
    }

    ctx.restore()
  }

  // B. Collision area — generous hitbox for small dots
  Object.defineProperty(proto, "boundingRect", {
    get() {
      const hitRadius = Math.max(10, state.rerouteRadius * 1.5)
      const x = this.pos[0]
      const y = this.pos[1]
      return [x - hitRadius, y - hitRadius, 2 * hitRadius, 2 * hitRadius]
    },
    configurable: true,
  })
}

// ─── Sidebar Panel ────────────────────────────────────────────────────────────

// Reverse lookup: stateKey → settingId (derived once from SETTING_ID_MAP)
const _stateKeyToSettingId = Object.fromEntries(
  Object.entries(SETTING_ID_MAP).map(([id, key]) => [key, id])
)

// DOM refs for bidirectional sync; cleared and repopulated on each buildPanel call.
const _panelRefs = new Map()  // stateKey → { el, valEl?, type }
const _syncHooks = []         // post-sync callbacks (e.g. update disabled states)
let   _settingsListenerAC = null  // AbortController for the settings change listener

function registerSidebarPanel() {
  app.extensionManager?.registerSidebarTab?.({
    id:      "nkd-reroutes",
    icon:    "pi pi-sliders-h",
    title:   "NKD Wires",
    tooltip: "NKD Reroutes — wire controls",
    type:    "custom",
    render(el) { buildPanel(el) },
  })
}

// Format a numeric state value for display next to a slider
function _fmtVal(v, dec = 1) {
  if (typeof v !== "number" || Number.isNaN(v)) return String(v)
  const s = v.toFixed(dec)
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s
}

// Largest "round" value (1/2/5 × 10^k) that doesn't exceed x.
function niceBelow(x) {
  const mag = Math.pow(10, Math.floor(Math.log10(x)))
  return [5, 2, 1].map(m => m * mag).find(s => s <= x) ?? mag
}

// Free drag granularity: the declared `step` is what the value *means* (0.1 for a
// factor, 50px for a distance), but in a ~110px sidebar that's only ~20 stops and
// the thumb visibly jumps. Aim for ~100 stops. Integer sliders stay integer.
function fineStep(min, max, step) {
  if (Number.isInteger(step)) return 1
  return Math.min(niceBelow((max - min) / 100), step)
}

// Shift drag: snap to numbers a human would actually pick, scaled to the slider's
// own units — ~10 stops across the range. A 0.1–2.0 factor lands on 0.1 / 0.2,
// a 10–200 px distance on 10 / 20, a 50–1000 px one on 50 / 100.
function coarseStep(min, max) {
  return niceBelow((max - min) / 10)
}

function decimalsOf(step) {
  return (String(step).split(".")[1] || "").length
}

function buildPanel(el) {
  el.innerHTML = ""
  _panelRefs.clear()
  _syncHooks.length = 0

  // Which mode this DOM reflects — the external-sync listener compares against
  // this, not state.mode, to decide whether a rebuild is needed.
  const builtMode = state.mode

  // Cancel the previous settings-change listener so we never accumulate duplicates
  _settingsListenerAC?.abort()
  _settingsListenerAC = new AbortController()

  // ── Inject styles (once per page load) ──────────────────────────────────────
  if (!document.getElementById("nkd-panel-styles")) {
    const s = document.createElement("style")
    s.id = "nkd-panel-styles"
    s.textContent = `
.nkd-panel {
  --nkd-accent: #7db98a;
  padding: 10px 8px 16px;
  overflow-y: auto;
  height: 100%;
  box-sizing: border-box;
  color: var(--input-text, #ccc);
  font-size: 12px;
}
.nkd-panel-section { margin-bottom: 14px; }
.nkd-panel-section-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--input-text, #aaa);
  opacity: 0.55;
  margin: 0 0 8px 0;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border-color, #444);
}
.nkd-panel-presets { display: flex; flex-direction: column; gap: 4px; }
.nkd-panel-preset-btn {
  width: 100%;
  padding: 6px 8px;
  font-size: 11px;
  text-align: left;
  background: var(--comfy-input-bg, #1a1a1a);
  color: var(--input-text, #ccc);
  border: 1px solid var(--border-color, #444);
  border-radius: 4px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.nkd-panel-preset-btn:hover { border-color: var(--input-text, #888); }
.nkd-panel-preset-btn.nkd-active { border-color: var(--nkd-accent); color: var(--nkd-accent); }
.nkd-panel-preset-save { border-style: dashed; opacity: 0.85; }
.nkd-panel-preset-save:hover { opacity: 1; }
.nkd-panel-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 7px;
  transition: opacity 0.15s;
}
.nkd-panel-label {
  flex: 0 0 108px;
  font-size: 11px;
  color: var(--input-text, #ccc);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nkd-panel-slider { flex: 1; min-width: 0; accent-color: var(--nkd-accent); cursor: pointer; }
.nkd-panel-value {
  flex: 0 0 44px;
  min-width: 0;
  text-align: right;
  font: inherit;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  opacity: 0.65;
  color: inherit;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  padding: 1px 3px;
}
.nkd-panel-value:hover { border-color: var(--border-color, #444); opacity: 0.9; }
.nkd-panel-value:focus {
  outline: none;
  opacity: 1;
  border-color: var(--nkd-accent);
  background: var(--comfy-input-bg, #1a1a1a);
}
.nkd-panel-select {
  flex: 1;
  min-width: 0;
  background: var(--comfy-input-bg, #1a1a1a);
  color: var(--input-text, #ccc);
  border: 1px solid var(--border-color, #444);
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 11px;
  cursor: pointer;
}
.nkd-panel-toggle-label {
  position: relative;
  display: inline-block;
  width: 34px;
  height: 18px;
  flex-shrink: 0;
  cursor: pointer;
}
.nkd-panel-toggle-label input { opacity: 0; width: 0; height: 0; position: absolute; }
.nkd-panel-toggle-track {
  position: absolute;
  inset: 0;
  background: var(--border-color, #555);
  border-radius: 9px;
  transition: background 0.2s;
}
.nkd-panel-toggle-track::after {
  content: "";
  position: absolute;
  left: 2px; top: 2px;
  width: 14px; height: 14px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.2s;
}
.nkd-panel-toggle-label input:checked + .nkd-panel-toggle-track { background: var(--nkd-accent); }
.nkd-panel-toggle-label input:checked + .nkd-panel-toggle-track::after { transform: translateX(16px); }
.nkd-panel-disabled { opacity: 0.4 !important; pointer-events: none !important; }
.nkd-panel-reset {
  width: 100%;
  margin-top: 6px;
  padding: 7px;
  background: var(--comfy-input-bg, #1a1a1a);
  color: var(--input-text, #ccc);
  border: 1px solid var(--border-color, #444);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  transition: border-color 0.15s;
}
.nkd-panel-reset:hover { border-color: var(--input-text, #888); }
`
    document.head.appendChild(s)
  }

  // ── Local helpers ────────────────────────────────────────────────────────────

  function getSetting(key) {
    const id = _stateKeyToSettingId[key]
    return id ? (app.ui?.settings?.getSettingValue?.(id) ?? DEFAULTS[key]) : DEFAULTS[key]
  }

  const _persistTimers = new Map()

  function setSetting(key, value, persist = true) {
    state[key] = value
    redraw()
    // Debounce persistence — setSettingValue round-trips to the server, so during a
    // drag we skip it entirely (persist=false) and flush once on pointerup.
    const id = persist ? _stateKeyToSettingId[key] : null
    if (id) {
      clearTimeout(_persistTimers.get(key))
      _persistTimers.set(key, setTimeout(() => {
        app.ui?.settings?.setSettingValue?.(id, value)
        _persistTimers.delete(key)
      }, 200))
    }
  }

  const presetBtns = []
  function clearPreset() { presetBtns.forEach(b => b.classList.remove("nkd-active")) }

  function detectActivePreset() {
    for (const [name, preset] of Object.entries(allPresets())) {
      if (Object.keys(preset).every(k => state[k] === preset[k])) return name
    }
    return null
  }

  function makeSection(title) {
    const sec = document.createElement("div")
    sec.className = "nkd-panel-section"
    const h = document.createElement("div")
    h.className = "nkd-panel-section-title"
    h.textContent = title
    sec.appendChild(h)
    return sec
  }

  function makeSlider(key, label, min, max, step) {
    const fine   = fineStep(min, max, step)
    const coarse = coarseStep(min, max)
    const dec    = decimalsOf(fine)
    const row = document.createElement("div")
    row.className = "nkd-panel-row"
    const lbl = document.createElement("span")
    lbl.className = "nkd-panel-label"
    lbl.textContent = label
    if (TIPS[key]) {
      const tip = `${TIPS[key]}\n\nHold Shift while dragging to snap in steps of ${_fmtVal(coarse, decimalsOf(coarse))}.`
      lbl.title = tip
      row.title = tip
    }
    const inp = document.createElement("input")
    inp.type = "range"
    inp.className = "nkd-panel-slider"
    inp.min = min; inp.max = max; inp.step = fine
    inp.value = getSetting(key)
    // Editable number: type an exact value instead of hunting for it with the thumb.
    const valInp = document.createElement("input")
    valInp.type = "text"
    valInp.inputMode = "decimal"
    valInp.className = "nkd-panel-value"
    valInp.title = `Type an exact value (${min} – ${max})`
    valInp.value = _fmtVal(Number(inp.value), dec)

    // Snapped to absolute multiples of the step, not to offsets from min, so Shift
    // always lands on 0.2 / 40 / 500 rather than on min + 0.2.
    function snap(raw, s) {
      const v = Math.round(raw / s) * s
      return parseFloat(Math.max(min, Math.min(max, v)).toFixed(10))
    }

    // Custom drag: capture-phase document listeners beat LiteGraph's canvas handlers.
    // r is captured once at pointerdown — avoids width=0 if the browser transiently
    // changes the input layout when preventDefault() suppresses the native thumb.
    inp.addEventListener("pointerdown", e => {
      e.stopPropagation()
      e.preventDefault()
      const r = inp.getBoundingClientRect()  // frozen for the whole drag
      function update(clientX, shift) {
        const raw = min + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (max - min)
        const v = snap(raw, shift ? coarse : fine)
        inp.value = v
        valInp.value = _fmtVal(v, dec)
        setSetting(key, v, false)
        clearPreset()
      }
      update(e.clientX, e.shiftKey)
      const onMove = ev => { ev.stopPropagation(); update(ev.clientX, ev.shiftKey) }
      const onUp   = ev => {
        ev.stopPropagation()
        document.removeEventListener("pointermove", onMove, true)
        document.removeEventListener("pointerup",   onUp,   true)
        setSetting(key, state[key])  // one persist per drag, on release
      }
      document.addEventListener("pointermove", onMove, true)
      document.addEventListener("pointerup",   onUp,   true)
    })

    function commitTyped() {
      const raw = parseFloat(String(valInp.value).replace(",", "."))
      if (Number.isNaN(raw)) { valInp.value = _fmtVal(state[key], dec); return }
      const v = parseFloat(Math.max(min, Math.min(max, raw)).toFixed(dec))
      inp.value = v
      valInp.value = _fmtVal(v, dec)
      setSetting(key, v)
      clearPreset()
    }
    valInp.addEventListener("change", commitTyped)
    valInp.addEventListener("focus", () => valInp.select())
    valInp.addEventListener("pointerdown", e => e.stopPropagation())
    // Comfy binds single-key canvas shortcuts globally — typing must not reach them
    valInp.addEventListener("keydown", e => {
      e.stopPropagation()
      if (e.key === "Enter")  { commitTyped(); valInp.blur() }
      if (e.key === "Escape") { valInp.value = _fmtVal(state[key], dec); valInp.blur() }
    })

    row.append(lbl, inp, valInp)
    _panelRefs.set(key, { el: inp, valEl: valInp, dec, type: "slider" })
    return row
  }


  // keepPreset: para interruptores que NO son geometría de la curva. Sin él,
  // encender el ruteo PCB marcaba el preset como "Custom" sin haber tocado un
  // solo mando de la curva.
  function makeToggle(key, label, tip, keepPreset = false) {
    const row = document.createElement("div")
    row.className = "nkd-panel-row"
    if (tip) row.title = tip
    const lbl = document.createElement("span")
    lbl.className = "nkd-panel-label"
    lbl.textContent = label
    const wrapLabel = document.createElement("label")
    wrapLabel.className = "nkd-panel-toggle-label"
    const cb = document.createElement("input")
    cb.type = "checkbox"
    cb.checked = Boolean(getSetting(key))
    const track = document.createElement("span")
    track.className = "nkd-panel-toggle-track"
    wrapLabel.append(cb, track)
    row.append(lbl, wrapLabel)
    cb.addEventListener("change", () => {
      setSetting(key, cb.checked)
      if (!keepPreset) clearPreset()
    })
    _panelRefs.set(key, { el: cb, type: "checkbox" })
    return row
  }

  // ── Build DOM ────────────────────────────────────────────────────────────────

  const wrap = document.createElement("div")
  wrap.className = "nkd-panel"
  // Attached up front: if anything below throws, the user still sees a partial
  // panel (and a console error) instead of a silently blank sidebar.
  el.appendChild(wrap)

  // — MODE —
  const secMode = makeSection("Mode")
  const modeRow = document.createElement("div")
  modeRow.className = "nkd-panel-row"
  const modeLbl = document.createElement("span")
  modeLbl.className = "nkd-panel-label"
  modeLbl.textContent = "Advanced mode"
  modeRow.title = "Simple: only wires touching a reroute dot are restyled; every other wire keeps Comfy's normal look. Advanced: NKD draws all wires and every control below becomes available."
  const modeLabel = document.createElement("label")
  modeLabel.className = "nkd-panel-toggle-label"
  const modeCb = document.createElement("input")
  modeCb.type = "checkbox"
  modeCb.checked = state.mode === "Advanced"
  const modeTrack = document.createElement("span")
  modeTrack.className = "nkd-panel-toggle-track"
  modeLabel.append(modeCb, modeTrack)
  modeRow.append(modeLbl, modeLabel)
  secMode.appendChild(modeRow)
  modeCb.addEventListener("change", () => {
    const next = modeCb.checked ? "Advanced" : "Simple"
    state.mode = next
    app.ui?.settings?.setSettingValue?.("NKD Reroutes.Mode", next)
    redraw()
    buildPanel(el)  // rebuild to show/hide advanced sections
  })
  // El ruteo PCB no es un afinado de la curva: es otro renderizador. Por eso va
  // en Modo y no entre los mandos, y por eso se ve en Simple y en Advanced.
  const pcbRow = makeToggle("pcbEnabled", "PCB routing",
    "Draws wires as right-angled traces that go around the nodes instead of curving over them, like a circuit board. " +
    "The curve controls below stop applying while it is on.", true)
  pcbRow.querySelector("input").addEventListener("change", () => buildPanel(el))
  secMode.appendChild(pcbRow)
  wrap.appendChild(secMode)

  // — PCB (sólo cuando el ruteo manda; sus mandos no significan nada apagado) —
  if (state.pcbEnabled) {
    const secPcb = makeSection("PCB Routing")
    secPcb.appendChild(makeSlider("cornerRadius", "Corner radius", 0, 30, 1))
    secPcb.appendChild(makeSlider("nodeAvoidance", "Node avoidance", 1, 20, 1))
    secPcb.appendChild(makeSlider("ignoreShorterThan", "Ignore nodes under", 0, 100, 5))
    secPcb.appendChild(makeToggle("spreadCorridors", "Spread shared lanes",
      "When two unrelated wires end up running down the same corridor they are drawn on top of " +
      "each other. This fans them out into parallel lanes. Turn it off to keep every wire exactly " +
      "where the routing put it.", true))
    wrap.appendChild(secPcb)
  }

  // — REROUTE DOT (always visible in both modes) —
  const secDotTop = makeSection("Reroute Dot")
  secDotTop.appendChild(makeSlider("rerouteRadius", "Dot size", 3, 15, 1))
  if (state.mode === "Simple") {
    secDotTop.appendChild(makeSlider("simpleRerouteOffset", "Handle offset", 10, 120, 5))
  }
  wrap.appendChild(secDotTop)

  // — MAGNETISMO (visible en ambos modos: no tiene que ver con la tensión) —
  const secMagnet = makeSection("Magnet")
  secMagnet.appendChild(makeToggle("magnetEnabled", "Snap with Shift",
    "Hold Shift while dragging a node and it lines up and sticks to its neighbours."))
  const magnetRows = [
    makeSlider("magnetRadius", "Magnet radius", 5, 60, 1),
    makeSlider("magnetGapY",   "Vertical gap", 0, 60, 2),
    makeSlider("magnetGapX",   "Horizontal gap", 0, 120, 2),
    makeToggle("magnetGuides", "Show guides",
      "Draws a preview outline and alignment lines while a node is snapping into place."),
    makeToggle("magnetMatchWidth", "Match column width",
      "A node snapping into a column also takes that column's width. It never shrinks below its own minimum width."),
  ]
  magnetRows.forEach(r => secMagnet.appendChild(r))

  function setMagnetEnabled(on) {
    magnetRows.forEach(r => r.classList.toggle("nkd-panel-disabled", !on))
  }
  setMagnetEnabled(Boolean(state.magnetEnabled))
  _syncHooks.push(() => setMagnetEnabled(Boolean(state.magnetEnabled)))
  _panelRefs.get("magnetEnabled").el
    .addEventListener("change", (e) => setMagnetEnabled(e.target.checked))

  wrap.appendChild(secMagnet)

  // Shared reset — built once, appended at the end so it sits below all sections.
  const resetBtn = document.createElement("button")
  resetBtn.className = "nkd-panel-reset"
  resetBtn.textContent = "Reset to defaults"
  resetBtn.addEventListener("click", () => {
    // Preserve current mode — resetting shouldn't yank the user out of Advanced.
    const keepMode = state.mode
    Object.assign(state, DEFAULTS, { mode: keepMode })
    if (app.ui?.settings?.setSettingValue) {
      for (const [settingId, key] of Object.entries(SETTING_ID_MAP)) {
        if (key === "mode") continue
        if (key in DEFAULTS) app.ui.settings.setSettingValue(settingId, DEFAULTS[key])
      }
    }
    syncPanelFromState()
    if (typeof clearPreset === "function") clearPreset()
    redraw()
  })

  // Advanced-only sections — early return for Simple keeps the panel minimal
  if (state.mode === "Simple") {
    wrap.appendChild(resetBtn)
    return
  }

  // — PRESET —
  const secPreset = makeSection("Preset")
  const presetGroup = document.createElement("div")
  presetGroup.className = "nkd-panel-presets"

  // Se redibuja entero al guardar o borrar: son cuatro botones, no compensa
  // parchear la lista a mano.
  function renderPresets() {
    presetGroup.textContent = ""
    presetBtns.length = 0
    const mios = userPresets()

    for (const name of Object.keys(allPresets())) {
      const propio = name in mios
      const btn = document.createElement("button")
      btn.className = "nkd-panel-preset-btn"
      btn.textContent = name
      btn.title = propio
        ? "Click to apply · right-click to delete"
        : "The wires exactly as ComfyUI draws them, with no styling"
      btn.addEventListener("click", () => {
        applyPreset(name)
        syncPanelFromState()
        presetBtns.forEach(b => b.classList.toggle("nkd-active", b === btn))
      })
      if (propio) {
        btn.addEventListener("contextmenu", (e) => {
          e.preventDefault()
          if (!confirm(`Delete preset "${name}"?`)) return
          deleteUserPreset(name)
          renderPresets()
        })
      }
      presetBtns.push(btn)
      presetGroup.appendChild(btn)
    }

    const save = document.createElement("button")
    save.className = "nkd-panel-preset-btn nkd-panel-preset-save"
    save.textContent = "+ Save current settings"
    save.title = "Store the current wire shape under a name you choose"
    save.addEventListener("click", () => {
      const name = prompt("Preset name")?.trim()
      if (!name) return
      if (name in PRESETS) { alert(`"${name}" is a built-in preset — pick another name.`); return }
      if (name in userPresets() && !confirm(`Overwrite "${name}"?`)) return
      saveUserPreset(name)
      renderPresets()
      const btn = presetBtns.find(b => b.textContent === name)
      if (btn) btn.classList.add("nkd-active")
    })
    presetGroup.appendChild(save)

    const activo = detectActivePreset()
    if (activo) presetBtns.forEach(b => b.classList.toggle("nkd-active", b.textContent === activo))
  }

  renderPresets()
  secPreset.appendChild(presetGroup)
  wrap.appendChild(secPreset)

  // — WIRE SHAPE —
  const secShape = makeSection("Wire Shape")
  secShape.append(
    makeSlider("handleFactor",      "Wire curvature",       0.1, 2.0,  0.1 ),
    makeSlider("nonLinear",         "Elasticity",           0.1, 2.0,  0.1 ),
    makeSlider("distFactor",        "Distance stretch",     0,   2.0,  0.05),
    makeSlider("minSplineOffset",   "Minimum handle",       0,   60,   1   ),
    makeSlider("maxHandleRatio",    "Handle ceiling",       0,   1.5,  0.05),
    makeSlider("nodeBodyClearance",   "Node body clearance", 0,   80,  2   ),
    makeSlider("stubLength",        "Socket stub",          0,   60,   1   ),
  )
  wrap.appendChild(secShape)

  // — PULL PER ENDPOINT —
  const secPull = makeSection("Pull Per Endpoint")
  secPull.append(
    makeSlider("nodeFactor",    "Node ends",    0.1, 2.0, 0.1),
    makeSlider("rerouteFactor", "Reroute ends", 0.1, 2.0, 0.1),
  )
  wrap.appendChild(secPull)

  // — BACKWARD & CROSSING —
  const secBack = makeSection("Backward & Crossing")

  // Toggle: Invert on backward
  const tRow = document.createElement("div")
  tRow.className = "nkd-panel-row"
  const tLbl = document.createElement("span")
  tLbl.className = "nkd-panel-label"
  tLbl.textContent = "Invert on backward"
  tRow.title = "When a wire has to travel backwards (target node to the LEFT of the source), curl it into a C-shaped loop instead of letting it cut straight across the nodes."
  const tLabel = document.createElement("label")
  tLabel.className = "nkd-panel-toggle-label"
  const tCb = document.createElement("input")
  tCb.type = "checkbox"
  tCb.checked = Boolean(getSetting("invertBackward"))
  const tTrack = document.createElement("span")
  tTrack.className = "nkd-panel-toggle-track"
  tLabel.append(tCb, tTrack)
  tRow.append(tLbl, tLabel)
  secBack.appendChild(tRow)
  _panelRefs.set("invertBackward", { el: tCb, type: "checkbox" })

  // Inversion pull — visually disabled when invertBackward is off
  const invPullRow = makeSlider("inversionPull", "Inversion pull", 10, 150, 5)
  secBack.appendChild(invPullRow)
  secBack.appendChild(makeSlider("backwardStretch", "Backward stretch", 0, 1.0, 0.05))
  secBack.appendChild(makeSlider("crossingMargin",  "Crossing width",   0, 300, 10  ))

  function setInvPullEnabled(on) {
    invPullRow.classList.toggle("nkd-panel-disabled", !on)
  }
  setInvPullEnabled(tCb.checked)
  _syncHooks.push(() => setInvPullEnabled(state.invertBackward))

  tCb.addEventListener("change", () => {
    setSetting("invertBackward", tCb.checked)
    setInvPullEnabled(tCb.checked)
    clearPreset()
  })

  wrap.appendChild(secBack)

  wrap.appendChild(resetBtn)

  // ── External sync: reflect ComfyUI settings changes in the panel ─────────────
  // ComfyUI only dispatches per-setting "<id>.change" events (detail: {value,
  // oldValue}). The generic "change" event this used to listen for is never
  // fired, so subscribe to each id we care about individually.
  for (const [settingId, key] of Object.entries(SETTING_ID_MAP)) {
    app.ui?.settings?.addEventListener?.(`${settingId}.change`, ({ detail }) => {
      const newVal = detail?.value
      if (newVal == null) return
      // Mode flips reshape the entire panel — rebuild instead of patching one ref.
      // Compare against the mode this panel was *built* for: the setting's own
      // onChange has already written state.mode by the time we get here.
      if (key === "mode") {
        if (builtMode !== newVal) { state.mode = newVal; buildPanel(el); redraw() }
        return
      }
      const ref = _panelRefs.get(key)
      if (!ref) return
      if (ref.type === "slider") {
        ref.el.value = newVal
        if (ref.valEl) ref.valEl.value = _fmtVal(Number(newVal), ref.dec)
      } else if (ref.type === "select") {
        ref.el.value = newVal
      } else if (ref.type === "checkbox") {
        ref.el.checked = Boolean(newVal)
        for (const hook of _syncHooks) hook()
      }
    }, { signal: _settingsListenerAC.signal })
  }
}

// Sync all panel controls from current state (called after applyPreset or reset)
function syncPanelFromState() {
  for (const [key, ref] of _panelRefs) {
    const v = state[key]
    if (v === undefined) continue
    if (ref.type === "slider") {
      ref.el.value = v
      if (ref.valEl) ref.valEl.value = _fmtVal(Number(v), ref.dec)
    } else if (ref.type === "select") {
      ref.el.value = v
    } else if (ref.type === "checkbox") {
      ref.el.checked = Boolean(v)
    }
  }
  for (const hook of _syncHooks) hook()
}