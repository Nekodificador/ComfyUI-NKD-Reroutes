import { app } from "../../../scripts/app.js"
import { computeSnap } from "./computeSnap.js"
import { collectResizeTargets, collectSnapTargets, isGroup, isReroute, rectOf, unionRect } from "./snapTargets.js"

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
    if (isGroup(n)) {
      // resize() ya recorta al mínimo del grupo por su cuenta.
      n.resize(width, n.size[1])
      continue
    }
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
  // Un grupo tiene que arrastrar a sus hijos: escribirle `pos` los dejaría atrás.
  else if (isGroup(item)) item.move(dx, dy)
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
  addEventListener("pointermove", (e) => {
    _pointer = { x: e.clientX, y: e.clientY }
    // Basta con que Shift esté pulsado en algún momento del estirado: mirarlo al
    // soltar es una carrera perdida, porque la tecla suele llegar antes.
    if (_vueResize && _shiftDown) _vueResize.shift = true
  }, true)
  addEventListener("pointerdown", (e) => {
    _pointer = { x: e.clientX, y: e.clientY }
    _pointerDown = true
    _vueResize = detectVueResizeHandle(e)
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

// state: el objeto `state` vivo de rerouteSplines.js
export function installMagnet(state) {
  _state = state
  trackInput()
  installDragListener(state)   // renderizador clásico
  installFrameHook(state)      // Nodes 2.0
  installGuideRenderer(state)
}

// Durante el arrastre el imán NO mueve nada: sólo calcula, para que la silueta y
// las guías enseñen dónde va a caer mientras el nodo sigue al ratón. El
// movimiento se aplica al soltar.
//
// Es mejor tacto —ves el destino sin que el nodo pelee contigo— y además evita
// una carrera que con Nodes 2.0 no se puede ganar: el store de Vue reafirma la
// posición libre en cada frame (`batchMoveNodes`, setSource(Vue)) y el setter de
// `pos` escribe la nuestra (`moveNode`, setSource(Canvas)). Gana quien escriba
// último y el nodo parpadea, tanto peor cuanto más se mueve el ratón.

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
// Tener los dos enganches vivos a la vez es inofensivo: durante el arrastre sólo
// calculan, y la posición libre sale del puntero, así que evaluar dos veces en el
// mismo frame da el mismo resultado.
function installFrameHook(state) {
  const canvas = app.canvas
  const prev = canvas?.drawFrontCanvas ?? LGraphCanvas.prototype.drawFrontCanvas
  if (!canvas || !prev) return

  canvas.drawFrontCanvas = function () {
    if (shouldEngage(this, state)) runMagnetSafely(this, state, false)   // sólo calcular: mueve el release
    else if (cancelledMidDrag(state)) endSession(state, false)
    runResizeMagnetSafely(this, state)
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
    if (shouldEngage(c, state)) runMagnetSafely(c, state, false)   // sólo calcular: mueve el release
    else if (cancelledMidDrag(state)) endSession(state, false)
    // El redimensionado de grupos va por su cuenta: corrige el tamaño que
    // litegraph acaba de escribir en este mismo evento.
    runResizeMagnetSafely(c, state)
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
    _resizeGuides = []
    const vue = _vueResize
    _vueResize = null
    if (!session.active && !vue) return
    setTimeout(() => {
      const c = app.canvas
      // Nodes 2.0 asienta el tamaño después de soltar, así que su enganche vive
      // en este tick aplazado y no antes.
      if (vue && state.magnetEnabled && vue.shift) finishVueResize(c, vue, state)
      if (!session.active) return
      // Sin comprobar shiftDown a propósito. Si la sesión sigue viva es que el
      // usuario NO se echó atrás —soltar Shift la habría cerrado desde el
      // pointermove—, así que el imán tiene la última palabra. Comprobarlo aquí
      // era una carrera perdida: al soltar Shift junto con el botón, la tecla
      // suele llegar antes y el imán se saltaba la pasada final, dejando en pie
      // el cuantizado a rejilla de LiteGraph (10 px) y el nodo un par de píxeles
      // fuera de donde marcaba la silueta.
      // El único momento en que el imán mueve algo. Además es la pasada que
      // gana al cuantizado a rejilla de LiteGraph, que corre en su pointerup.
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

// ── Magnetismo al redimensionar por una esquina (nodos y grupos) ────────────
//
// Va por libre de la sesión de arrastre: aquí no se mueve nada, sólo cambia el
// tamaño, y no hay que reconstruir posición libre alguna. Litegraph recalcula el
// tamaño desde el puntero en CADA evento (absoluto, no acumulado), así que
// corregirlo en vivo no acumula deriva: si alejas el ratón, el enganche suelta.
let _resizeGuides = []

// Redimensionado en Nodes 2.0.
//
// Ahí un nodo es un elemento DOM y el estirado lo lleva una ruta Vue propia:
// `canvas.resizing_node` no se pone nunca y, mientras arrastras, el tamaño vive
// sólo en variables CSS del elemento —`node.size` va rancio hasta que se
// asienta—. Así que no hay nada que corregir en vivo: se apunta qué tirador
// pulsaste y el imán da una sola pasada al soltar, igual que hace el arrastre.
//
// La esquina sale de la clase de cursor del tirador (`cursor-nw-resize`), que es
// lo único del DOM que la nombra.
const VUE_CORNER = /cursor-(se|ne|sw|nw)-resize/
let _vueResize = null

function detectVueResizeHandle(ev) {
  const el = ev.target?.closest?.("[role='button']")
  if (!el) return null
  const cls = typeof el.className === "string" ? el.className : el.className?.baseVal || ""
  const corner = VUE_CORNER.exec(cls)?.[1]
  if (!corner) return null

  const id = el.closest("[data-node-id]")?.dataset?.nodeId
  const node = id != null ? app.canvas?.graph?.getNodeById?.(Number(id)) : null
  return node ? { node, dir: corner.toUpperCase(), shift: _shiftDown } : null
}

// Qué se está estirando y por dónde. Un nodo se agarra por las cuatro esquinas
// —la dirección la deja litegraph en el puntero—; un grupo, sólo por la inferior
// derecha.
function resizingItem(canvas) {
  const node = canvas.resizing_node
  if (node) return { item: node, dir: canvas.pointer?.resizeDirection || "SE" }
  const group = canvas.resizingGroup
  if (group) return { item: group, dir: "SE" }
  return null
}

// Escribe el rectángulo ya enganchado. Cada especie guarda su tamaño a su
// manera, y el rect de un nodo lleva la barra de título por delante de `pos`.
function applyRect(item, r) {
  if (isGroup(item)) {
    item.pos = [r.x, r.y]
    item.resize(r.w, r.h)     // resize() ya recorta al mínimo del grupo
    return
  }
  // `size` de un nodo es sólo el cuerpo; el rect lleva además la barra de título.
  const th = LiteGraph.NODE_TITLE_HEIGHT
  if (typeof item.setPos === "function") item.setPos(r.x, r.y + th)
  else item.pos = [r.x, r.y + th]
  item.setSize([r.w, r.h - th])
}

// Pasada única al soltar el tirador de Nodes 2.0. Va en su propia transacción:
// el estirado de Vue ya cerró la suya antes de que el tamaño llegara aquí.
function finishVueResize(canvas, vue, state) {
  if (!canvas?.graph || vue.node.graph !== canvas.graph) return
  try {
    canvas.graph.beforeChange()
    snapResize(canvas, vue.node, vue.dir, state)
  } catch (err) {
    console.error("[NKD Reroutes] fallo del imán al redimensionar (Nodes 2.0):", err)
  } finally {
    canvas.graph.afterChange()
  }
}

function runResizeMagnetSafely(canvas, state) {
  try {
    applyResizeMagnet(canvas, state)
  } catch (err) {
    console.error("[NKD Reroutes] fallo del imán al redimensionar:", err)
    _resizeGuides = []
  }
}

function applyResizeMagnet(canvas, state) {
  const target = canvas && state.magnetEnabled && _shiftDown ? resizingItem(canvas) : null
  if (!target) {
    if (_resizeGuides.length) { _resizeGuides = []; canvas?.setDirty(true, true) }
    return
  }
  _resizeGuides = snapResize(canvas, target.item, target.dir, state)
}

// Engancha el rectángulo del elemento que se está estirando y lo escribe.
// Devuelve las guías del enganche (vacío si no ha enganchado nada).
function snapResize(canvas, item, dir, state) {
  const rect = rectOf(item)
  const targets = collectResizeTargets(canvas.graph, item, {
    gapX: state.magnetGapX,
    gapY: state.magnetGapY,
  }, dir)
  const snap = computeSnap(rect, targets, {
    radius:     state.magnetRadius,
    matchWidth: false,
    minWidth:   0,
  })

  if (!snap.dx && !snap.dy) return snap.guides

  // Estirar por el lado oeste/norte mueve el borde: crece hacia dentro y hay que
  // recolocar el origen. Por el este/sur basta con el tamaño.
  const next = { ...rect }
  if (snap.dx) {
    if (dir.includes("W")) { next.x += snap.dx; next.w -= snap.dx }
    else next.w += snap.dx
  }
  if (snap.dy) {
    if (dir.includes("N")) { next.y += snap.dy; next.h -= snap.dy }
    else next.h += snap.dy
  }

  // Nunca por debajo del mínimo del nodo: encogerlo más recortaría widgets.
  // Se renuncia sólo al eje que se pasa, no al enganche entero.
  // El alto mínimo que devuelve computeSize es el del cuerpo, sin barra de título.
  const [minW, minH] = item.computeSize?.() ?? [0, 0]
  const th = isGroup(item) ? 0 : LiteGraph.NODE_TITLE_HEIGHT
  if (next.w < minW)      { next.x = rect.x; next.w = rect.w }
  if (next.h - th < minH) { next.y = rect.y; next.h = rect.h }
  if (next.x === rect.x && next.y === rect.y && next.w === rect.w && next.h === rect.h) return []

  applyRect(item, next)
  canvas.setDirty(true, true)
  return snap.guides
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
    if (!state.magnetGuides) return

    // Las guías y la silueta se dibujan por separado. Sólo los candidatos de
    // alineación llevan guía; los de adosado no. Un enganche que gane sólo por
    // apilado deja `guides` vacío y aun así mueve el nodo, así que salir aquí
    // dejaría ese caso sin ningún indicador.
    //
    // Al redimensionar un grupo no hay silueta —el grupo ya está estirado a su
    // tamaño final— pero sí guía, que es lo que dice contra qué has cuadrado.
    const active = session.active && session.result
    const guides = active ? session.result.guides : _resizeGuides
    const ghost  = active ? session.result.ghost  : null
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
