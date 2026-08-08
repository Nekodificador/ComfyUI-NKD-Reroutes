import assert from "node:assert/strict"
import { test } from "node:test"
import { computeTension } from "./tension.js"
import { DEFAULTS, PRESETS } from "./config.js"

// Goldens: se generaron ejecutando la fórmula TAL COMO ESTABA dentro de
// rerouteSplines.js, antes de extraerla aquí. No se regeneran desde este
// módulo por costumbre — entonces el test no probaría nada, sólo que el código
// es igual a sí mismo. Si uno falla, o la fórmula cambió de verdad o alguien
// se llevó por delante algo sin querer.
//
// Rebases deliberados, con lo que cambió cada uno medido fila a fila:
//
// 1. El pivote de la no linealidad pasó de 250 fijo a `socketMax`. Con 250 el
//    pivote quedaba SIEMPRE por encima de la tensión real (10-40 px), y como el
//    efecto se invierte al cruzarlo, el mando de elasticidad hacía justo lo
//    contrario de lo que dice su etiqueta. Sólo movió las filas de "Flowy &
//    Organic": es el único caso de la rejilla con nonLinear ≠ 1 cuyo offset no
//    lo decide otra regla.
// 2. El bucle de vuelta pasó de crecer con |dy| y sólo cerca de la vertical, a
//    crecer con la distancia en todos los ángulos (`backwardStretch`), y se
//    añadió el techo proporcional al hueco horizontal (`maxHandleRatio`). Movió
//    las filas de la zona de cruce y las de hueco corto en los dos presets
//    "Hard Push Out", que daban un handle mayor que el propio hueco.
// 3. La ventana de la mezcla adelante↔atrás pasó de ±30 a ±120 px: con un bucle
//    que ahora crece con la distancia, 60 px de recorrido para pasar de nada a
//    todo se veía como un salto. Y el techo dejó de caer a cero al pasar por la
//    vertical (donde el hueco horizontal tiende a 0) — ese pellizco era el
//    cambio más brusco de todo el barrido.
// 4. Se fundieron las transiciones que quedaban duras: el handle GIRA media
//    vuelta en vez de cambiar de signo en dx = 0 (era un salto instantáneo de
//    2 × offset en el punto de control), el factor de ángulo se calcula siempre
//    en vez de aparecer de golpe en el borde de la ventana, y los anchos que
//    estaban a pelo (80 y 160 px) salen ahora de crossingMargin, así que un solo
//    mando los mueve todos. Con el valor por defecto (120) esos anchos dan
//    exactamente los 80 y 160 de antes. Lo mismo con la amortiguación vertical:
//    su ancho lo pone crossingMargin y a verticalTightness le queda decir cuánto
//    aplana. Con los valores por defecto sale 120 donde antes salía 125, así que
//    sólo se movieron los presets que tocan verticalTightness.
// 5. verticalTightness llega de verdad a 0: su mínimo era 0.3·(1-vt), así que
//    ni en el extremo suelto del slider se podía desactivar. De paso se
//    arreglaron dos asimetrías de la rama hacia atrás —handleFactor no la
//    tocaba, y el término proporcional se colaba en el suelo de holgura
//    saltándose los multiplicadores por extremo— y "Classic Comfy" pasó de
//    aproximar la fórmula nativa a reproducirla exacta (ver el test de abajo).
// 6. Se quitaron los presets de estilo —ahora los guarda el usuario— y con
//    ellos sus filas: la rejilla se queda con DEFAULTS y "Classic Comfy".
// 7. Fuera verticalTightness y verticalEscapeScale. La amortiguación por
//    verticalidad hacía lo mismo que el techo proporcional —aplanar el cable
//    según se endereza, porque el hueco horizontal tiende a cero— y el escape
//    lo hace ahora el giro del handle, que rota en vez de alargar. Sólo se
//    movieron las filas con dy ≠ 0 de DEFAULTS; "Classic Comfy" ya los tenía a
//    cero, así que sigue siendo la fórmula nativa exacta.
// 8. Poda de mandos redundantes (23 → 12). Se fue el modo "Hard Push Out" con
//    sus cuatro mandos —fijaba el handle a una constante ignorando la distancia,
//    y de paso se llevó el factor de ángulo, que ya no usaba nadie más— y la
//    familia del smoothstep (socketMax, stretchRef, tailGrowth): la ley pasa a
//    ser handle = distancia × distFactor × (distancia/500)^(nonLinear-1), que da
//    las mismas formas con dos mandos en vez de cinco. Los defaults cambian
//    porque los viejos daban 25 px planos a cualquier distancia; "Classic Comfy"
//    sigue siendo la fórmula nativa exacta.
// 9. La holgura del cuerpo (`nodeBodyClearance`) dejó de aplicarse a los
//    extremos que tocan un reroute, y pasó a resolverse por extremo en vez de
//    una vez para los dos. Despeja el CUERPO de un nodo y un reroute no tiene:
//    son cinco píxeles de punto. Aplicándolo allí, un tramo casi vertical entre
//    dos reroutes se llevaba 24 px de handle horizontal a cada lado —uno hacia
//    fuera y otro hacia dentro— y eso es la barriguita que dejaba un cambio de
//    dirección. Movió 8 filas de 54: sólo DEFAULTS, sólo con algún extremo en
//    reroute y sólo con |dx| por debajo de la ventana (60, 5, 5 y -30). En las
//    mixtas se mueve únicamente el handle del lado del reroute, que es la
//    prueba de que el reparto por extremo funciona. "Classic Comfy" ni se
//    entera: allí la holgura ya valía 0.
//
// Fila: [config, dx, dy, startIsReroute, endIsReroute, sx, sy, ex, ey]
const CASES = [
  ["DEFAULTS",60,0,false,false,17.858906,9.545784,-17.858906,-9.545784],
  ["DEFAULTS",60,0,true,true,12.560047,6.713485,-12.560047,-6.713485],
  ["DEFAULTS",60,0,true,false,12.560047,6.713485,-17.858906,-9.545784],
  ["DEFAULTS",300,0,false,false,69.467865,0,-69.467865,0],
  ["DEFAULTS",300,0,true,true,55.574292,0,-55.574292,0],
  ["DEFAULTS",300,0,true,false,55.574292,0,-69.467865,0],
  ["DEFAULTS",1200,40,false,false,342.318407,0,-342.318407,0],
  ["DEFAULTS",1200,40,true,true,273.854726,0,-273.854726,0],
  ["DEFAULTS",1200,40,true,false,273.854726,0,-342.318407,0],
  ["DEFAULTS",200,200,false,false,64.918915,0,-64.918915,0],
  ["DEFAULTS",200,200,true,true,51.935132,0,-51.935132,0],
  ["DEFAULTS",200,200,true,false,51.935132,0,-64.918915,0],
  ["DEFAULTS",5,400,false,false,6.622163,67.27513,-6.622163,-67.27513],
  ["DEFAULTS",5,400,true,true,4.428666,44.991201,-4.428666,-44.991201],
  ["DEFAULTS",5,400,true,false,4.428666,44.991201,-6.622163,-67.27513],
  ["DEFAULTS",5,-400,false,false,6.622163,-67.27513,-6.622163,67.27513],
  ["DEFAULTS",5,-400,true,true,4.428666,-44.991201,-4.428666,44.991201],
  ["DEFAULTS",5,-400,true,false,4.428666,-44.991201,-6.622163,67.27513],
  ["DEFAULTS",-200,0,false,false,-90,0,90,0],
  ["DEFAULTS",-200,0,true,true,-72,0,72,0],
  ["DEFAULTS",-200,0,true,false,-72,0,90,0],
  ["DEFAULTS",-30,300,false,false,-41.782664,64.224567,41.782664,-64.224567],
  ["DEFAULTS",-30,300,true,true,-32.701445,50.265731,32.701445,-50.265731],
  ["DEFAULTS",-30,300,true,false,-32.701445,50.265731,41.782664,-64.224567],
  ["DEFAULTS",15,10,false,false,3.602462,11.941639,-3.602462,-11.941639],
  ["DEFAULTS",15,10,true,true,3.138985,10.405281,-3.138985,-10.405281],
  ["DEFAULTS",15,10,true,false,3.138985,10.405281,-3.602462,-11.941639],
  ["Classic Comfy",60,0,false,false,15,0,-15,0],
  ["Classic Comfy",60,0,true,true,15,0,-15,0],
  ["Classic Comfy",60,0,true,false,15,0,-15,0],
  ["Classic Comfy",300,0,false,false,75,0,-75,0],
  ["Classic Comfy",300,0,true,true,75,0,-75,0],
  ["Classic Comfy",300,0,true,false,75,0,-75,0],
  ["Classic Comfy",1200,40,false,false,300.16662,0,-300.16662,0],
  ["Classic Comfy",1200,40,true,true,300.16662,0,-300.16662,0],
  ["Classic Comfy",1200,40,true,false,300.16662,0,-300.16662,0],
  ["Classic Comfy",200,200,false,false,70.710678,0,-70.710678,0],
  ["Classic Comfy",200,200,true,true,70.710678,0,-70.710678,0],
  ["Classic Comfy",200,200,true,false,70.710678,0,-70.710678,0],
  ["Classic Comfy",5,400,false,false,100.007812,0,-100.007812,0],
  ["Classic Comfy",5,400,true,true,100.007812,0,-100.007812,0],
  ["Classic Comfy",5,400,true,false,100.007812,0,-100.007812,0],
  ["Classic Comfy",5,-400,false,false,100.007812,0,-100.007812,0],
  ["Classic Comfy",5,-400,true,true,100.007812,0,-100.007812,0],
  ["Classic Comfy",5,-400,true,false,100.007812,0,-100.007812,0],
  ["Classic Comfy",-200,0,false,false,50,0,-50,0],
  ["Classic Comfy",-200,0,true,true,50,0,-50,0],
  ["Classic Comfy",-200,0,true,false,50,0,-50,0],
  ["Classic Comfy",-30,300,false,false,75.374067,0,-75.374067,0],
  ["Classic Comfy",-30,300,true,true,75.374067,0,-75.374067,0],
  ["Classic Comfy",-30,300,true,false,75.374067,0,-75.374067,0],
  ["Classic Comfy",15,10,false,false,4.506939,0,-4.506939,0],
  ["Classic Comfy",15,10,true,true,4.506939,0,-4.506939,0],
  ["Classic Comfy",15,10,true,false,4.506939,0,-4.506939,0],
]

