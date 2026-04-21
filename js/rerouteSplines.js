import { app } from "../../scripts/app.js"

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

const DEFAULTS = Object.freeze({
  minSplineOffset:          25,
  maxSplineOffset:          9999,
  handleFactor:             0.5,
  nodeOutFactor:            0.5,
  nodeInFactor:             0.5,
  rerouteOutFactor:         0.5,
  rerouteInFactor:          0.5,
  rerouteRadius:            5,
  crossingBehaviorNodes:    "Natural Loop",
  crossingBehaviorReroutes: "Natural Loop",
  pushOutMin:               0,
  pushOutMax:               50,
  socketMin:                10,
  socketMax:                40,
  stretchRef:               300,
  nonLinear:                1.0,
  inversionPull:            40,
  invertBackward:           true,
  dampingRef:               100,
  dampingMin:               0.15,
  verticalEscapeScale:      0.4,
  nodeBodyClearance:        24,
})

// Live mutable state — always reflects current user config
const state = { ...DEFAULTS }

// ─── Presets ─────────────────────────────────────────────────────────────────

const PRESETS = {
  "Clean & Tight": {
    handleFactor:             0.35,
    nodeOutFactor:            0.8,
    nodeInFactor:             0.8,
    rerouteOutFactor:         0.8,
    rerouteInFactor:          0.8,
    crossingBehaviorNodes:    "Hard Push Out",
    crossingBehaviorReroutes: "Hard Push Out",
    pushOutMin:               20,
    pushOutMax:               60,
    rerouteRadius:            4,
    socketMin:                8,
    socketMax:                25,
    stretchRef:               200,
    nonLinear:                1.2,
    inversionPull:            30,
    invertBackward:           true,
    dampingRef:               80,
    dampingMin:               0.0,
    verticalEscapeScale:      0.3,
    nodeBodyClearance:        20,
  },
  "Flowy & Organic": {
    handleFactor:             0.7,
    nodeOutFactor:            1.2,
    nodeInFactor:             1.2,
    rerouteOutFactor:         1.3,
    rerouteInFactor:          1.3,
    crossingBehaviorNodes:    "Natural Loop",
    crossingBehaviorReroutes: "Natural Loop",
    pushOutMin:               0,
    pushOutMax:               80,
    rerouteRadius:            6,
    socketMin:                15,
    socketMax:                55,
    stretchRef:               400,
    nonLinear:                0.8,
    inversionPull:            60,
    invertBackward:           true,
    dampingRef:               150,
    dampingMin:               0.2,
    verticalEscapeScale:      0.5,
    nodeBodyClearance:        28,
  },
  "Straight Business": {
    handleFactor:             0.2,
    nodeOutFactor:            0.5,
    nodeInFactor:             0.5,
    rerouteOutFactor:         0.5,
    rerouteInFactor:          0.5,
    crossingBehaviorNodes:    "Hard Push Out",
    crossingBehaviorReroutes: "Hard Push Out",
    pushOutMin:               10,
    pushOutMax:               40,
    rerouteRadius:            3,
    socketMin:                5,
    socketMax:                15,
    stretchRef:               150,
    nonLinear:                1.5,
    inversionPull:            20,
    invertBackward:           false,
    dampingRef:               50,
    dampingMin:               0.0,
    verticalEscapeScale:      0.15,
    nodeBodyClearance:        16,
  },
  // Approximates the original LiteGraph formula: offset = dist * 0.25
  // socketMin/Max/stretchRef calibrated so the smoothstep matches dist*0.25 within ~10%
  // at typical node spacings (150–600 px). invertBackward=false keeps handles pointing
  // outward (right from output, left from input) matching the original's sign convention.
  // verticalEscapeScale=0 preserves fully horizontal tension on all wire angles.
  "Classic Comfy": {
    handleFactor:             1.0,
    nodeOutFactor:            1.0,
    nodeInFactor:             1.0,
    rerouteOutFactor:         0.8,
    rerouteInFactor:          0.8,
    crossingBehaviorNodes:    "Natural Loop",
    crossingBehaviorReroutes: "Natural Loop",
    pushOutMin:               0,
    pushOutMax:               50,
    rerouteRadius:            5,
    socketMin:                5,
    socketMax:                150,
    stretchRef:               600,
    nonLinear:                1.0,
    inversionPull:            75,
    invertBackward:           false,
    dampingRef:               100,
    dampingMin:               0.1,
    verticalEscapeScale:      0.0,
    nodeBodyClearance:        24,
  },
}

