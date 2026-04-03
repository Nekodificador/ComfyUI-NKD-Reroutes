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
  pushOutBase:              30,
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
    pushOutBase:              60,
    rerouteRadius:            4,
  },
  "Flowy & Organic": {
    handleFactor:             0.7,
    nodeOutFactor:            1.2,
    nodeInFactor:             1.2,
    rerouteOutFactor:         1.3,
    rerouteInFactor:          1.3,
    crossingBehaviorNodes:    "Natural Loop",
    crossingBehaviorReroutes: "Natural Loop",
    pushOutBase:              80,
    rerouteRadius:            6,
  },
  "Straight Business": {
    handleFactor:             0.2,
    nodeOutFactor:            0.5,
    nodeInFactor:             0.5,
    rerouteOutFactor:         0.5,
    rerouteInFactor:          0.5,
    crossingBehaviorNodes:    "Hard Push Out",
    crossingBehaviorReroutes: "Hard Push Out",
    pushOutBase:              40,
    rerouteRadius:            3,
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
  "NKD Reroutes.BackwardWireClearance":  "pushOutBase",
  "NKD Reroutes.RerouteDotSize":         "rerouteRadius",
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

app.registerExtension({
  name: "NKD Reroutes",
  setup() {
    registerSettings()
    patchLiteGraph()
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
    { id: "BackwardWireClearance",key:"pushOutBase",     label: "Backward Wire Clearance",  tip: "When 'Hard Push Out' is active, this is the fixed horizontal distance (px) wires are pushed out to avoid clipping.", min: 20, max: 200, step: 10 },
    { id: "RerouteDotSize",      key: "rerouteRadius",  label: "Reroute Dot Size",         tip: "Visual radius of the reroute dot in pixels. Minimum 3 to stay clickable.",                   min: 3, max: 15, step: 1 },
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
  const dist = Math.sqrt(dx * dx + dy * dy)

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

  // --- Base tension × per-endpoint multiplier ---
  const baseTension  = dist * state.handleFactor
  const outMultiplier = startIsReroute ? state.rerouteOutFactor : state.nodeOutFactor
  const inMultiplier  = endIsReroute   ? state.rerouteInFactor  : state.nodeInFactor

  let offsetStart = baseTension * outMultiplier
  let offsetEnd   = baseTension * inMultiplier

  // --- Crossing behavior ---
  const startCrossing = startIsReroute ? state.crossingBehaviorReroutes : state.crossingBehaviorNodes
  const endCrossing   = endIsReroute   ? state.crossingBehaviorReroutes : state.crossingBehaviorNodes

  let applyDampingStart = true
  let applyDampingEnd   = true

  if (startCrossing === "Hard Push Out") {
    offsetStart = state.pushOutBase
    applyDampingStart = false
  }
  if (endCrossing === "Hard Push Out") {
    offsetEnd = state.pushOutBase
    applyDampingEnd = false
  }

  // --- Backward horizontal crossing: invert direction for organic "C" loop ---
  if (dx < 0) {
    if (startCrossing !== "Hard Push Out") startSignX *= -1
    if (endCrossing   !== "Hard Push Out") endSignX   *= -1
  }

  // --- Clamp offsets ---
  offsetStart = Math.min(state.maxSplineOffset, Math.max(state.minSplineOffset, offsetStart))
  offsetEnd   = Math.min(state.maxSplineOffset, Math.max(state.minSplineOffset, offsetEnd))

  // --- Verticality damping (smoothstep) ---
  // When dx → 0, collapse tension so the wire drops nearly vertical.
  const t = Math.min(1, Math.abs(dx) / 100)
  const smoothDamping = t * t * (3 - 2 * t)

  if (applyDampingStart) offsetStart *= smoothDamping
  if (applyDampingEnd)   offsetEnd   *= smoothDamping

  return {
    startControl: [offsetStart * startSignX, 0],
    endControl:   [offsetEnd   * endSignX,   0],
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

    const dx   = end[0] - start[0]
    const dist = Math.sqrt(dx * dx + (end[1] - start[1]) ** 2)

    let offsetStart = Math.min(state.maxSplineOffset, Math.max(state.minSplineOffset, dist * state.handleFactor))
    let offsetEnd   = offsetStart

    if (dx < 0 && state.crossingBehaviorNodes === "Hard Push Out") {
      offsetStart = state.pushOutBase
      offsetEnd   = state.pushOutBase
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