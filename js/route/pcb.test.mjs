import assert from "node:assert/strict"
import { test } from "node:test"
import { beginFrame, emitRoute, fitRadius, laneStub, routeFor, routeStats } from "./pcb.js"

// El motor de ruteo trae sus propios casos de origen; lo que se prueba aquí es
// el adaptador — obstáculos, caché e invalidación—, que es lo nuestro.

const nodo = (x, y, w = 200, h = 100) => ({ pos: [x, y], size: [w, h] })
const grafo = (...nodos) => ({ _nodes: nodos })

// Un rectángulo es "atravesado" si algún tramo de la polilínea le pasa por
// dentro. Los tramos son siempre horizontales o verticales.
function atraviesa(pts, [x, y, w, h]) {
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i]
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx)
    const y0 = Math.min(ay, by), y1 = Math.max(ay, by)
    if (x1 > x && x0 < x + w && y1 > y && y0 < y + h) return true
  }
  return false
}

test("el cable rodea un nodo que se le cruza por delante", () => {
  const caja = [300, -60, 200, 120]
  beginFrame(grafo(nodo(...caja)))
  const pts = routeFor(1, [0, 0], [800, 0])
  assert.ok(pts, "un nodo justo en medio no es el caso trivial: tiene que rutear")
  assert.ok(!atraviesa(pts, caja), `la ruta atraviesa el nodo: ${JSON.stringify(pts)}`)
  // Ortogonal: cada tramo mueve X o Y, nunca los dos.
  for (let i = 1; i < pts.length; i++) {
    const dx = Math.abs(pts[i][0] - pts[i - 1][0])
    const dy = Math.abs(pts[i][1] - pts[i - 1][1])
    assert.ok(dx < 0.01 || dy < 0.01, `tramo diagonal entre ${pts[i - 1]} y ${pts[i]}`)
  }
})

// En su carril el PCB es sustituto completo: nunca devuelve el cable a la
// Bézier, porque ver los dos motores a la vez en la misma pantalla es
// exactamente lo que no debe pasar.
test("un cable despejado sale recto, no curvo", () => {
  beginFrame(grafo(nodo(0, 400)))
  const pts = routeFor(2, [0, 0], [500, 0])
  assert.ok(pts, "sin estorbo tiene que salir un trazado igualmente")
  assert.deepEqual(pts, [[0, 0], [500, 0]], "misma altura: una sola recta")
})

test("mover un nodo invalida las rutas guardadas", () => {
  beginFrame(grafo(nodo(300, -60)))
  const antes = routeFor(3, [0, 0], [800, 0])
  const v1 = routeStats().version

  // Mismo grafo, nada movido: ni sube la versión ni se recalcula.
  beginFrame(grafo(nodo(300, -60)))
  assert.equal(routeStats().version, v1, "un frame sin cambios no debe invalidar nada")
  assert.deepEqual(routeFor(3, [0, 0], [800, 0]), antes)

  // El nodo se aparta del camino: la ruta guardada ya no vale.
  beginFrame(grafo(nodo(300, 400)))
  assert.ok(routeStats().version > v1, "mover un nodo tiene que subir la versión")
  assert.deepEqual(routeFor(3, [0, 0], [800, 0]), [[0, 0], [800, 0]],
    "sin estorbo, recta y sin rodeo")
})

// Al arrastrar, la vista previa tiene que SER el resultado, no parecerse: los
// cables que se han movido se rutean de verdad —esquivando— y los que no, se
// sirven de lo guardado sin gastar una búsqueda.
test("arrastrando, el cable que se mueve esquiva igual que al soltar", () => {
  const enMedio = [300, -60, 200, 120]
  beginFrame(grafo(nodo(...enMedio)))
  const arrastrando = routeFor(98, [0, 0], [800, 0], { pointerDown: true })
  assert.ok(arrastrando, "tiene que salir trazado")
  assert.ok(!atraviesa(arrastrando, enMedio),
    `la vista previa atraviesa el nodo: ${JSON.stringify(arrastrando)}`)
  // Y es exactamente lo que saldría al soltar.
  beginFrame(grafo(nodo(...enMedio)))
  assert.deepEqual(routeFor(98, [0, 0], [800, 0]), arrastrando)
})

test("arrastrando, el cable que no se ha movido conserva su trazado", () => {
  beginFrame(grafo(nodo(300, -60)))
  const antes = routeFor(96, [0, 0], [800, 0])

  // Se mueve OTRO nodo: sube la versión y se invalida todo. Pero este cable
  // tiene los mismos extremos, así que mientras dure el arrastre se le sirve lo
  // que ya tenía en vez de volver a buscarle camino.
  beginFrame(grafo(nodo(300, -60), nodo(0, 2000)))
  assert.deepEqual(routeFor(96, [0, 0], [800, 0], { pointerDown: true }), antes)
})