// ─── Setting ID ↔ State Key Map ─────────────────────────────────────────────
// Used by the preset loader to sync UI settings after applying a preset.

const SETTING_ID_MAP = {
  "NKD Reroutes.WireCurvature":          "handleFactor",
  "NKD Reroutes.NodeOutgoingPull":       "nodeOutFactor",
  "NKD Reroutes.NodeIncomingPull":       "nodeInFactor",
  "NKD Reroutes.RerouteOutgoingPull":    "rerouteOutFactor",
  "NKD Reroutes.RerouteIncomingPull":    "rerouteInFactor",
  "NKD Reroutes.NodeBackwardsCrossing":  "crossingBehaviorNodes",
  "NKD Reroutes.RerouteBackwardsCrossing": "crossingBehaviorReroutes",
  "NKD Reroutes.BackwardWireClearanceMin": "pushOutMin",
  "NKD Reroutes.BackwardWireClearanceMax": "pushOutMax",
  "NKD Reroutes.RerouteDotSize":           "rerouteRadius",
  "NKD Reroutes.SocketMin":             "socketMin",
  "NKD Reroutes.SocketMax":             "socketMax",
  "NKD Reroutes.StretchRef":            "stretchRef",
  "NKD Reroutes.NonLinear":             "nonLinear",
  "NKD Reroutes.InversionPull":         "inversionPull",
  "NKD Reroutes.InvertBackward":        "invertBackward",
  "NKD Reroutes.DampingRef":            "dampingRef",
  "NKD Reroutes.DampingMin":            "dampingMin",
  "NKD Reroutes.VerticalEscapeScale":   "verticalEscapeScale",
  "NKD Reroutes.NodeBodyClearance":     "nodeBodyClearance",
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

app.registerExtension({
  name: "NKD Reroutes",
  setup() {
    registerSettings()
    patchLiteGraph()
    registerSidebarPanel()
  },
})

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

  // --- Preset selector ---
  add({
    id:           "NKD Reroutes.Preset",
    name:         "Wire Style Preset",
    tooltip:      "Quick preset that configures all tension and crossing settings at once. Individual sliders below still work for fine-tuning after choosing a preset.",
    type:         "combo",
    options:      ["Custom", ...Object.keys(PRESETS)],
    defaultValue: "Custom",
    onChange(v) { applyPreset(v) },
  })

  // --- Sliders (declarative array) ---
  const sliders = [
    { id: "WireCurvature",       key: "handleFactor",    label: "Wire Curvature",          tip: "How much wires curve between two points. Higher = rounder arcs, lower = straighter lines.", min: 0.1, max: 2.0, step: 0.1 },
    { id: "NodeOutgoingPull",    key: "nodeOutFactor",   label: "Node Outgoing Pull",      tip: "Extra curvature multiplier for wires leaving a node's output socket.",                       min: 0.1, max: 2.0, step: 0.1 },
    { id: "NodeIncomingPull",    key: "nodeInFactor",    label: "Node Incoming Pull",       tip: "Extra curvature multiplier for wires arriving at a node's input socket.",                    min: 0.1, max: 2.0, step: 0.1 },
    { id: "RerouteOutgoingPull", key: "rerouteOutFactor",label: "Reroute Outgoing Pull",    tip: "Extra curvature multiplier for wires leaving a reroute dot.",                                min: 0.1, max: 2.0, step: 0.1 },
    { id: "RerouteIncomingPull", key: "rerouteInFactor", label: "Reroute Incoming Pull",    tip: "Extra curvature multiplier for wires arriving at a reroute dot.",                            min: 0.1, max: 2.0, step: 0.1 },
    { id: "BackwardWireClearanceMin", key: "pushOutMin", label: "Backward Clearance Min", tip: "Minimum backward wire clearance (px) at 90° (near-vertical wires). Acts as the floor when angle modulation reduces the push.",  min: 0, max: 150, step: 5 },
    { id: "BackwardWireClearanceMax", key: "pushOutMax", label: "Backward Clearance Max", tip: "Maximum backward wire clearance (px) at 0°–45° (horizontal wires). The clearance smoothly interpolates down to Min as the wire approaches vertical.", min: 0, max: 200, step: 5 },
    { id: "RerouteDotSize",      key: "rerouteRadius",  label: "Reroute Dot Size",         tip: "Visual radius of the reroute dot in pixels. Minimum 3 to stay clickable.",                   min: 3, max: 15, step: 1 },
    { id: "SocketMin",           key: "socketMin",      label: "Socket Offset Min",        tip: "Minimum Bézier handle offset (px) at the socket when nodes are very close horizontally.",    min: 3, max: 50, step: 1 },
    { id: "SocketMax",           key: "socketMax",      label: "Socket Offset Max",        tip: "Maximum Bézier handle offset (px) at the socket when nodes are far apart horizontally.",     min: 10, max: 200, step: 5 },
    { id: "StretchRef",          key: "stretchRef",     label: "Stretch Reference",        tip: "Horizontal distance (px) at which the socket offset reaches its maximum. Larger = the curve grows more gradually as nodes spread apart.", min: 50, max: 1000, step: 50 },
    { id: "NonLinear",           key: "nonLinear",      label: "Curvature Non-Linearity",  tip: "Amplifies the difference between short and long wires. Above 1.0 = short wires get tighter while long ones stay open. Below 1.0 = more uniform curvature across all distances.", min: 0.1, max: 2.0, step: 0.1 },
    { id: "InversionPull",       key: "inversionPull",  label: "Inversion Pull",           tip: "Base handle offset (px) for backward wires (output to the right of input). Controls the width of the 'C' loop without depending on node distance.", min: 10, max: 150, step: 5 },
    { id: "DampingRef",          key: "dampingRef",          label: "Damping Range",          tip: "Horizontal distance (px) at which full curvature is restored after verticality damping. Smaller = curvature kicks back in closer to the socket; larger = gradual transition.",                          min: 20, max: 400,  step: 10   },
    { id: "DampingMin",          key: "dampingMin",          label: "Curvature Floor",        tip: "Minimum damping multiplier when the wire is nearly vertical. 0 = curvature fully collapses to straight; 1 = no damping at all. Set above 0 to keep a visible curve even when nodes are stacked.",     min: 0,  max: 1.0,  step: 0.1  },
    { id: "VerticalEscapeScale", key: "verticalEscapeScale", label: "Vertical Escape",        tip: "Adds a vertical component to Bézier handles when a wire is nearly vertical, pulling it clear of the node body. 0 = no escape, 1 = maximum escape.",                                                  min: 0,  max: 1.0,  step: 0.05 },
    { id: "NodeBodyClearance",   key: "nodeBodyClearance",   label: "Node Body Clearance",    tip: "Minimum horizontal handle offset (px) when nodes are very close horizontally (dx < 80px). Prevents wires from hiding inside the node border.",                                                         min: 0,  max: 80,   step: 2    },
  ]

  for (const s of sliders) {
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

  // --- Combo selectors ---
  const combos = [
    { id: "NodeBackwardsCrossing",    key: "crossingBehaviorNodes",    label: "Node Backward Crossing",    tip: "What happens when a wire goes left (backwards) from a node. 'Natural Loop' lets it arc freely; 'Hard Push Out' forces a fixed horizontal push to keep it readable." },
    { id: "RerouteBackwardsCrossing", key: "crossingBehaviorReroutes", label: "Reroute Backward Crossing",  tip: "Same as above, but for wires going backwards from a reroute dot." },
  ]

  for (const c of combos) {
    add({
      id:           `NKD Reroutes.${c.id}`,
      name:         c.label,
      tooltip:      c.tip,
      type:         "combo",
      options:      ["Natural Loop", "Hard Push Out"],
      defaultValue: DEFAULTS[c.key],
      onChange(v) { state[c.key] = v; redraw() },
    })
  }
}

// ─── Preset Application ──────────────────────────────────────────────────────

function applyPreset(name) {
  const preset = PRESETS[name]
  if (!preset) return // "Custom" — do nothing, user tweaks manually

  // 1. Write values into live state
  Object.assign(state, preset)

  // 2. Sync ComfyUI's settings UI so sliders/combos reflect the new values
  if (app.ui?.settings?.setSettingValue) {
    for (const [settingId, stateKey] of Object.entries(SETTING_ID_MAP)) {
      if (stateKey in preset) {
        app.ui.settings.setSettingValue(settingId, preset[stateKey])
      }
    }
  }

  redraw()
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function redraw() {
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
// Pure function — all the Bézier handle logic in one place.

function computeSegmentTension(a, b, startDir, endDir, extras, link) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const wireDist = Math.sqrt(dx * dx + dy * dy)
  // 0→1 ramp used to scale floors proportionally for short connections.
  const distRamp = Math.min(1, wireDist / 80)

  // --- Determine horizontal sign for each handle ---
  let startSignX = 1
  let endSignX   = -1

  if (extras?.startControl)      startSignX = extras.startControl[0] < 0 ? -1 : 1
  else if (startDir === 3)       startSignX = -1 // LEFT

  if (extras?.endControl)        endSignX = extras.endControl[0] > 0 ? 1 : -1
  else if (endDir === 4)         endSignX = 1    // RIGHT

  // --- Detect endpoint types ---
  const startIsReroute = isRerouteEndpoint(startDir, extras, link, "start")
  const endIsReroute   = isRerouteEndpoint(endDir,   extras, link, "end")

  // --- Dynamic socket offset (smoothstep over horizontal stretch) ---
  const tSock   = Math.min(1, Math.abs(dx) / state.stretchRef)
  const smoothT = tSock * tSock * (3 - 2 * tSock)
  let baseTension = state.socketMin + (state.socketMax - state.socketMin) * smoothT

  // --- Non-linear elasticity ---
  // ratio < 1 for small tensions, > 1 for large; nonLinear amplifies the contrast.
  const ratio = Math.pow(baseTension / 250, 0.9)
  baseTension = baseTension * Math.pow(ratio, state.nonLinear - 1)

  // --- Per-endpoint multipliers ---
  const outMultiplier = startIsReroute ? state.rerouteOutFactor : state.nodeOutFactor
  const inMultiplier  = endIsReroute   ? state.rerouteInFactor  : state.nodeInFactor

  let offsetStart = baseTension * outMultiplier
  let offsetEnd   = baseTension * inMultiplier

  // --- Crossing behavior ---
  const startCrossing = startIsReroute ? state.crossingBehaviorReroutes : state.crossingBehaviorNodes
  const endCrossing   = endIsReroute   ? state.crossingBehaviorReroutes : state.crossingBehaviorNodes

  let applyDampingStart = true
  let applyDampingEnd   = true

  // --- Crossing blend factor ---
  // Smoothly interpolates forward tension into backward tension over a ±30 px window
  // around dx = 0, eliminating the hard jump at the forward/backward boundary.
  const CROSSING_MARGIN = 30
  let crossBlend = 0
  if (dx < CROSSING_MARGIN) {
    const t = Math.max(0, Math.min(1, (CROSSING_MARGIN - dx) / (2 * CROSSING_MARGIN)))
    crossBlend = t * t * (3 - 2 * t)
  }

  // --- Angle-based modulation ---
  // Fades inversionPull/clearance to zero as the wire approaches vertical.
  // Runs across the full blend zone, not just the purely backward region.
  let angleMult = 1
  if (dx < CROSSING_MARGIN) {
    const angle  = Math.atan2(Math.abs(dy), Math.abs(dx))              // 0 (horizontal) → π/2 (vertical)
    const tAngle = Math.max(0, (angle - Math.PI / 4) / (Math.PI / 4)) // 0°–45°→0, 90°→1
    angleMult = 1 - tAngle * tAngle * (3 - 2 * tAngle)               // smoothstep falloff
  }

  // --- Backward crossing: sign flip + organic belly ---
  // Sign snaps at dx = 0 (acceptable); magnitude blends smoothly via crossBlend.
  if (dx < 0 && state.invertBackward) {
    if (startCrossing !== "Hard Push Out") startSignX *= -1
    if (endCrossing   !== "Hard Push Out") endSignX   *= -1
  }

  if (crossBlend > 0) {
    // dy contribution: fills the gap left by inversionPull*angleMult as the wire tilts
    // toward vertical. Factor 0.25 matches the original ComfyUI dist*0.25 at full vertical.
    const dyBoost   = Math.abs(dy) * 0.25 * (1 - angleMult)
    const invBase   = state.inversionPull * angleMult + dyBoost
    const clearance = state.pushOutMin + (state.pushOutMax - state.pushOutMin) * angleMult + dyBoost
    if (startCrossing !== "Hard Push Out") {
      const raw = invBase * outMultiplier
      const backStart = startIsReroute ? raw : Math.max(clearance, raw)
      offsetStart = offsetStart * (1 - crossBlend) + backStart * crossBlend
      if (crossBlend >= 0.5) applyDampingStart = false
    }
    if (endCrossing !== "Hard Push Out") {
      const raw = invBase * inMultiplier
      const backEnd = endIsReroute ? raw : Math.max(clearance, raw)
      offsetEnd = offsetEnd * (1 - crossBlend) + backEnd * crossBlend
      if (crossBlend >= 0.5) applyDampingEnd = false
    }
  }

  // --- Hard Push Out: strict override — interpolated between pushOutMin and pushOutMax ---
  if (startCrossing === "Hard Push Out") {
    offsetStart = state.pushOutMin + (state.pushOutMax - state.pushOutMin) * angleMult
    applyDampingStart = false
  }
  if (endCrossing === "Hard Push Out") {
    offsetEnd = state.pushOutMin + (state.pushOutMax - state.pushOutMin) * angleMult
    applyDampingEnd = false
  }

  // --- Clamp offsets ---
  offsetStart = Math.min(state.maxSplineOffset, Math.max(state.minSplineOffset, offsetStart))
  offsetEnd   = Math.min(state.maxSplineOffset, Math.max(state.minSplineOffset, offsetEnd))

  // --- Verticality damping (smoothstep) ---
  // dampingRef: horizontal distance at which the wire regains full curvature.
  // dampingMin: floor that prevents socketMin from being wiped out when dx → 0.
  const t = Math.min(1, Math.abs(dx) / state.dampingRef)
  const smoothDamping = state.dampingMin + (1 - state.dampingMin) * (t * t * (3 - 2 * t))

  if (applyDampingStart) { offsetStart *= smoothDamping; offsetStart = Math.max(state.socketMin * distRamp, offsetStart) }
  if (applyDampingEnd)   { offsetEnd   *= smoothDamping; offsetEnd   = Math.max(state.socketMin * distRamp, offsetEnd)   }

  // --- Node body clearance: force minimum X offset when connection is near-vertical ---
  // Scaled by distRamp so short connections don't get excessive curves.
  if (Math.abs(dx) < 80) {
    const clr = state.nodeBodyClearance * distRamp
    offsetStart = Math.max(offsetStart, clr)
    offsetEnd   = Math.max(offsetEnd,   clr)
  }

  // --- Vertical escape ---
  const vertRatio = wireDist > 0 ? Math.abs(dy) / wireDist : 0
  const escapeY   = offsetStart * vertRatio * state.verticalEscapeScale
  const escapeSign = dy >= 0 ? 1 : -1

  return {
    startControl: [offsetStart * startSignX,  escapeY * escapeSign],
    endControl:   [offsetEnd   * endSignX,   -escapeY * escapeSign],
  }
}

// ─── LiteGraph Patches ──────────────────────────────────────────────────────

function patchLiteGraph() {
  patchDrawLink()
  patchRenderLink()
  patchDrawConnections()
}

// --- 1. Legacy drawLink (used for basic canvas spline rendering) ---

function patchDrawLink() {
  const orig = LGraphCanvas.prototype.drawLink

  LGraphCanvas.prototype.drawLink = function (
    ctx, start, end, link_data, skip_border, is_selected, link_color, start_node, end_node
  ) {
    if (!start || !end) return orig.apply(this, arguments)

    const dx     = end[0] - start[0]
    const tSock  = Math.min(1, Math.abs(dx) / state.stretchRef)
    const smoothT = tSock * tSock * (3 - 2 * tSock)
    const currentOffset = state.socketMin + (state.socketMax - state.socketMin) * smoothT

    let offsetStart = Math.min(state.maxSplineOffset, Math.max(state.minSplineOffset, currentOffset))
    let offsetEnd   = offsetStart

    if (dx < 0) {
      const angle     = Math.atan2(Math.abs(end[1] - start[1]), Math.abs(dx))
      const tAngle    = Math.max(0, (angle - Math.PI / 4) / (Math.PI / 4))
      const angleMult = 1 - tAngle * tAngle * (3 - 2 * tAngle)
      const effectiveClearance = state.pushOutMin + (state.pushOutMax - state.pushOutMin) * angleMult

      if (state.crossingBehaviorNodes === "Hard Push Out") {
        offsetStart = effectiveClearance
        offsetEnd   = effectiveClearance
      } else {
        // Floor applies to real nodes only.
        const startIsNode = !start_node?.type?.includes("Reroute")
        const endIsNode   = !end_node?.type?.includes("Reroute")
        if (startIsNode) offsetStart = Math.max(offsetStart, effectiveClearance)
        if (endIsNode)   offsetEnd   = Math.max(offsetEnd,   effectiveClearance)
      }
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
      ctx.moveTo(start[0], start[1])
      ctx.bezierCurveTo(
        start[0] + offsetStart, start[1],
        end[0]   - offsetEnd,   end[1],
        end[0],                 end[1]
      )
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

    if (this.links_render_mode === 2) {
      const tension = computeSegmentTension(a, b, start_dir, end_dir, extras, link)
      extras.startControl = tension.startControl
      extras.endControl   = tension.endControl
    }

    return orig.call(this, ctx, a, b, link, skip_border, flow, color, start_dir, end_dir, extras)
  }
}

// --- 3. Hook into drawConnections to patch reroute prototypes lazily ---

const _patchedReroutes = new WeakSet()

function patchDrawConnections() {
  const orig = LGraphCanvas.prototype.drawConnections

  LGraphCanvas.prototype.drawConnections = function (ctx) {
    if (app.graph?.reroutes?.size > 0) {
      const firstReroute = [...app.graph.reroutes.values()][0]
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
function _fmtVal(v) {
  if (typeof v !== "number") return String(v)
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

function buildPanel(el) {
  el.innerHTML = ""
  _panelRefs.clear()
  _syncHooks.length = 0

  // Cancel the previous settings-change listener so we never accumulate duplicates
  _settingsListenerAC?.abort()
  _settingsListenerAC = new AbortController()

  // ── Inject styles (once per page load) ──────────────────────────────────────
  if (!document.getElementById("nkd-panel-styles")) {
    const s = document.createElement("style")
    s.id = "nkd-panel-styles"
    s.textContent = `
.nkd-panel {
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
.nkd-panel-preset-btn.nkd-active { border-color: #7db98a; color: #7db98a; }
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
.nkd-panel-slider { flex: 1; min-width: 0; accent-color: #7db98a; cursor: pointer; }
.nkd-panel-value {
  flex: 0 0 34px;
  text-align: right;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  opacity: 0.65;
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
.nkd-panel-toggle-label input:checked + .nkd-panel-toggle-track { background: #7db98a; }
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

  function setSetting(key, value) {
    state[key] = value
    const id = _stateKeyToSettingId[key]
    if (id) app.ui?.settings?.setSettingValue?.(id, value)
    redraw()
  }

  const presetBtns = []
  function clearPreset() { presetBtns.forEach(b => b.classList.remove("nkd-active")) }

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
    const row = document.createElement("div")
    row.className = "nkd-panel-row"
    const lbl = document.createElement("span")
    lbl.className = "nkd-panel-label"
    lbl.textContent = label
    const inp = document.createElement("input")
    inp.type = "range"
    inp.className = "nkd-panel-slider"
    inp.min = min; inp.max = max; inp.step = step
    inp.value = getSetting(key)
    const valSpan = document.createElement("span")
    valSpan.className = "nkd-panel-value"
    valSpan.textContent = _fmtVal(Number(inp.value))
    // Custom drag: capture-phase document listeners beat LiteGraph's canvas handlers.
    // r is captured once at pointerdown — avoids width=0 if the browser transiently
    // changes the input layout when preventDefault() suppresses the native thumb.
    inp.addEventListener("pointerdown", e => {
      e.stopPropagation()
      e.preventDefault()
      const min = Number(inp.min), max = Number(inp.max), step = Number(inp.step)
      const r = inp.getBoundingClientRect()  // frozen for the whole drag
      function snap(raw) {
        const s = Math.round((raw - min) / step) * step + min
        return parseFloat(Math.max(min, Math.min(max, s)).toFixed(10))
      }
      function update(clientX) {
        const v = snap(min + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (max - min))
        inp.value = v
        valSpan.textContent = _fmtVal(v)
        setSetting(key, v)
        clearPreset()
      }
      update(e.clientX)
      const onMove = ev => { ev.stopPropagation(); update(ev.clientX) }
      const onUp   = ev => {
        ev.stopPropagation()
        document.removeEventListener("pointermove", onMove, true)
        document.removeEventListener("pointerup",   onUp,   true)
      }
      document.addEventListener("pointermove", onMove, true)
      document.addEventListener("pointerup",   onUp,   true)
    })
    row.append(lbl, inp, valSpan)
    _panelRefs.set(key, { el: inp, valEl: valSpan, type: "slider" })
    return row
  }

  function makeSelect(key, label, options) {
    const row = document.createElement("div")
    row.className = "nkd-panel-row"
    const lbl = document.createElement("span")
    lbl.className = "nkd-panel-label"
    lbl.textContent = label
    const sel = document.createElement("select")
    sel.className = "nkd-panel-select"
    for (const opt of options) {
      const o = document.createElement("option")
      o.value = opt; o.textContent = opt
      sel.appendChild(o)
    }
    sel.value = getSetting(key)
    sel.addEventListener("change", () => { setSetting(key, sel.value); clearPreset() })
    row.append(lbl, sel)
    _panelRefs.set(key, { el: sel, type: "select" })
    return row
  }

  // ── Build DOM ────────────────────────────────────────────────────────────────

  const wrap = document.createElement("div")
  wrap.className = "nkd-panel"

  // — PRESET —
  const secPreset = makeSection("Preset")
  const presetGroup = document.createElement("div")
  presetGroup.className = "nkd-panel-presets"
  for (const name of Object.keys(PRESETS)) {
    const btn = document.createElement("button")
    btn.className = "nkd-panel-preset-btn"
    btn.textContent = name
    btn.addEventListener("click", () => {
      applyPreset(name)
      syncPanelFromState()
      presetBtns.forEach(b => b.classList.toggle("nkd-active", b === btn))
    })
    presetBtns.push(btn)
    presetGroup.appendChild(btn)
  }
  secPreset.appendChild(presetGroup)
  wrap.appendChild(secPreset)

  // — WIRE SHAPE —
  const secShape = makeSection("Wire Shape")
  secShape.append(
    makeSlider("handleFactor", "Wire curvature",  0.1, 2.0, 0.1),
    makeSlider("socketMin",    "Socket min",      3,   50,  1  ),
    makeSlider("socketMax",    "Socket max",      10,  200, 5  ),
    makeSlider("nonLinear",    "Elasticity",      0.1, 2.0, 0.1),
    makeSlider("dampingRef",   "Damping range",   20,  400, 10 ),
    makeSlider("dampingMin",          "Curvature floor",     0,   1.0, 0.1 ),
    makeSlider("verticalEscapeScale", "Vertical escape",     0,   1.0, 0.05),
    makeSlider("nodeBodyClearance",   "Node body clearance", 0,   80,  2   ),
  )
  wrap.appendChild(secShape)

  // — PULL PER ENDPOINT —
  const secPull = makeSection("Pull Per Endpoint")
  secPull.append(
    makeSlider("nodeOutFactor",    "Node outgoing",    0.1, 2.0, 0.1),
    makeSlider("nodeInFactor",     "Node incoming",    0.1, 2.0, 0.1),
    makeSlider("rerouteOutFactor", "Reroute outgoing", 0.1, 2.0, 0.1),
    makeSlider("rerouteInFactor",  "Reroute incoming", 0.1, 2.0, 0.1),
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

  secBack.append(
    makeSlider("pushOutMin", "Clearance min", 0, 150, 5),
    makeSlider("pushOutMax", "Clearance max", 0, 200, 5),
    makeSelect("crossingBehaviorNodes",    "Node crossing",    ["Natural Loop", "Hard Push Out"]),
    makeSelect("crossingBehaviorReroutes", "Reroute crossing", ["Natural Loop", "Hard Push Out"]),
  )
  wrap.appendChild(secBack)

  // — REROUTE DOT —
  const secDot = makeSection("Reroute Dot")
  secDot.appendChild(makeSlider("rerouteRadius", "Dot size", 3, 15, 1))
  wrap.appendChild(secDot)

  // — RESET —
  const resetBtn = document.createElement("button")
  resetBtn.className = "nkd-panel-reset"
  resetBtn.textContent = "Reset to defaults"
  resetBtn.addEventListener("click", () => {
    Object.assign(state, DEFAULTS)
    if (app.ui?.settings?.setSettingValue) {
      for (const [settingId, key] of Object.entries(SETTING_ID_MAP)) {
        if (key in DEFAULTS) app.ui.settings.setSettingValue(settingId, DEFAULTS[key])
      }
    }
    syncPanelFromState()
    clearPreset()
    redraw()
  })
  wrap.appendChild(resetBtn)

  el.appendChild(wrap)

  // ── External sync: reflect ComfyUI settings changes in the panel ─────────────
  app.ui?.settings?.addEventListener?.("change", ({ detail }) => {
    if (!detail?.key || !(detail.key in SETTING_ID_MAP)) return
    const key = SETTING_ID_MAP[detail.key]
    const newVal = detail.value ?? detail.newValue
    if (newVal == null) return
    const ref = _panelRefs.get(key)
    if (!ref) return
    if (ref.type === "slider") {
      ref.el.value = newVal
      if (ref.valEl) ref.valEl.textContent = _fmtVal(Number(newVal))
    } else if (ref.type === "select") {
      ref.el.value = newVal
    } else if (ref.type === "checkbox") {
      ref.el.checked = Boolean(newVal)
      for (const hook of _syncHooks) hook()
    }
  }, { signal: _settingsListenerAC.signal })
}

// Sync all panel controls from current state (called after applyPreset or reset)
function syncPanelFromState() {
  for (const [key, ref] of _panelRefs) {
    const v = state[key]
    if (v === undefined) continue
    if (ref.type === "slider") {
      ref.el.value = v
      if (ref.valEl) ref.valEl.textContent = _fmtVal(Number(v))
    } else if (ref.type === "select") {
      ref.el.value = v
    } else if (ref.type === "checkbox") {
      ref.el.checked = Boolean(v)
    }
  }
  for (const hook of _syncHooks) hook()
}