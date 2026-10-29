# ComfyUI-NKD-Reroutes

Wires and layout for ComfyUI. Two ways to draw your connections — smooth Bézier curves in the
spirit of Blender's node editor, or right-angled PCB traces that go around your nodes — plus a
magnet that lines nodes up while you drag them.

Everything is adjustable from the **NKD Wires** sidebar tab, live, while you look at your graph.

### Result
https://github.com/user-attachments/assets/a9bb4de0-be9e-44e1-ad20-349902a6c362

### Inspiration
https://github.com/user-attachments/assets/18210fcb-15b7-4476-8a25-f4862efe3186

---

## Installation

1. Clone or copy this folder into your `ComfyUI/custom_nodes/` directory.
2. Restart ComfyUI.
3. Open the **NKD Wires** sidebar tab, or **Settings → NKD Reroutes**.

Works with the classic canvas and with **Nodes 2.0**.

---

## Wire styles

### Simple and Advanced

**Simple** only restyles the wires that touch a reroute dot; everything else keeps ComfyUI's
normal look. **Advanced** hands every wire to this extension and unlocks the controls below.

### Presets

**Classic Comfy** ships as a reference — it is exactly what your wires look like without this
extension installed, so you can always flip back and compare.

Any look you like, you save yourself: tune the sliders, hit **+ Save current settings** and name
it. Right-click a preset to delete it. Your presets travel with your ComfyUI profile, so they are
there in every tab and survive a browser change. They store the curve shape only — not the reroute
dot size, not the mode, not the magnet.

### Curve controls

| Setting | Range | Default | What it does |
|---|---|---|---|
| Wire curvature | 0.1 – 2.0 | 1.0 | Overall roundness. Low is almost straight, high is wide and sweeping. |
| Elasticity | 0.1 – 2.0 | 1.15 | How different short and long wires look. Above 1, long wires open up while short ones stay tight. |
| Distance stretch | 0 – 2.0 | 0.25 | Grows every curve in proportion to how far apart the nodes are. This is what makes long wires look stretched instead of flat. |
| Minimum handle | 0 – 60 px | 10 | Floor for every curve. Too high and every wire ends up the same shape whatever its length. |
| Handle ceiling | 0 – 1.5 | 0.5 | Caps each curve to this fraction of the horizontal gap. Raise it and short, steep wires start doubling back on themselves into an S. |
| Node body clearance | 0 – 80 px | 24 | Keeps some curve when two nodes sit almost on top of each other, so the wire does not vanish into an edge. |
| Socket stub | 0 – 60 px | 0 | Length of a straight tail leaving the socket before the curve starts. Reroute dots are left alone, so a chain still reads as one run. |
| Node pull | 0.1 – 2.0 | 1.0 | Extra roundness at the ends touching a node socket. |
| Reroute pull | 0.1 – 2.0 | 0.8 | The same, for ends touching a reroute dot. Below Node pull keeps chains of reroutes tight. |
| Invert on backward | on/off | on | When a wire has to travel backwards, curl it into a C loop instead of cutting across the nodes. |
| Inversion pull | 10 – 150 px | 40 | How wide that C loop is, regardless of distance. |
| Backward stretch | 0 – 1.0 | 0.25 | How much the backward loop grows with distance. |
| Crossing width | 0 – 300 px | 120 | How much travel the forward-to-backward transition is spread over. Small values make the loop pop in abruptly. |

### Reroute dot

| Setting | Range | Default | What it does |
|---|---|---|---|
| Dot size | 3 – 15 px | 5 | How big the dot looks. Never goes below 3 so it stays easy to click, and the hitbox stays generous whatever the size. |
| Handle offset | 10 – 120 px | 40 | Simple mode only: how far the curve reaches out of a reroute dot. |

---

## PCB routing

Flip **PCB routing** on and wires stop curving over your nodes: they run in right angles and go
*around* them, like traces on a circuit board.

It replaces the curve engine entirely while it is on — the curve controls above stop applying —
and it works on the classic canvas and on Nodes 2.0. Clicking a wire and its centre marker follow
the trace, and dragging a node previews exactly what you get when you drop it.

What it does on its own, without any setting:

- Wires leaving the same side of a node **fan out into their own lanes** instead of stacking.
- Wires running between the same two nodes travel together as a **ribbon**, in parallel, never
  crossing each other.
- Unrelated wires that end up sharing a corridor are **spread apart** so they do not draw on top
  of one another.

