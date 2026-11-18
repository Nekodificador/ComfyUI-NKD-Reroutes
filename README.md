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
| Reroute U-turn | 0.2 – 2.0 | 1.0 | How round the turn is when a wire doubles back at a reroute dot. 1 is a half circle; lower is a tighter hairpin, higher a wider swing. |

**Stack connectors.** Two nodes stacked one above the other and almost touching, like a column
of LoRA loaders, are no longer joined by a wire that leaves one side and loops round to the other.
By default the gap between them is filled with the wire's colour, so the pair reads as one welded
block. Turn off **Weld stacked nodes** to get a highlight on each facing edge and a short link
through the gap instead. The two sockets get a thin ring so you can still see which output feeds
which input. It works with curved wires and with PCB routing, and only the drawing changes. Turn
it all off with **Stack connectors** in the sidebar; **Stack gap** (0 to 80 px, default 30) sets how
close the nodes have to be.

A reroute dot is a waypoint, not a socket: the wire crosses it in the direction it is travelling.
When the path heads back to the left, the dot faces left too, so the wire turns around in one
smooth curve instead of making a sharp point at the dot.

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
groups to groups. Groups can be resized from any of their four corners, not just the bottom-right
one, and the opposite side stays put.

**Check readability**, in the canvas right-click menu and the command palette, lists what makes
the workflow hard to read without moving anything: overlapping nodes, wires that run backwards, a
node sitting under one that grows when it runs, and wires hidden behind a node. Click an entry to
jump to it.

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

## Reroute bus

Gathers several wires into one bar they run through side by side, like the lanes of a circuit
board. The wires don't need to share a type or a source. Turn it on with **Reroute bus** in the
Nodes section of the sidebar (or in Settings); it's off by default.

- Hold **Ctrl+Alt** and drag a line across wires on empty canvas. The wires you cut join a new bus.
- Drag a bar at the height of a wire to move just that wire. Drop it on another slot of the bar to
  reorder the lanes, or away from the bar to take it out (it stays as a normal reroute).
- Drag a loose reroute onto a bar to add its wire to the bus, in the slot where you drop it.
- Cut across a bar the same way to take the nearest wire out and remove its reroute.
- Grab a bar by its ends (above the first wire or below the last) to move the whole bus. **Delete**
  removes it and the wires go straight again.
- Cut wires that already run through a bus, further along, to branch off a second one.
- One Ctrl+Z undoes any of these.

A bus is built from normal reroutes, one per wire. Someone who opens your workflow without this
extension sees a tidy column of reroute dots and everything still runs.

| Setting | Range | Default | What it does |
|---|---|---|---|
| Bus lane gap | 6 – 40 px | 20 | Space between the wires of a new bus. At 20 or more the dots stay readable for people without the extension. Existing buses keep their spacing. |

---

## Nodes

| Setting | Default | What it does |
|---|---|---|
| Collapse keeps wires | on | Collapsing a node normally yanks its wires upwards, because a collapsed node is just its title bar. This shifts the node so its first socket stays exactly where it was, and puts it back when you expand it again. **Classic canvas only.** |

Switching from Nodes 2.0 back to the classic renderer also trims every node back to its minimum
height, which removes the empty band the Vue layout leaves behind.

---

## Workflow image

Export the whole workflow as an image with the workflow embedded: drop the file onto any ComfyUI
(no extension needed) and the graph loads.

Find it in **Workflow → Workflow Image (NKD)** in the top menu, in the command palette, or by
right-clicking the canvas. **Export…** opens a dialog with a live preview:

- **Format**: WebP (roughly half the size of PNG, light enough for a README or a web page) or PNG,
  for sites that don't take WebP. The workflow is embedded in both.
- **Embed workflow**: on or off.
- **Background**: the theme's (with the grid), transparent, or a solid colour.
- **Padding** around the workflow, and under *Advanced* a **max long edge**: bigger workflows are
  scaled down to fit.
- **Only selection** appears when nodes are selected. The image shows just those nodes, and the
  embedded workflow holds just them. Select a subgraph node and you get it on its own with its
  widgets; dropping the image onto ComfyUI brings the subgraph back, ready to use.
- **Footer**: adds a strip under the image with your logo and a line of text, so a picture you
  post carries your branding without covering any node. The text can use `{title}` (the workflow
  name) and `{date}`. The logo and text are remembered; Reset keeps them.
- **Show the rest** (with Only selection): keeps the rest of the workflow in the picture, faded to
  the opacity you pick, so the selection stands out in context. At 0 it is left out.

The dialog remembers what you used last; **Export with last settings** skips it. Works with the
classic canvas and with Nodes 2.0, and each one is exported with its own look. A Nodes 2.0 export
takes a few seconds, because the nodes are rendered from the page itself.

The workflow survives wherever the original file is served, such as a file committed to a GitHub
repo or attached to a release. Sites that re-compress images strip it. Small images are drawn at
least 1280 px on the long side and padded to at least 960 px on the short side, because Discord
drops the workflow from small pictures, such as a single subgraph exported on its own.

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

The workflow image export is a rework of "Workflow Image" from
[ComfyUI-Custom-Scripts](https://github.com/pythongosssss/ComfyUI-Custom-Scripts) by pythongosssss
(MIT). Nodes 2.0 exports are rendered with
[html-to-image](https://github.com/bubkoo/html-to-image) by W.Y. (MIT), bundled unmodified in
`js/vendor/`.

## License

GPL-3.0. See [LICENSE](LICENSE).
