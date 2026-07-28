import { app } from "../../../scripts/app.js"
import { computeSnap } from "./computeSnap.js"
import { collectSnapTargets, isReroute, rectOf, unionRect } from "./snapTargets.js"

// Estado del arrastre en curso. El índice de candidatos se construye una sola
// vez, en el primer frame en que el imán está activo, y se tira al soltar.
const session = {
  active:  false,
  graph:   null,
  targets: null,
  nodes:   [],
  result:  null,
  // Corrección que aplicó el imán en el frame anterior. Se resta para recuperar
  // la posición libre del ratón; sin ella el nodo se queda pegado al enganche.
  applied: { x: 0, y: 0 },
}

let _reentry = false

// El ancho se aplica al soltar, no por frame: así el movimiento y el
// redimensionado caen en la misma transacción y un solo Ctrl+Z revierte ambos.
function commitWidth(state) {
  const width = session.result?.width
  if (!state.magnetMatchWidth || width == null) return

  for (const n of session.nodes) {
    if (isReroute(n) || n.flags?.collapsed) continue   // un reroute no tiene ancho
    const min = n.computeSize?.()?.[0] ?? 0
    if (width < min) continue          // nunca por debajo del mínimo del nodo
    n.setSize([width, n.size[1]])
  }
}

function endSession(state, commit) {
  try {
    if (session.active) {
      if (commit) commitWidth(state)
      session.graph?.afterChange()
    }
  } finally {
    // En finally a propósito: si commitWidth o afterChange fallan, la sesión
    // TIENE que quedar limpia igualmente. Si no, se queda activa para siempre
    // y todos los arrastres siguientes reutilizan un índice muerto.
    session.active = false
    session.graph = null
    session.targets = null
    session.nodes = []
    session.result = null
    session.applied = { x: 0, y: 0 }
  }
}

// Nodos Y reroutes: un reroute tiene `pos` pero no `size`, así que exigir size
// aquí era justamente lo que los dejaba fuera del imán.
function draggedItemsOf(canvas) {
  return [...(canvas.selectedItems || [])].filter(it => it && it.pos && !it.pinned)
}

// Mover. Los nodos van por setPos() —su setter sincroniza el layout store—;
// un reroute no tiene setPos y se escribe por su setter de `pos`.
function moveItem(item, dx, dy) {
  const x = item.pos[0] + dx
  const y = item.pos[1] + dy
  if (typeof item.setPos === "function") item.setPos(x, y)
  else item.pos = [x, y]
}

// Único punto de entrada al imán. Un fallo aquí no puede llevarse por delante
// el arrastre ni el repintado del canvas: se cierra la sesión —y con ella la
// transacción de undo— y se sigue. El usuario pierde el magnetismo, no el editor.
function runMagnetSafely(canvas, state) {
  if (_reentry) return
  _reentry = true
  try {
    applyMagnet(canvas, state)
  } catch (err) {
    console.error("[NKD Reroutes] fallo del imán, desactivado en este arrastre:", err)
    try { endSession(state, false) } catch { /* la sesión ya quedará inconsistente; no empeorarlo */ }
  } finally {
    _reentry = false
  }
}

// state: el objeto `state` vivo de rerouteSplines.js
export function installMagnet(state) {
  installDragListener(state)
  installGuideRenderer(state)
}