| Setting | Range | Default | What it does |
|---|---|---|---|
| Corner radius | 0 – 30 px | 8 | How rounded the corners are. 0 for sharp. Tight zig-zags stay clean whatever you set it to. |
| Node avoidance | 1 – 20 | 8 | How hard a wire tries to go around a node instead of under it. At 1 wires ignore nodes and run straight through, which dense graphs often prefer. Turn it up and wires keep clear, but they zig-zag more to do it. |
| Ignore nodes under | 0 – 100 px | 40 | Nodes shorter than this stop pushing wires around. Set/Get pills, collapsed nodes and other small helpers can then sit anywhere — beside a node, behind one — without sending every wire on a detour. 0 makes every node count. |
| Spread shared lanes | on/off | on | The corridor spreading described above. Turn it off to keep every wire exactly where the routing put it. |

Small helper nodes are also **entered from whichever side the wire arrives on**, instead of
wrapping all the way around to come in from the left. A Set node placed to the left of its source
used to cost the wire a full lap.

---

## Node magnetism

Hold **Shift** while dragging and nodes line themselves up against their neighbours.

The node itself keeps following your mouse — what snaps is a translucent **ghost** showing
where it will land, plus dashed guides on whatever it is lining up against. The move is
applied when you release. That way the node never covers the very reference you are aiming
at, and nothing fights your cursor.

Six behaviours, resolved per axis:

| | Behaviour |
|---|---|
| **Column** | Shares the left edge and stacks below with a small gap. |
| **Row** | Shares the top edge and abuts to the right with a larger gap. |
| **Straight cable** | Leaves that stretch of wire running dead straight. Against another node or against a reroute, Set/Get pills included. |
| **Gap fill** | Dropped between two stacked nodes, it centres itself in the gap. |
| **Column width** | Snapping into a column also adopts that column's width. Only ever widens: a node is never squeezed below the minimum its widgets need. |
| **Reroutes** | A reroute squares its Y against the ends of its own cable, and aligns with other reroutes. |

When two rules compete on the same axis, a straight cable wins over filling a gap, and both
win over aligning an edge. Ties inside a tier go to whichever is nearest.

Groups play by the same rules among themselves, and resizing a group or a node from its corner
snaps that edge against the neighbours too. Each kind only snaps to its own: nodes to nodes,
groups to groups.

Nodes with **Pin** enabled neither move nor act as references. Dragging a multi-selection
snaps the bounding box and moves everything together. Releasing Shift mid-drag backs out.

Far from any neighbour, Shift still gives you ComfyUI's usual snap-to-grid — the magnet
simply takes over when there is something to align against.

| Setting | Range | Default | What it does |
|---|---|---|---|
| Snap with Shift | on/off | on | The magnet itself. |
| Magnet radius | 5 – 60 px | 20 | How close a neighbour has to be before the magnet grabs. Larger reaches further but jumps harder when it lets go. |
| Magnet vertical gap | 0 – 60 px | 12 | Gap left when stacking below another node in the same column. |
| Magnet horizontal gap | 0 – 120 px | 36 | Gap left when abutting beside another node in the same row. |
| Show guides | on/off | on | The destination ghost and the reference lines. |
| Match column width | on/off | on | Whether snapping into a column also adopts its width. |

---

## Nodes

| Setting | Default | What it does |
|---|---|---|
| Collapse keeps wires | on | Collapsing a node normally yanks its wires upwards, because a collapsed node is just its title bar. This shifts the node so its first socket stays exactly where it was, and puts it back when you expand it again. **Classic canvas only.** |

Switching from Nodes 2.0 back to the classic renderer also trims every node back to its minimum
height, which removes the empty band the Vue layout leaves behind.

---

## Using the sidebar sliders

Every slider in the **NKD Wires** tab can be set three ways:

- **Drag** for a smooth sweep — useful to find the look you want by eye.
- **Shift + drag** to snap to round values, scaled to that slider's own units:
  curvature lands on 0.1 / 0.2, a pixel distance on 10 / 20.
- **Click the number** and type an exact value. Enter confirms, Escape cancels.

Every setting also appears under **NKD Reroutes** in the ComfyUI Settings panel.

---

## Credits

The orthogonal routing engine behind PCB mode comes from
[comfyui-cable-management](https://github.com/vtokic/comfyui-cable-management) by Vedran Aberle
Tokić, used under the MIT licence. Go and have a look at it — it does a great deal more with the
idea than this extension does.

## License

GPL-3.0. See [LICENSE](LICENSE).
