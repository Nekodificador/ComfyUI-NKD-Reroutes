// Motor de tensión de los cables — función pura.
// Sin DOM, sin canvas, sin LiteGraph: se ejecuta bajo node para los tests y en
// el laboratorio (js/lab.html) sobre el mismo código que usa ComfyUI.

/**
 * Handles de la Bézier de un tramo de cable.
 *
 * @param {[number,number]} a  extremo de salida, en coordenadas de grafo
 * @param {[number,number]} b  extremo de llegada
 * @param {{startDir?:number, endDir?:number, extras?:object,
 *          startIsReroute:boolean, endIsReroute:boolean}} ctx
 *        Los flags de reroute entran ya resueltos: averiguarlos necesita el
 *        grafo de ComfyUI y eso es trabajo del adaptador, no de la geometría.
 * @param {object} cfg  cualquier objeto con las claves de DEFAULTS
 * @returns {{startControl:[number,number], endControl:[number,number],
 *            startPoint:[number,number], endPoint:[number,number]}}
 *        Los controles son OFFSETS relativos a cada extremo, no puntos
 *        absolutos. La curva es P0 = startPoint, P1 = startPoint +
 *        startControl, P2 = endPoint + endControl, P3 = endPoint, y del
 *        extremo real a su punto sale un tramo RECTO (el rabito). Con
 *        stubLength = 0 los puntos son a y b, y no hay tramo recto.
 */

// Tope del rabito como fracción de la distancia del cable. Sin él, en un cable
// corto los dos rabitos se pasan de largo y la curva que queda entre sus puntas
// se dobla sobre sí misma. Va con la DISTANCIA y no con el hueco horizontal a
// propósito: con el hueco, un cable vertical —hueco cero— se quedaría sin
// rabito justo al pasar por la vertical, que es el pellizco que el techo
// proporcional ya costó quitar.
const MAX_STUB_FRACTION = 0.4