// ── Carriles ────────────────────────────────────────────────────────────────
//
// Grafo de juguete: un nodo emisor con varias salidas y un receptor por cable,
// colocado a la altura que se pida. La altura del OTRO extremo es lo que decide
// si el cable sube o baja, que es lo que ordena los carriles.
function grafoConSalidas(alturas) {
  const emisor = {
    id: 1,
    outputs: alturas.map((_, j) => ({ links: [10 + j] })),
    inputs: [],
    getConnectionPos: (isInput, j) => [100, 10 * j],
  }
  const nodos = [emisor]
  const links = new Map()
  alturas.forEach((y, j) => {
    nodos.push({
      id: 100 + j, inputs: [{ link: 10 + j }], outputs: [],
      getConnectionPos: () => [500, y],
    })
    links.set(10 + j, { origin_id: 1, origin_slot: j, target_id: 100 + j, target_slot: 0 })
  })
  return {
    _nodes: nodos, _links: links,
    getNodeById: (id) => nodos.find(n => n.id === id),
  }
}

test("cada cable de un lado sale por su propio carril", () => {
  // Cuatro salidas a y = 0, 10, 20, 30. Dos suben (destino por encima) y dos
  // bajan (destino por debajo).
  const g = grafoConSalidas([-200, -100, 400, 500])
  const stubs = [0, 1, 2, 3].map(j => laneStub(g, g.getNodeById(1), false, j))
  assert.equal(new Set(stubs).size, 4, `carriles repetidos: ${stubs}`)
})

test("los que suben van pegados al nodo y los que bajan por detrás", () => {
  // Slots 0 y 1 suben; 2 y 3 bajan.
  const g = grafoConSalidas([-200, -100, 400, 500])
  const s = (j) => laneStub(g, g.getNodeById(1), false, j)
  assert.ok(Math.max(s(0), s(1)) < Math.min(s(2), s(3)),
    "ningún cable que baja debería colarse entre los que suben")
  // Entre los que suben manda el más alto: el slot 0 está por encima del 1.
  assert.ok(s(0) < s(1))
  // Entre los que bajan manda el más bajo: el 3 está por debajo del 2.
  assert.ok(s(3) < s(2))
})

test("un socket suelto se lleva el rabito de siempre", () => {
  const g = grafoConSalidas([-200])
  const suelto = { id: 9, outputs: [{ links: null }], inputs: [], getConnectionPos: () => [0, 0] }
  assert.equal(laneStub(g, suelto, false, 0), laneStub(g, null, false, 0))
})

// ── Esquinas redondeadas ────────────────────────────────────────────────────

test("el radio nunca se pasa de la mitad del lado más corto", () => {
  // Lado corto de 10 px: como mucho 5, aunque se pidan 20. Si se pasara, la
  // curva de esta esquina invadiría la de la siguiente.
  assert.equal(fitRadius([0, 0], [10, 0], [10, 100], 20), 5)
  assert.equal(fitRadius([0, 0], [100, 0], [100, 100], 8), 8, "con sitio de sobra, el que se pide")
  assert.equal(fitRadius([0, 0], [100, 0], [100, 100], 0), 0, "radio 0 = esquina viva")
})

// Un trazo falso que apunta lo que se le pide: así se comprueba lo que se dibuja
// sin necesidad de un canvas.
function trazoFalso() {
  const ops = []
  return {
    ops,
    moveTo: (...a) => ops.push(["moveTo", ...a]),
    lineTo: (...a) => ops.push(["lineTo", ...a]),
    arcTo:  (...a) => ops.push(["arcTo", ...a]),
  }
}

test("cada vértice intermedio se dibuja como esquina, no como recta", () => {
  const t = trazoFalso()
  emitRoute(t, [[0, 0], [100, 0], [100, 100]], 8)
  assert.deepEqual(t.ops[0], ["moveTo", 0, 0])
  assert.deepEqual(t.ops[1], ["arcTo", 100, 0, 100, 100, 8])
  assert.deepEqual(t.ops[2], ["lineTo", 100, 100])
})

test("una recta sin esquinas sigue siendo una recta", () => {
  const t = trazoFalso()
  emitRoute(t, [[0, 0], [500, 0]], 8)
  assert.deepEqual(t.ops, [["moveTo", 0, 0], ["lineTo", 500, 0]])
})