const CONFIGS = {
  DEFAULTS: { ...DEFAULTS },
  ...Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { ...DEFAULTS, ...v }])),
}

// El `|| 0` normaliza -0: deepEqual lo distingue de 0 y aquí no significa nada.
const r6 = (n) => Math.round(n * 1e6) / 1e6 || 0
const run = (cfg, dx, dy, sr, er) => computeTension([0, 0], [dx, dy], {
  startDir: sr ? 0 : undefined,
  endDir:   er ? 0 : undefined,
  extras: {}, startIsReroute: sr, endIsReroute: er,
}, cfg)

test("la geometría extraída da los mismos handles que antes (54 casos)", () => {
  for (const [name, dx, dy, sr, er, sx, sy, ex, ey] of CASES) {
    const out = run(CONFIGS[name], dx, dy, sr, er)
    const got = [r6(out.startControl[0]), r6(out.startControl[1]),
                 r6(out.endControl[0]),   r6(out.endControl[1])]
    assert.deepEqual(got, [sx, sy, ex, ey], `${name} dx=${dx} dy=${dy} reroutes=${sr},${er}`)
  }
})

// Lo que promete la mezcla: al cruzar, el punto de control se DESPLAZA, no se
// teletransporta. Se mide el vector entero a propósito — mirando sólo el módulo,
// el cambio de signo del handle (que saltaba de +offset a -offset en dx = 0)
// pasaba desapercibido, porque el módulo no cambia al invertirse.
test("ninguna transición mueve el punto de control a saltos", () => {
  for (const [name, preset] of [["DEFAULTS", {}], ...Object.entries(PRESETS)]) {
    const cfg = { ...DEFAULTS, ...preset }
    for (const dy of [0, 200, 600]) {
      for (let dx = 400; dx >= -500; dx--) {
        const a = run(cfg, dx, dy, false, false).startControl
        const b = run(cfg, dx - 1, dy, false, false).startControl
        const salto = Math.hypot(a[0] - b[0], a[1] - b[1])
        assert.ok(salto < 5, `${name} dy=${dy} dx=${dx}: ${salto.toFixed(1)} px de salto`)
      }
    }
  }
})

