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
  // Origen del arrastre. La posición libre se reconstruye desde aquí con el
  // recorrido del puntero, en vez de inferirla de dónde está ahora el nodo.
  originRect:    null,
  originPointer: null,
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
    session.originRect = null
    session.originPointer = null
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
function runMagnetSafely(canvas, state, move = true) {
  if (_reentry) return
  _reentry = true
  try {
    applyMagnet(canvas, state, move)
  } catch (err) {
    console.error("[NKD Reroutes] fallo del imán, desactivado en este arrastre:", err)
    try { endSession(state, false) } catch { /* la sesión ya quedará inconsistente; no empeorarlo */ }
  } finally {
    _reentry = false
  }
}

// Estado de teclado y puntero, compartido por los dos enganches.
let _shiftDown = false
let _pointerDown = false
let _pointer = { x: 0, y: 0 }
let _rectAtDown = null       // rectángulo de la selección al empezar a pulsar
let _dragConfirmed = false   // ¿se ha movido de verdad, o sólo hay un clic?
let _inputBound = false
let _state = null            // el `state` vivo, para poder cerrar sesión desde los listeners

function trackInput() {
  if (_inputBound) return
  _inputBound = true
  addEventListener("keydown", (e) => { if (e.key === "Shift") _shiftDown = true }, true)
  addEventListener("keyup",   (e) => { if (e.key === "Shift") _shiftDown = false }, true)
  // El puntero se rastrea siempre: es de donde sale la posición libre.
  addEventListener("pointermove", (e) => { _pointer = { x: e.clientX, y: e.clientY } }, true)
  addEventListener("pointerdown", (e) => {
    _pointer = { x: e.clientX, y: e.clientY }
    _pointerDown = true
    _rectAtDown = null
    _dragConfirmed = false
    // El cierre del arrastre anterior va aplazado un tick. Si empieza otro antes
    // de que corra, heredaría su origen y la posición libre saldría disparatada.
    if (session.active && _state) endSession(_state, false)
  }, true)
  addEventListener("pointerup",     () => { _pointerDown = false }, true)
  addEventListener("pointercancel", () => { _pointerDown = false }, true)
}

// Si hay arrastre se decide mirando los DATOS, no una bandera del renderizador.
//
// `canvas.state.draggingItems` sólo lo marca el renderizador clásico: la ruta Vue
// de Nodes 2.0 monta su propio estado en startDrag y no lo toca, así que
// comprobarlo dejaba el imán muerto con Nodes 2.0. (Y en una prueba sintética no
// se nota, porque la bandera la pone uno a mano.)
//
// Lo que sí es igual en ambos: si la selección ha cambiado de sitio con el botón
// pulsado, es un arrastre. Y como se exige movimiento real, ni el paneo ni la
// selección por caja —que no mueven nada— llegan a activarlo.
function shouldEngage(canvas, state) {
  if (!state.magnetEnabled || !_shiftDown || !_pointerDown) return false

  const items = draggedItemsOf(canvas)
  if (!items.length) return false
  const rect = unionRect(items.map(rectOf))
  if (!rect) return false

  if (_dragConfirmed) return true
  if (!_rectAtDown) { _rectAtDown = rect; return false }
  if (Math.abs(rect.x - _rectAtDown.x) > 0.01 || Math.abs(rect.y - _rectAtDown.y) > 0.01) {
    _dragConfirmed = true
    return true
  }
  return false
}

// Sólo se cancela si el usuario se echa atrás a propósito: soltar Shift o apagar
// el imán. Que el arrastre haya terminado NO se resuelve aquí — de eso se encarga
// el pointerup, que es quien confirma el ancho.
const cancelledMidDrag = (state) =>
  session.active && (!state.magnetEnabled || !_shiftDown)

// Con Nodes 2.0 NO se mueve durante el arrastre, sólo al soltar.
//
// Los dos escribimos en el mismo layout store en cada frame: el store de Vue
// reafirma la posición libre (`batchMoveNodes` con setSource(Vue)) y nuestro
// setPos escribe la corregida (setSource(Canvas)). Gana quien escriba último en
// ese frame, así que el nodo parpadea entre las dos posiciones — y empeora al
// mover el ratón, porque cada pointermove programa una escritura suya. Es una
// carrera que no se puede ganar desde fuera.
//
// Así que ahí el imán calcula en vivo —la silueta y las guías se ven igual— pero
// aplica el movimiento al soltar, cuando ya no hay nadie con quien pelearse. El
// renderizador clásico sí se imanta en vivo: aplica deltas y no reafirma nada.
const liveSnapping = () =>
  !app?.ui?.settings?.getSettingValue?.("Comfy.VueNodes.Enabled")

// state: el objeto `state` vivo de rerouteSplines.js
export function installMagnet(state) {
  _state = state
  trackInput()
  installDragListener(state)   // renderizador clásico
  installFrameHook(state)      // Nodes 2.0
  installGuideRenderer(state)
}