// ── Cintas ──────────────────────────────────────────────────────────────────

// Dos cables del mismo nodo al mismo nodo, con un estorbo en medio que obliga a
// rodear: es donde antes cada uno elegía una L distinta.
function grafoParDoble() {
  const origen = {
    id: 1, inputs: [], outputs: [{ links: [10] }, { links: [11] }],
    getConnectionPos: (isInput, j) => [200, 100 + 30 * j],
    pos: [0, 80], size: [200, 100],
  }
  const destino = {
    id: 2, outputs: [], inputs: [{ link: 10 }, { link: 11 }],
    getConnectionPos: (isInput, j) => [900, 400 + 30 * j],
    pos: [900, 380], size: [200, 100],
  }
  const estorbo = { id: 3, inputs: [], outputs: [], pos: [450, 60], size: [200, 400] }
  const links = new Map([
    [10, { id: 10, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 }],
    [11, { id: 11, origin_id: 1, origin_slot: 1, target_id: 2, target_slot: 1 }],
  ])
  const nodos = [origen, destino, estorbo]
  return { _nodes: nodos, _links: links, getNodeById: (id) => nodos.find(n => n.id === id) }
}

// La forma de un trazado: la secuencia de giros, sin las coordenadas. Dos
// hebras de la misma cinta tienen que girar igual y en el mismo orden.
const forma = (pts) => pts.slice(1).map((p, i) =>
  Math.abs(p[0] - pts[i][0]) < 0.01 ? "V" : "H").join("")

test("los cables entre el mismo par de nodos comparten forma", () => {
  const g = grafoParDoble()
  beginFrame(g)
  const uno = routeFor(10, [200, 100], [900, 400], { graph: g, link: g._links.get(10) })
  const dos = routeFor(11, [200, 130], [900, 430], { graph: g, link: g._links.get(11) })
  assert.equal(forma(uno), forma(dos),
    `cada hermano cogió un camino distinto:\n  ${JSON.stringify(uno)}\n  ${JSON.stringify(dos)}`)
})

test("las hebras van separadas y no se cruzan", () => {
  const g = grafoParDoble()
  beginFrame(g)
  const uno = routeFor(10, [200, 100], [900, 400], { graph: g, link: g._links.get(10) })
  const dos = routeFor(11, [200, 130], [900, 430], { graph: g, link: g._links.get(11) })
  assert.notDeepEqual(uno, dos, "misma forma no es el mismo sitio: van en paralelo")
  // Los tramos intermedios —los que no tocan un socket— tienen que estar
  // separados. Si coincidieran, las dos hebras irían una encima de la otra.
  const medios = (p) => p.slice(1, -1)
  for (const m of medios(uno)) {
    for (const n of medios(dos)) {
      if (Math.abs(m[0] - n[0]) < 0.01 && Math.abs(m[1] - n[1]) < 0.01) {
        assert.fail(`dos hebras comparten el vértice ${JSON.stringify(m)}`)
      }
    }
  }
})

// Que dos hebras no se toquen no basta: tienen que quedar en el orden de sus
// sockets. El cable del socket de ABAJO tiene que seguir por debajo del de
// arriba en todo el recorrido — si se cruzan, la cinta se montó del revés.
// Es lo que pasaba al desplazar por un múltiplo fijo sin mirar hacia qué lado
// caen los sockets.
test("la cinta respeta el orden de los sockets: nadie se cruza", () => {
  const g = grafoParDoble()
  beginFrame(g)
  const arriba = routeFor(10, [200, 100], [900, 400], { graph: g, link: g._links.get(10) })
  const abajo  = routeFor(11, [200, 130], [900, 430], { graph: g, link: g._links.get(11) })

  // Cruce de dos polilíneas ortogonales: un tramo horizontal de una que pasa
  // por encima de un tramo vertical de la otra dentro de los dos rangos.
  const tramos = (p) => p.slice(1).map((q, i) => [p[i], q])
  const corta = (unos, otros) => {
    for (const [a1, a2] of tramos(unos)) {
      if (Math.abs(a1[1] - a2[1]) > 0.01) continue          // sólo horizontales
      const [hx0, hx1] = [Math.min(a1[0], a2[0]), Math.max(a1[0], a2[0])]
      for (const [b1, b2] of tramos(otros)) {
        if (Math.abs(b1[0] - b2[0]) > 0.01) continue        // sólo verticales
        const [vy0, vy1] = [Math.min(b1[1], b2[1]), Math.max(b1[1], b2[1])]
        if (b1[0] > hx0 + 0.01 && b1[0] < hx1 - 0.01 &&
            a1[1] > vy0 + 0.01 && a1[1] < vy1 - 0.01) return [b1[0], a1[1]]
      }
    }
    return null
  }
  const c1 = corta(arriba, abajo), c2 = corta(abajo, arriba)
  assert.equal(c1, null, `se cruzan en ${JSON.stringify(c1)}`)
  assert.equal(c2, null, `se cruzan en ${JSON.stringify(c2)}`)
})