// Un solo mando ensancha o estrecha TODAS las transiciones a la vez.
test("crossingMargin manda sobre todos los anchos", () => {
  const base = { ...DEFAULTS, nodeBodyClearance: 80, minSplineOffset: 0 }
  // La ventana de cruce: a 200 px por delante sólo hay mezcla si la ventana llega.
  const estrecha = run({ ...base, crossingMargin: 120 }, 200, 0, false, false).startControl[0]
  const ancha    = run({ ...base, crossingMargin: 300 }, 200, 0, false, false).startControl[0]
  assert.notEqual(estrecha, ancha)
  // El desvanecido de la holgura del cuerpo: con la ventana ancha aún alcanza.
  const clrEstrecha = run({ ...base, crossingMargin: 60 },  140, 0, false, false).startControl[0]
  const clrAncha    = run({ ...base, crossingMargin: 300 }, 140, 0, false, false).startControl[0]
  assert.ok(Math.abs(clrAncha) > Math.abs(clrEstrecha))
})

// El handle se inclina hacia donde va el cable, y hacia arriba o hacia abajo
// por igual. Antes esto vigilaba el escape vertical; ahora la componente Y la
// pone el giro, pero la simetría tiene que seguir siendo exacta.
test("la inclinación del handle es simétrica arriba y abajo", () => {
  const cfg = { ...DEFAULTS }
  const arriba = run(cfg, 5, -400, false, false)
  const abajo  = run(cfg, 5,  400, false, false)
  assert.equal(r6(arriba.startControl[1]), r6(-abajo.startControl[1]))
  assert.equal(r6(arriba.startControl[0]), r6(abajo.startControl[0]))
})