// El imán se engancha con un listener propio, NO parcheando el prototipo.
//
// Por qué: LiteGraph captura sus manejadores al construir el canvas
// —`this._mousemove_callback = this.processMouseMove.bind(this)`— y registra
// esa referencia en el listener. Un parche posterior sobre
// `LGraphCanvas.prototype.processMouseMove` no toca la referencia capturada, así
// que en un arrastre real no se ejecuta jamás. (Llamar a
// `canvas.processMouseMove(ev)` a mano sí resuelve por el prototipo: por eso el
// parche parecía funcionar en pruebas sintéticas y no hacía nada con el ratón.)
//
// Parchear el dibujado tampoco vale: tanto `drawFrontCanvas` como
// `onDrawForeground` los reasignan otros por INSTANCIA
// (`canvas.drawFrontCanvas = () => {...}`), y una asignación de instancia tapa
// el prototipo. Quién gana depende del orden de arranque.
//
// Un listener extra en el mismo elemento no lo tapa nadie: se encola detrás del
// de LiteGraph, así que corre justo después de que éste haya movido el nodo,
// que es exactamente lo que necesitamos. Y sirve igual para el renderizador
// clásico y para Nodes 2.0, porque ambos acaban escribiendo en `node.pos`.
function installDragListener(state) {
  const el = app.canvas?.canvas
  if (!el) return

  let shiftDown = false
  addEventListener("keydown", (e) => { if (e.key === "Shift") shiftDown = true }, true)
  addEventListener("keyup",   (e) => { if (e.key === "Shift") shiftDown = false }, true)

  const engaged = (c) => Boolean(state.magnetEnabled && shiftDown && c?.state?.draggingItems)

  el.addEventListener("pointermove", () => {
    const c = app.canvas
    if (engaged(c)) { runMagnetSafely(c, state); return }
    if (!session.active) return

    // Aquí SÓLO se cancela si el usuario se echa atrás a propósito: soltar Shift
    // o apagar el imán. Que el arrastre haya terminado no se resuelve aquí — de
    // eso se encarga el pointerup, que es quien confirma el ancho.
    //
    // Es un caso real, no teórico: al soltar el botón el ratón casi siempre se
    // mueve un poco, y ese pointermove residual llega con draggingItems ya en
    // false. Cerrando aquí, mataba la sesión antes de que el pointerup aplazado
    // pudiera aplicar el ancho — la alineación se veía y el ancho no.
    if (!state.magnetEnabled || !shiftDown) endSession(state, false)
  })

  // El cierre va en window y en fase de CAPTURA: un pointerup despachado sobre
  // el canvas no llega a los listeners del propio elemento —alguien lo para
  // antes de la fase target—, así que escuchar en `el` no sirve.
  //
  // Pero capturar significa correr ANTES que LiteGraph, que en su pointerup
  // aplica el snap a rejilla. Por eso el cierre se aplaza un tick: para entonces
  // LiteGraph ya ha terminado y una última pasada del imán sobrescribe la
  // rejilla, que es lo que queremos —cerca de un vecino manda el imán—.
  const finish = () => {
    if (!session.active) return
    setTimeout(() => {
      if (!session.active) return
      const c = app.canvas
      // Sin comprobar shiftDown a propósito. Si la sesión sigue viva es que el
      // usuario NO se echó atrás —soltar Shift la habría cerrado desde el
      // pointermove—, así que el imán tiene la última palabra. Comprobarlo aquí
      // era una carrera perdida: al soltar Shift junto con el botón, la tecla
      // suele llegar antes y el imán se saltaba la pasada final, dejando en pie
      // el cuantizado a rejilla de LiteGraph (10 px) y el nodo un par de píxeles
      // fuera de donde marcaba la silueta.
      if (state.magnetEnabled) runMagnetSafely(c, state)
      endSession(state, true)
      c?.setDirty(true, true)
    }, 0)
  }
  addEventListener("pointerup", finish, true)

  // Cierres de seguridad: la transacción de undo no puede quedarse abierta.
  addEventListener("pointercancel", () => { if (session.active) endSession(state, false) }, true)
  addEventListener("blur",          () => { if (session.active) endSession(state, false) })
}