// En Nodes 2.0 `getConnectionPos` devuelve la posición POR DEFECTO del socket,
// que en un nodo alto cae lejos de donde está pintado. Quien pregunta por un
// cable que no es el que se dibuja —los carriles y la plantilla de la cinta—
// se traga ese dato malo. Aquí el nodo miente a propósito: las alturas que da
// están 300 px por debajo de las reales.
test("las alturas vistas al dibujar mandan sobre las que dice el nodo", () => {
  const g = grafoParDoble()
  const destino = g.getNodeById(2)
  destino.getConnectionPos = (isInput, j) => [900, 700 + 30 * j]  // mentira
  beginFrame(g)

  const reales = { 10: [[200, 100], [900, 400]], 11: [[200, 130], [900, 430]] }
  const pinta = (id) => routeFor(id, reales[id][0], reales[id][1],
    { graph: g, link: g._links.get(Number(id)) })

  pinta(10); pinta(11)          // primer frame: aún no hay nada apuntado
  beginFrame({ ...g, _nodes: [...g._nodes, { pos: [0, 0], size: [1, 1] }] }) // algo se mueve
  const uno = pinta(10), dos = pinta(11)

  // Con el dato malo, la plantilla se construye para unos extremos que no
  // existen y las hebras acaban donde no toca. Lo que se comprueba es que el
  // trazado termina donde de verdad está el socket.
  assert.deepEqual(uno.at(-1), [900, 400])
  assert.deepEqual(dos.at(-1), [900, 430])
  assert.equal(forma(uno), forma(dos), "y siguen siendo la misma cinta")
})

// El codo tiene que quedarse cerca del destino aunque el destino se deslice por
// detrás de otro nodo.
//
// Antes no: en cuanto la columna de bajada chocaba con el nodo de encima,
// acercarse al destino pasaba de costar un codo a costar dos, y el recargo por
// codo (24) aplasta el desempate que prefiere bajar cerca del destino (0,25).
// El trazado volcaba entero y el codo aparecía al principio. Se arregla
// apartando el rabito hasta una columna libre, no tocando los precios.
test("el codo no se escapa al principio cuando el destino pasa por detrás de otro nodo", () => {
  const n = (x, y, w, h) => ({ pos: [x, y], size: [w, h] })
  const salida = [322, 133]
  for (const xDestino of [810, 880, 918, 940, 1000, 1100]) {
    beginFrame({ _nodes: [n(40, 95, 290, 340), n(918, 40, 355, 340), n(xDestino, 535, 355, 340)] })
    const pts = routeFor("barrido" + xDestino, salida, [xDestino + 7, 590])
    const codo = pts[1]
    assert.ok(codo[0] - salida[0] > 100,
      `con el destino en x=${xDestino} el codo se fue al principio (x=${codo[0]})`)
  }
})

// El mando de esquivar es la relación entre lo que cuesta atravesar un nodo y
// lo que cuesta cada codo del rodeo. En 1, atravesar sale igual de barato que
// el aire libre y el cable va recto por debajo; alto, rodea.
test("el mando de esquivar decide si el cable pasa por debajo o rodea", () => {
  const enMedio = [300, -60, 200, 120]
  const g = grafo(nodo(...enMedio))

  beginFrame(g, { avoidance: 1 })
  const recto = routeFor("esquiva1", [0, 0], [800, 0])
  assert.ok(atraviesa(recto, enMedio),
    `en 1 el cable debería pasar por debajo: ${JSON.stringify(recto)}`)

  beginFrame(g, { avoidance: 8 })
  const rodeo = routeFor("esquiva8", [0, 0], [800, 0])
  assert.ok(!atraviesa(rodeo, enMedio),
    `en 8 el cable debería rodear: ${JSON.stringify(rodeo)}`)
})

test("mover el mando invalida las rutas guardadas", () => {
  const g = grafo(nodo(300, -60, 200, 120))
  beginFrame(g, { avoidance: 8 })
  const antes = routeFor("mando", [0, 0], [800, 0])
  beginFrame(g, { avoidance: 1 })                      // mismo grafo, otro mando
  const despues = routeFor("mando", [0, 0], [800, 0])
  assert.notDeepEqual(despues, antes, "la ruta guardada no puede sobrevivir al cambio")
})