// La ley entera: el handle es proporcional a la distancia y el exponente la
// inclina. Con nonLinear = 1, el doble de distancia da el doble de handle.
test("la ley de tensión es proporcional a la distancia", () => {
  const cfg = { ...DEFAULTS, nonLinear: 1, minSplineOffset: 0, maxHandleRatio: 0 }
  const h = (d) => Math.abs(run(cfg, d, 0, false, false).startControl[0])
  assert.ok(Math.abs(h(1000) / h(500) - 2) < 1e-9, `${h(1000)} vs ${h(500)}`)

  const empinada = { ...cfg, nonLinear: 1.5 }
  const g = (d) => Math.abs(run(empinada, d, 0, false, false).startControl[0])
  assert.ok(Math.abs(g(1000) / g(500) - Math.pow(2, 1.5)) < 1e-9)
})

// El mando de elasticidad tiene que ir en el sentido de su etiqueta: por encima
// de 1, los cables LARGOS se abren más. Con el pivote fijo en 250 hacía lo
// contrario —los aplanaba— y nadie se enteraba salvo mirando los handles.
test("elasticidad > 1 abre los cables largos", () => {
  const base = { ...DEFAULTS, minSplineOffset: 8 }
  const largo = (n) => Math.abs(run({ ...base, nonLinear: n }, 1600, 0, false, false).startControl[0])
  const corto = (n) => Math.abs(run({ ...base, nonLinear: n }, 300, 0, false, false).startControl[0])
  assert.ok(largo(1.5) > largo(1.0), "1.5 debería abrir más que 1.0 en cable largo")
  assert.ok(largo(0.5) < largo(1.0), "0.5 debería comprimir el cable largo")
  assert.ok(corto(1.5) <= corto(1.0), "el corto no debe abrirse al subir la elasticidad")
})

// El bucle de vuelta crece con la distancia y NO con lo vertical que sea el
// cable: dos vecinos igual de lejos, uno justo encima y otro en diagonal, deben
// recibir la misma curva. Antes el vertical se llevaba el triple.
test("el bucle de vuelta va con la distancia, no con el ángulo", () => {
  const cfg = { ...DEFAULTS }
  const h = (dx, dy) => Math.abs(run(cfg, dx, dy, false, false).startControl[0])
  const diagonal = h(-424, 424)
  const tumbado  = h(-600, 0)
  assert.ok(Math.abs(diagonal - tumbado) < 1, `${diagonal} vs ${tumbado}`)
  assert.ok(h(-1200, 0) > h(-600, 0) * 1.5, "el doble de lejos, bastante más bucle")
})

// El techo impide que los dos handles sumen más que el hueco horizontal, que es
// lo que dobla la curva sobre sí misma en las conexiones cortas y empinadas.
test("el techo mantiene los handles dentro del hueco horizontal", () => {
  const cfg = { ...DEFAULTS, socketMax: 300, nodeFactor: 1, handleFactor: 2,
                maxHandleRatio: 0.5 }
  const out = run(cfg, 120, 300, false, false)
  assert.ok(Math.abs(out.startControl[0]) <= 60 + 1e-6, `handle ${out.startControl[0]} sobre un hueco de 120`)
  // Sin techo el mismo caso se pasa de largo y la curva se dobla.
  const libre = run({ ...cfg, maxHandleRatio: 0 }, 120, 300, false, false)
  assert.ok(Math.abs(libre.startControl[0]) > 60, `sin techo: ${libre.startControl[0]}`)
})

