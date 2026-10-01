// Esquinas redondeadas en los grupos (clásico).
//
// No se reescribe el dibujado del grupo: se envuelve `LGraphGroup.draw` y, SÓLO
// mientras corre, `ctx.rect` pasa a ser `roundRect`. Título, color, texto, resaltado
// de selección y todo lo que añada el frontend siguen siendo suyos.
//   · La barra del título (alto = NODE_TITLE_HEIGHT) redondea sólo arriba, para
//     que case con el cuerpo, que lo redondea todo.
//   · El triángulo de redimensionado es una esquina cuadrada y sobresaldría de la
//     curva: se anula durante el draw (resizeLength = 0) y se repinta después
//     recortado al contorno redondeado. El área de agarre no cambia: resizeLength
//     se restaura antes de volver.
// Radio 0 (por defecto) = ni se toca el draw.

export function installGroupCorners(state) {
  const G = window.LiteGraph?.LGraphGroup
  if (!G || G.prototype.__nkdCorners) return
  G.prototype.__nkdCorners = true
  const orig = G.prototype.draw

  G.prototype.draw = function (graphCanvas, ctx) {
    const r = Number(state.groupCornerRadius)
    if (!(r > 0) || typeof ctx?.roundRect !== "function") return orig.apply(this, arguments)

    const titleH = window.LiteGraph.NODE_TITLE_HEIGHT
    const tri = G.resizeLength
    ctx.rect = function (x, y, w, h) {
      this.roundRect(x, y, w, h, h === titleH ? [r, r, 0, 0] : r)
    }
    G.resizeLength = 0
    try {
      orig.apply(this, arguments)
    } finally {
      delete ctx.rect
      G.resizeLength = tri
    }

    const [x, y] = this.pos, [w, h] = this.size
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x + 0.5, y + 0.5, w, h, r)
    ctx.clip()
    ctx.fillStyle = this.color || G.defaultColour
    ctx.globalAlpha = graphCanvas.editor_alpha
    ctx.beginPath()
    ctx.moveTo(x + w, y + h)
    ctx.lineTo(x + w - tri, y + h)
    ctx.lineTo(x + w, y + h - tri)
    ctx.fill()
    ctx.restore()
  }
}