// ── Pasillos compartidos ────────────────────────────────────────────────────
//
// Ni los carriles ni las cintas cubren a dos cables SIN RELACIÓN que acaban
// bajando por la misma columna: uno va de A a B y otro de C a D, no comparten
// nodo ni par. Se dibujan uno encima de otro y parecen un solo cable.
test("dos cables sin relación no comparten la misma columna", () => {
  // Dos destinos a la misma x: los dos bajan por la columna de su rabito de
  // llegada, que es la misma, y sus alturas se solapan.
  const g = grafo(nodo(0, 900, 50, 50))
  const columna = (pts) => pts.find((p, i) => i > 0 && i < pts.length - 1 &&
    Math.abs(p[0] - pts[i + 1][0]) < 0.01)?.[0]

  beginFrame(g)
  routeFor("pasilloA", [0, 0], [500, 200])
  routeFor("pasilloB", [0, 50], [500, 400])

  // Segundo frame: el reparto trabaja sobre lo dibujado en el anterior.
  beginFrame(g)
  const a = routeFor("pasilloA", [0, 0], [500, 200])
  const b = routeFor("pasilloB", [0, 50], [500, 400])

  const ca = columna(a), cb = columna(b)
  assert.ok(ca != null && cb != null, "los dos deberían tener un tramo vertical")
  assert.ok(Math.abs(ca - cb) > 4,
    `los dos bajan por la misma columna (${ca} y ${cb})`)
  // Y siguen llegando a su socket.
  assert.deepEqual(a.at(-1), [500, 200])
  assert.deepEqual(b.at(-1), [500, 400])
})

// El reparto es una decisión de conjunto y corre una vez por frame, así que no
// alcanza a los cables que se recalculan DESPUÉS —los del nodo que arrastras—.
// Durante el arrastre se juntaban otra vez en la misma columna y sólo se
// separaban al soltar. Se arregla reutilizando la separación de la forma
// anterior, no repartiendo por cable.
test("la separación aguanta mientras se arrastra", () => {
  const columna = (pts) => pts.find((p, i) => i > 0 && i < pts.length - 1 &&
    Math.abs(p[0] - pts[i + 1][0]) < 0.01)?.[0]
  const escena = (extra) => ({
    _nodes: [nodo(0, 900, 50, 50), ...(extra ? [nodo(0, 2000, 10, 10)] : [])],
  })

  beginFrame(escena())
  routeFor("dragA", [0, 0], [500, 200])
  routeFor("dragB", [0, 50], [500, 400])
  beginFrame(escena())                       // aquí corre el reparto
  const quietoA = columna(routeFor("dragA", [0, 0], [500, 200]))
  const quietoB = columna(routeFor("dragB", [0, 50], [500, 400]))
  assert.ok(Math.abs(quietoA - quietoB) > 4, "de partida tienen que estar separados")

  // Arrastre: otro nodo se mueve (sube la versión) y los extremos cambian, así
  // que estos dos se recalculan enteros.
  beginFrame(escena(true))
  const a = columna(routeFor("dragA", [0, 4], [500, 204], { pointerDown: true }))
  const b = columna(routeFor("dragB", [0, 54], [500, 404], { pointerDown: true }))
  assert.ok(Math.abs(a - b) > 4,
    `arrastrando se han vuelto a juntar (${a} y ${b})`)
})

// Apagar el reparto no puede dejar los cables desplazados a medias: los
// desplazamientos ya aplicados tienen que deshacerse.
test("el reparto se puede apagar y los cables vuelven a su sitio", () => {
  const g = grafo(nodo(0, 900, 50, 50))
  const columna = (pts) => pts.find((p, i) => i > 0 && i < pts.length - 1 &&
    Math.abs(p[0] - pts[i + 1][0]) < 0.01)?.[0]

  beginFrame(g)
  routeFor("offA", [0, 0], [500, 200]); routeFor("offB", [0, 50], [500, 400])
  beginFrame(g)
  const conA = columna(routeFor("offA", [0, 0], [500, 200]))
  const conB = columna(routeFor("offB", [0, 50], [500, 400]))
  assert.ok(Math.abs(conA - conB) > 4, "encendido tienen que ir separados")

  beginFrame(g, { spread: false })
  const sinA = columna(routeFor("offA", [0, 0], [500, 200]))
  const sinB = columna(routeFor("offB", [0, 50], [500, 400]))
  assert.equal(sinA, sinB, `apagado deberían compartir columna (${sinA} y ${sinB})`)
})