export function computeTension(a, b, ctx, cfg) {
  const { startDir, endDir, extras, startIsReroute, endIsReroute } = ctx

  // --- Cara de cada socket ---
  // Sube aquí porque decide dos cosas: hacia dónde apunta el handle y hacia
  // dónde sale el rabito. Son la misma dirección —la del socket— y tenerla
  // escrita dos veces era pedir que se separasen.
  let startSignX = 1
  let endSignX   = -1

  if (extras?.startControl)      startSignX = extras.startControl[0] < 0 ? -1 : 1
  else if (startDir === 3)       startSignX = -1 // LEFT

  if (extras?.endControl)        endSignX = extras.endControl[0] > 0 ? 1 : -1
  else if (endDir === 4)         endSignX = 1    // RIGHT

  // --- Rabito recto ---
  // El cable sale del socket en horizontal durante stubLength px y la Bézier
  // empieza en la punta. Toda la geometría de abajo trabaja ya sobre las
  // puntas, así que el techo proporcional mide el hueco que de verdad le queda
  // a la curva y no el que había antes de descontar los rabitos.
  //
  // SÓLO en los extremos que tocan un nodo. Un reroute no es un socket: es un
  // punto de paso, y el cable tiene que leerse como un trazo continuo al
  // cruzarlo. Con rabito a los dos lados del punto salía recta-curva-recta-
  // curva-recta y el bache se veía a simple vista.
  const rawDist = Math.hypot(b[0] - a[0], b[1] - a[1])
  const stub = Math.min(Math.max(cfg.stubLength ?? 0, 0), rawDist * MAX_STUB_FRACTION)
  const stubStart = startIsReroute ? 0 : stub
  const stubEnd   = endIsReroute   ? 0 : stub
  const startPoint = [a[0] + stubStart * startSignX, a[1]]
  const endPoint   = [b[0] + stubEnd   * endSignX,   b[1]]

  const dx = endPoint[0] - startPoint[0]
  const dy = endPoint[1] - startPoint[1]
  const absDx = Math.abs(dx)
  const wireDist = Math.sqrt(dx * dx + dy * dy)
  // 0→1 smoothstep ramp for scaling floors on short connections.
  // Smoothstep instead of linear gives zero-derivative endpoints — no kink at wireDist=80.
  // Todos los anchos de transición salen del mismo sitio, para que un solo
  // mando (Crossing Width) los ensanche o los estreche a la vez. Las fracciones
  // 2/3 y 4/3 reproducen los 80 y 160 px de siempre con el valor por defecto.
  const FADE_NEAR = cfg.crossingMargin * (2 / 3)
  const FADE_FAR  = cfg.crossingMargin * (4 / 3)
  const tDist    = Math.min(1, wireDist / Math.max(1, FADE_NEAR))
  const distRamp = tDist * tDist * (3 - 2 * tDist)

  // --- Ley de tensión ---
  // El handle es proporcional a la distancia, con un exponente que inclina la
  // recta: 1 = proporcional puro (la ley del frontend nativo), >1 = los cables
  // largos se abren más, <1 = todos curvan parecido.
  //
  // Antes esto eran cinco mandos: un smoothstep de socketMin a socketMax sobre
  // stretchRef, más una cola lineal, más el término proporcional, más un
  // exponente con pivote. El smoothstep satura por diseño —era la causa de que
  // los cables no se sintieran elásticos— y sus tres mandos no añaden ninguna
  // forma que esta ley no dé.
  //
  // REF sólo fija las unidades de distFactor (el handle a esa distancia). No es
  // un mando porque no aporta libertad: mover REF equivale a mover distFactor.
  const REF = 500
  const d = Math.max(1, wireDist)
  let baseTension = d * cfg.distFactor * Math.pow(d / REF, cfg.nonLinear - 1) * cfg.handleFactor

  // --- Per-endpoint multipliers ---
  // Un multiplicador por especie de extremo, no uno por especie Y sentido: la
  // asimetría salida/llegada no la usó nunca nadie —los presets históricos
  // siempre tuvieron los dos iguales— y eran cuatro mandos para dos ideas.
  const outMultiplier = startIsReroute ? cfg.rerouteFactor : cfg.nodeFactor
  const inMultiplier  = endIsReroute   ? cfg.rerouteFactor : cfg.nodeFactor

  let offsetStart = baseTension * outMultiplier
  let offsetEnd   = baseTension * inMultiplier

  // --- Crossing blend factor ---
  // Smoothly interpolates forward tension into backward tension over a ±30 px window
  // around dx = 0, eliminating the hard jump at the forward/backward boundary.
  const CROSSING_MARGIN = cfg.crossingMargin
  let crossBlend = 0
  if (dx < CROSSING_MARGIN) {
    const t = Math.max(0, Math.min(1, (CROSSING_MARGIN - dx) / (2 * CROSSING_MARGIN)))
    crossBlend = t * t * (3 - 2 * t)
  }

  if (crossBlend > 0) {
    // El bucle de vuelta crece con la DISTANCIA, no con lo vertical que sea el
    // cable. Antes el término iba con |dy| y sólo aparecía cerca de la vertical:
    // un nodo justo encima recibía una barriga enorme y el mismo nodo en
    // diagonal, a la misma distancia, casi ninguna. Ahora un vecino más a la
    // izquierda y más abajo se lleva más curva, que es lo que uno espera —y lo
    // que deja ver el socket en vez de tapar el cable contra el cuerpo.
    // handleFactor se aplica aquí también: dice ser la curvatura de TODOS los
    // cables, y la rama de vuelta se lo saltaba —bajar la curvatura global no
    // domaba los bucles, que es justo cuando uno la baja.
    const backBoost = wireDist * cfg.backwardStretch
    const invBase   = (cfg.inversionPull + backBoost) * cfg.handleFactor
    offsetStart = offsetStart * (1 - crossBlend) + invBase * outMultiplier * crossBlend
    offsetEnd   = offsetEnd   * (1 - crossBlend) + invBase * inMultiplier  * crossBlend
  }

  // --- Clamp offsets ---
  // Sin techo absoluto: maxSplineOffset valía 9999 y no llegaba a topar ni
  // forzando todos los mandos al máximo. El techo que sí manda es el proporcional.
  offsetStart = Math.max(cfg.minSplineOffset, offsetStart)
  offsetEnd   = Math.max(cfg.minSplineOffset, offsetEnd)

  // Aquí vivía la amortiguación por verticalidad (verticalTightness). La quita
  // el techo proporcional: aplanar un cable casi vertical es exactamente lo que
  // hace topar el handle a una fracción del hueco horizontal, que tiende a cero
  // según el cable se endereza. Dos mandos para lo mismo, y el techo lo hace sin
  // necesidad de un multiplicador aparte.

  // --- Node body clearance: minimum X offset when connection is near-vertical ---
  // Fades out smoothly from full strength at dx=0 to zero at dx=160,
  // avoiding the hard jump that the old if(dx<80) threshold produced.
  let clearanceFloor = 0
  if (absDx < FADE_FAR) {
    const tClr    = Math.max(0, Math.min(1, (absDx - FADE_NEAR) / Math.max(1, FADE_FAR - FADE_NEAR)))
    const clrMult = 1 - tClr * tClr * (3 - 2 * tClr)
    clearanceFloor = cfg.nodeBodyClearance * distRamp * clrMult
  }

  // El suelo despeja el CUERPO de un nodo, y un reroute no tiene cuerpo: son
  // cinco píxeles de punto. Aplicándolo también allí, un tramo casi vertical
  // entre dos reroutes se llevaba 24 px de handle horizontal a cada lado —uno
  // hacia fuera y otro hacia dentro— y eso es exactamente la barriguita que
  // deja un cambio de dirección. Va por extremo porque un tramo nodo→reroute
  // tiene cuerpo que despejar en un lado y nada en el otro.
  const floorStart = startIsReroute ? 0 : clearanceFloor
  const floorEnd   = endIsReroute   ? 0 : clearanceFloor
  offsetStart = Math.max(offsetStart, floorStart)
  offsetEnd   = Math.max(offsetEnd,   floorEnd)

  // --- Techo proporcional al hueco horizontal ---
  // Los handles salen en horizontal y en sentidos opuestos, así que lo que
  // tienen para maniobrar es |dx|, no la distancia. Si entre los dos suman más
  // que el hueco, la curva se dobla sobre sí misma: es la ese exagerada de las
  // conexiones cortas y empinadas. En 0.5 cada handle ocupa como mucho la mitad
  // del hueco — el punto exacto en el que la curva deja de doblarse.
  //
  // Los suelos absolutos (nodeBodyClearance, minSplineOffset) no
  // pueden evitarlo porque no saben cuánto hueco hay. El techo sí, y va al
  // final para poder ganarles.
  //
  // En la zona de cruce se va apagando: ahí el handle TIENE que pasarse de largo
  // para dibujar el bucle de vuelta. Se apaga MEZCLADO, con el mismo crossBlend
  // que la tensión — quitarlo de golpe al entrar en la zona devolvería justo el
  // salto que el blend existe para evitar.
  //
  // El techo nunca baja del suelo de holgura: con el hueco tendiendo a cero el
  // techo también lo hacía, y el cable se estrangulaba justo al pasar por la
  // vertical —un pellizco en mitad del arrastre—. Con hueco cero no hay curva
  // que proteger; lo que hace falta es la holgura que despeja el socket.
  if (cfg.maxHandleRatio > 0 && crossBlend < 1) {
    // El techo nunca baja del suelo de su propio extremo — si no, en un tramo
    // nodo→reroute el techo del lado del nodo se comería la holgura que el
    // suelo acababa de poner.
    const applyCap = (v, floor) => {
      const cap = Math.max(Math.abs(dx) * cfg.maxHandleRatio, floor)
      return v * crossBlend + Math.min(v, cap) * (1 - crossBlend)
    }
    offsetStart = applyCap(offsetStart, floorStart)
    offsetEnd   = applyCap(offsetEnd,   floorEnd)
  }

  // Hacia dónde se inclina el handle al girar: hacia donde va el cable.
  // Antes había además un "escape vertical" que sumaba Y por su cuenta; el giro
  // lo hace mejor, porque rota el handle en vez de alargarlo.
  const escapeSign = dy >= 0 ? 1 : -1

  // --- Giro del handle al cruzar ---
  // El handle no cambia de signo de golpe: GIRA media vuelta a lo largo de la
  // misma ventana que todo lo demás. Antes la magnitud se fundía pero la
  // dirección saltaba en dx = 0, así que el punto de control se teletransportaba
  // de +offset a -offset —el tirón que se ve al pasar un nodo por delante de otro—.
  //
  // Girando en vez de invertir, el módulo del handle no cambia: a mitad de la
  // ventana apunta en vertical, hacia donde va el cable, y de ahí sigue hasta
  // quedar del revés. Sin pellizco, porque nunca pasa por cero.
  const turn = cfg.invertBackward ? Math.PI * crossBlend : 0
  const cs = Math.cos(turn), ss = Math.sin(turn)
  const ce = cs,             se = ss

  return {
    startControl: [offsetStart * startSignX * cs,  offsetStart * ss * escapeSign],
    endControl:   [offsetEnd   * endSignX   * ce, -offsetEnd   * se * escapeSign],
    startPoint,
    endPoint,
  }
}