function applyMagnet(canvas, state) {
  const nodes = draggedItemsOf(canvas)
  if (!nodes.length) { endSession(state, false); return }

  const dragRect = unionRect(nodes.map(rectOf))
  if (!dragRect) { endSession(state, false); return }

  // El índice se construye una vez por arrastre: los vecinos no se mueven.
  if (!session.active) {
    // La sesión se marca activa ANTES de recolectar. Si collectSnapTargets
    // fallara con el flag aún a false, endSession no cerraría la transacción
    // recién abierta y el siguiente frame volvería a abrir otra.
    session.graph  = canvas.graph
    session.nodes   = nodes
    session.active  = true
    session.applied = { x: 0, y: 0 }   // el primer frame aún no lleva corrección
    canvas.graph?.beforeChange()

    session.targets = collectSnapTargets(canvas.graph, canvas.selectedItems, dragRect, {
      gapX: state.magnetGapX,
      gapY: state.magnetGapY,
    })
  }

  // Posición libre: dónde estaría el nodo si el imán no existiera.
  //
  // LiteGraph suma el delta del ratón sobre la posición que dejamos corregida el
  // frame anterior, así que `dragRect` ya lleva nuestra corrección dentro.
  // Medir desde ahí es medir desde nosotros mismos: la distancia al punto de
  // enganche nunca crece por mucho que arrastres, y el nodo se queda pegado —
  // sólo escaparía moviendo más de `radius` px en un único frame.
  //
  // Restando la corrección anterior recuperamos el recorrido real del ratón, que
  // es lo que hace que el imán se sienta elástico: agarra dentro del radio y
  // suelta en cuanto de verdad te alejas.
  const free = {
    x: dragRect.x - session.applied.x,
    y: dragRect.y - session.applied.y,
    w: dragRect.w,
    h: dragRect.h,
  }

  const minWidth = Math.max(...nodes.map(n => (n.computeSize?.()?.[0]) ?? 0))
  const result = computeSnap(free, session.targets, {
    radius:     state.magnetRadius,
    matchWidth: Boolean(state.magnetMatchWidth),
    minWidth,
  })
  session.result = result

  // La silueta va donde caerá el nodo, con el ancho que tendrá al soltar.
  result.ghost = {
    x: free.x + result.dx,
    y: free.y + result.dy,
    w: result.width ?? free.w,
    h: free.h,
  }

  // Del sitio donde está ahora al sitio que le toca: libre + enganche.
  const moveX = (free.x + result.dx) - dragRect.x
  const moveY = (free.y + result.dy) - dragRect.y
  if (moveX || moveY) {
    for (const n of nodes) moveItem(n, moveX, moveY)
    canvas.setDirty(true, true)
  }
  session.applied = { x: result.dx, y: result.dy }
}

function installGuideRenderer(state) {
  // Sobre la INSTANCIA, no sobre el prototipo: el core asigna aquí por instancia
  // (`canvas.onDrawForeground = ...` para el borde de selección) y una asignación
  // de instancia tapa el prototipo. Enganchando en la instancia recogemos lo que
  // ya hubiera, y si alguien encadena después nos recogerá a nosotros.
  const canvas = app.canvas
  if (!canvas) return
  const prev = canvas.onDrawForeground ?? LGraphCanvas.prototype.onDrawForeground
  canvas.onDrawForeground = function (ctx, visibleArea) {
    prev?.call(this, ctx, visibleArea)
    if (!session.active || !state.magnetGuides || !session.result) return

    // Las guías y la silueta se dibujan por separado. Sólo los candidatos de
    // alineación llevan guía; los de adosado no. Un enganche que gane sólo por
    // apilado deja `guides` vacío y aun así mueve el nodo, así que salir aquí
    // dejaría ese caso sin ningún indicador.
    const { guides, ghost } = session.result
    if (!guides.length && !ghost) return

    ctx.save()

    if (guides.length) {
      ctx.setLineDash([6, 5])
      ctx.lineWidth = 1
      ctx.strokeStyle = "#FFFFFF66"
      ctx.beginPath()
      for (const g of guides) {
        ctx.moveTo(g.x1, g.y1)
        ctx.lineTo(g.x2, g.y2)
      }
      ctx.stroke()
    }

    // Silueta de destino. Se dibuja con el ancho final para que el cambio de
    // forma de la regla 5 se vea venir antes de soltar.
    if (ghost) {
      ctx.setLineDash([])
      ctx.lineWidth = 0.5
      ctx.strokeStyle = "#FFFFFF66"
      ctx.fillStyle = "#FFFFFF22"
      ctx.beginPath()
      ctx.rect(ghost.x, ghost.y, ghost.w, ghost.h)
      ctx.fill()
      ctx.stroke()
    }

    ctx.restore()
  }
}