// Con Nodes 2.0 los nodos son elementos DOM y el arrastre lo lleva una ruta Vue
// propia: el pointermove ni siquiera pasa por el canvas, y las posiciones se
// escriben dentro de un requestAnimationFrame, no en el manejador del puntero.
// Engancharse al puntero no sirve ahí ni moviendo el listener; hace falta un
// punto por frame, con las posiciones ya actualizadas.
//
// Sobre la INSTANCIA, no el prototipo: hay componentes del frontend que
// reasignan `canvas.drawFrontCanvas`, y una asignación de instancia tapa el
// prototipo.
//
// Tener los dos enganches vivos a la vez es inofensivo: aplicar el imán dos
// veces en el mismo frame da el mismo resultado, porque se mide desde la
// posición libre y la segunda pasada recupera exactamente la misma.
function installFrameHook(state) {
  const canvas = app.canvas
  const prev = canvas?.drawFrontCanvas ?? LGraphCanvas.prototype.drawFrontCanvas
  if (!canvas || !prev) return

  canvas.drawFrontCanvas = function () {
    if (shouldEngage(this, state)) runMagnetSafely(this, state, liveSnapping())
    else if (cancelledMidDrag(state)) endSession(state, false)
    return prev.apply(this, arguments)
  }
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

  // Ojo con el cierre: al soltar el botón el ratón casi siempre se mueve un
  // poco, y ese pointermove residual llega con draggingItems ya en false.
  // Cerrar la sesión ahí mataba el ancho antes de que el pointerup aplazado
  // pudiera aplicarlo — se veía la alineación y no el ancho.
  el.addEventListener("pointermove", () => {
    const c = app.canvas
    if (shouldEngage(c, state)) runMagnetSafely(c, state, liveSnapping())
    else if (cancelledMidDrag(state)) endSession(state, false)
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
      // Aquí se mueve siempre: con Nodes 2.0 es el único momento en que se
      // aplica, y con el clásico es la pasada que gana al snap a rejilla.
      if (state.magnetEnabled) runMagnetSafely(c, state, true)
      endSession(state, true)
      c?.setDirty(true, true)
    }, 0)
  }
  addEventListener("pointerup", finish, true)

  // Cierres de seguridad: la transacción de undo no puede quedarse abierta.
  addEventListener("pointercancel", () => { if (session.active) endSession(state, false) }, true)
  addEventListener("blur",          () => { if (session.active) endSession(state, false) })
}

function applyMagnet(canvas, state, move) {
  const nodes = draggedItemsOf(canvas)
  if (!nodes.length) { endSession(state, false); return }

  const dragRect = unionRect(nodes.map(rectOf))
  if (!dragRect) { endSession(state, false); return }

  // El índice se construye una vez por arrastre: los vecinos no se mueven.
  if (!session.active) {
    // La sesión se marca activa ANTES de recolectar. Si collectSnapTargets
    // fallara con el flag aún a false, endSession no cerraría la transacción
    // recién abierta y el siguiente frame volvería a abrir otra.
    session.graph   = canvas.graph
    session.nodes   = nodes
    session.active  = true
    // Origen del arrastre: desde aquí se reconstruye la posición libre a partir
    // del recorrido del puntero, sin depender de quién escriba node.pos.
    session.originRect    = { x: dragRect.x, y: dragRect.y }
    session.originPointer = { ..._pointer }
    canvas.graph?.beforeChange()

    session.targets = collectSnapTargets(canvas.graph, canvas.selectedItems, dragRect, {
      gapX: state.magnetGapX,
      gapY: state.magnetGapY,
    })
  }

  // Posición libre: dónde estaría el nodo si el imán no existiera.
  //
  // Se reconstruye del PUNTERO, no de dónde está el nodo. Los dos renderizadores
  // lo mueven de forma incompatible: LiteGraph suma deltas sobre la posición
  // actual —así que conserva nuestra corrección—, mientras que la ruta Vue de
  // Nodes 2.0 reescribe cada frame la posición absoluta desde el inicio del
  // arrastre (`c.x + o.x`), borrando la corrección. Infiriendo la posición libre
  // de las mutaciones, con Vue se resta una corrección que ya no está y el nodo
  // entra en oscilación: tiembla y parece querer engancharse a varios sitios.
  //
  // El recorrido del puntero es la intención del usuario y vale igual en ambos.
  const scale = canvas.ds?.scale || 1
  const free = {
    x: session.originRect.x + (_pointer.x - session.originPointer.x) / scale,
    y: session.originRect.y + (_pointer.y - session.originPointer.y) / scale,
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
  if (move && (moveX || moveY)) {
    for (const n of nodes) moveItem(n, moveX, moveY)
    canvas.setDirty(true, true)
  }
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
