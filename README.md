# ComfyUI-NKD-Reroutes

A ComfyUI extension that changes how reroute nodes are visually rendered, making them behave more similarly to Blender's node editor. Wire tension is fully controlled by this extension, giving you smooth, customizable Bézier curves instead of the default style.

Several configuration parameters are available in the **Settings** panel so each user can adapt the look to their preference. Presets with pre-configured parameters are also included for quick setup.

### Result
https://github.com/user-attachments/assets/a9bb4de0-be9e-44e1-ad20-349902a6c362

### Inspiration
https://github.com/user-attachments/assets/18210fcb-15b7-4476-8a25-f4862efe3186


---

## Installation

1. Clone or copy this folder into your `ComfyUI/custom_nodes/` directory.
2. Restart ComfyUI.
3. Open **Settings → NKD Reroutes** to configure.

---

## Settings Reference

All settings are found under the **NKD Reroutes** section in the ComfyUI Settings panel.

### Wire Style Preset

| Option | Description |
|---|---|
| `Custom` | No preset applied — individual sliders control everything. |
| `Clean & Tight` | Short, controlled curves with hard pushouts on backwards wires. Good for dense graphs. |
| `Flowy & Organic` | Long, sweeping curves with natural loops. Good for spacious, artistic graphs. |
| `Straight Business` | Minimal curvature, almost straight wires. Maximum readability. |

Choosing a preset automatically updates all sliders and combos below. You can then fine-tune any individual value without losing the preset as a starting point — the selector will simply show `Custom`.

---

### Curvature Sliders

#### Wire Curvature
**Range:** 0.1 – 2.0 &nbsp;|&nbsp; **Default:** 0.5

The global curvature multiplier for all wires. Controls how rounded the Bézier arcs are between any two connected points. Higher values produce rounder, more exaggerated curves; lower values make wires approach straight lines.

---

#### Node Outgoing Pull
**Range:** 0.1 – 2.0 &nbsp;|&nbsp; **Default:** 0.5

An additional curvature multiplier applied specifically to the handle on the **output** side of a regular node. Increasing this pulls the wire further outward as it leaves the node's socket, making the departure angle more pronounced.

---

#### Node Incoming Pull
**Range:** 0.1 – 2.0 &nbsp;|&nbsp; **Default:** 0.5

Same as Node Outgoing Pull, but applied to the **input** side of a regular node. Controls how strongly the wire bends as it arrives at an input socket.

---

#### Reroute Outgoing Pull
**Range:** 0.1 – 2.0 &nbsp;|&nbsp; **Default:** 0.5

Extra curvature multiplier for wires **leaving** a reroute dot. Independent from node pull values, so reroutes can have a different wire feel than direct node-to-node connections.

---

#### Reroute Incoming Pull
**Range:** 0.1 – 2.0 &nbsp;|&nbsp; **Default:** 0.5

Extra curvature multiplier for wires **arriving** at a reroute dot.

---

#### Backward Wire Clearance
**Range:** 20 – 200 px &nbsp;|&nbsp; **Default:** 30

Only active when the crossing behavior is set to **Hard Push Out**. Defines the fixed horizontal distance (in pixels) that a backwards-going wire is pushed sideways to prevent it from clipping through the source node. Higher values create a more visible detour; lower values keep the wire closer.

---

#### Reroute Dot Size
**Range:** 3 – 15 px &nbsp;|&nbsp; **Default:** 5

The visual radius of the reroute dot on the canvas. The minimum value is enforced at 3 px to keep the dot always clickable — the hitbox is also kept generous regardless of visual size. When the dot is smaller than 5 px, a subtle ghost ring is drawn around it on hover to help locate it.

---

### Crossing Behavior

These two settings control what happens when a wire travels **backwards** (right to left) — a situation that normally causes wires to overlap or cross through nodes.

#### Node Backward Crossing

| Option | Description |
|---|---|
| `Natural Loop` | The wire arcs freely in a C-shaped loop. Looks organic but may overlap other elements. |
| `Hard Push Out` | The wire is pushed a fixed distance horizontally (set by **Backward Wire Clearance**) to route around the source node. Cleaner but more rigid. |

---

#### Reroute Backward Crossing

Same behavior options as **Node Backward Crossing**, but applied independently to wires going backwards from a **reroute dot**. This lets you mix styles — for example, natural loops on node wires while reroutes stay rigid.

---

## Preset Details

| Setting | Clean & Tight | Flowy & Organic | Straight Business |
|---|---|---|---|
| Wire Curvature | 0.35 | 0.70 | 0.20 |
| Node Outgoing Pull | 0.80 | 1.20 | 0.50 |
| Node Incoming Pull | 0.80 | 1.20 | 0.50 |
| Reroute Outgoing Pull | 0.80 | 1.30 | 0.50 |
| Reroute Incoming Pull | 0.80 | 1.30 | 0.50 |
| Node Backward Crossing | Hard Push Out | Natural Loop | Hard Push Out |
| Reroute Backward Crossing | Hard Push Out | Natural Loop | Hard Push Out |
| Backward Wire Clearance | 60 px | 80 px | 40 px |
| Reroute Dot Size | 4 px | 6 px | 3 px |