// El preset "Classic Comfy" no aproxima la fórmula del frontend nativo: ES la
// fórmula. handle = distancia · 0.25 en la dirección del socket, sin suelos,
// sin topes, sin reglas de ángulo y sin caso especial hacia atrás. Vale de
// referencia —es lo que se ve al desinstalar la extensión— y de red: si algún
// cambio futuro mete un suelo o un tope por en medio, esto lo canta.
test("Classic Comfy reproduce la fórmula nativa exacta", () => {
  const cfg = { ...DEFAULTS, ...PRESETS["Classic Comfy"] }
  for (let dx = -900; dx <= 900; dx += 60) {
    for (let dy = -900; dy <= 900; dy += 60) {
      const nativo = Math.hypot(dx, dy) * 0.25
      if (nativo < 1) continue
      const got = Math.hypot(...run(cfg, dx, dy, false, false).startControl)
      assert.ok(Math.abs(got - nativo) / nativo < 1e-9, `dx=${dx} dy=${dy}: ${got} vs ${nativo}`)
    }
  }
})

// El rabito: la curva ya no arranca en el socket sino a stubLength px de él,
// en la dirección de la cara del socket, y el tramo que queda es recto porque
// lo pintan los adaptadores como una línea. Lo que se comprueba aquí es lo
// único que puede romperse en silencio: dónde caen las puntas.
test("el rabito desplaza los extremos por la cara del socket", () => {
  const cfg = { ...DEFAULTS, stubLength: 20 }
  const out = run(cfg, 400, 100, false, false)
  assert.deepEqual(out.startPoint, [20, 0],   "la salida sale hacia la derecha")
  assert.deepEqual(out.endPoint,   [380, 100], "la llegada entra desde la izquierda")

  // Hacia atrás las caras no cambian: el cable sigue saliendo por la derecha
  // del origen y entrando por la izquierda del destino, y por eso hace el bucle.
  const atras = run(cfg, -400, 0, false, false)
  assert.deepEqual(atras.startPoint, [20, 0])
  assert.deepEqual(atras.endPoint,   [-420, 0])
})

// Sin tope, en un cable corto los dos rabitos se cruzan y la curva que queda
// entre las puntas se dobla sobre sí misma — la misma ese que costó quitar con
// el techo proporcional, pero metida por la puerta de atrás.
test("el rabito se encoge con los cables cortos", () => {
  const cfg = { ...DEFAULTS, stubLength: 60 }
  const corto = run(cfg, 50, 0, false, false)
  assert.equal(corto.startPoint[0], 20, "50 px de cable → 20 de rabito, no 60")
  assert.ok(corto.startPoint[0] < corto.endPoint[0], "las puntas no se cruzan")

  // Y en vertical NO se apaga: el hueco horizontal es cero pero la distancia no.
  const vertical = run(cfg, 0, 500, false, false)
  assert.equal(vertical.startPoint[0], 60)
})

// Un reroute no es un socket: es un punto de paso. Con rabito a los dos lados
// del punto, el cable salía recta-curva-recta-curva-recta y el bache se veía a
// simple vista. El extremo que toca el nodo sí lo lleva.
test("el rabito es sólo de los extremos que tocan un nodo", () => {
  const cfg = { ...DEFAULTS, stubLength: 20 }

  const ambos = run(cfg, 400, 0, true, true)
  assert.deepEqual(ambos.startPoint, [0, 0],   "sale del punto sin rabito")
  assert.deepEqual(ambos.endPoint,   [400, 0], "entra al punto sin rabito")

  // Tramo nodo → reroute: rabito en el nodo, nada en el punto.
  const mixto = run(cfg, 400, 0, false, true)
  assert.deepEqual(mixto.startPoint, [20, 0])
  assert.deepEqual(mixto.endPoint,   [400, 0])
})

// Con el rabito apagado, la curva tiene que empezar y acabar exactamente en los
// extremos: es lo que hace que los goldens de arriba sigan valiendo.
test("sin rabito los puntos son los extremos", () => {
  const out = run({ ...DEFAULTS }, 300, 120, false, false)
  assert.deepEqual(out.startPoint, [0, 0])
  assert.deepEqual(out.endPoint,   [300, 120])
})

// Un preset es un estilo de CURVA. Si se le cuela una preferencia visual,
// elegir estilo te cambia cosas que no has pedido —y el tamaño del punto de los
// reroutes se reseteaba solo cada vez que tocabas un preset.
test("los presets sólo tocan geometría", () => {
  const NO_GEOMETRIA = ["rerouteRadius", "mode", "simpleRerouteOffset"]
  for (const [name, preset] of Object.entries(PRESETS)) {
    for (const key of NO_GEOMETRIA) {
      assert.ok(!(key in preset), `el preset "${name}" toca ${key}`)
    }
  }
})
