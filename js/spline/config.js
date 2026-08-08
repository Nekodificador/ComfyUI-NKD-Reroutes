// Configuración del motor de splines: valores por defecto, presets y el mapa
// de ajustes de ComfyUI. Vive aquí y no en rerouteSplines.js porque el
// laboratorio (js/lab.html) importa esto mismo — una sola copia, sin deriva.
//
// DEFAULTS no se parte en "geometría" y "magnetismo": applyConfig, el reset y
// SETTING_ID_MAP recorren el objeto entero.

export const DEFAULTS = Object.freeze({
  mode:                     "Simple",
  pcbEnabled:               false,  // ruteo ortogonal en vez de Bézier
  cornerRadius:             8,      // redondeo de las esquinas del ruteo, en px
  simpleRerouteOffset:      40,
  minSplineOffset:          10,
  handleFactor:             1.0,
  nodeFactor:               1.0,
  rerouteFactor:            0.8,
  rerouteRadius:            5,
  nonLinear:                1.15,  // >1 = los cables largos se abren más
  // Las tres de abajo eran constantes dentro de la fórmula. Se exponen para
  // poder juzgarlas en el laboratorio; su valor por defecto es el de siempre,
  // salvo distFactor, que es nuevo y en 0 no hace nada.
  crossingMargin:           120,   // media ventana de la mezcla adelante↔atrás, en px
  backwardStretch:          0.25,  // cuánto crece el bucle de vuelta con la distancia
  maxHandleRatio:           0.5,   // techo del handle como fracción del hueco horizontal (0 = sin techo)
  distFactor:               0.25,  // handle a 500 px como fracción de la distancia (0.25 = ley nativa)
  inversionPull:            40,
  stubLength:               0,     // tramo recto al salir del socket, en px (0 = sin rabito)
  invertBackward:           true,
  nodeBodyClearance:        24,
  magnetEnabled:            true,
  magnetRadius:             20,
  magnetGapX:               36,
  magnetGapY:               12,
  magnetGuides:             true,
  magnetMatchWidth:         true,
})

// Lo que un preset NO guarda: preferencias visuales y ajustes de otra capa.
// De aquí sale PRESET_KEYS, que es lo que se copia al guardar los ajustes
// actuales como preset propio.
// pcbEnabled no es geometría de la curva: es ELEGIR RENDERIZADOR. Si entrase en
// los presets, cargar un estilo de cable te sacaría del modo PCB sin pedirlo.
const NO_ES_GEOMETRIA = new Set([
  "rerouteRadius", "mode", "simpleRerouteOffset", "pcbEnabled", "cornerRadius",
  "magnetEnabled", "magnetRadius", "magnetGapX", "magnetGapY",
  "magnetGuides", "magnetMatchWidth",
])

export const PRESET_KEYS = Object.keys(DEFAULTS).filter(k => !NO_ES_GEOMETRIA.has(k))

// Los presets tocan SÓLO la geometría de la curva. El tamaño del punto de un
// reroute no entra: es una preferencia visual independiente, y colarla aquí
// hacía que elegir un estilo de cable te cambiara el tamaño de los puntos sin
// haberlo pedido.
export const PRESETS = {
  // La fórmula del frontend nativo, exacta: handle = distancia · 0.25 en la
  // dirección del socket, sin suelos, sin topes, sin reglas de ángulo y sin
  // caso especial hacia atrás —el bucle sale solo de la geometría—. Antes esto
  // era una aproximación por smoothstep que se iba varias veces en los cables
  // verticales; con distFactor y backwardStretch se puede reproducir tal cual.
  // Sirve de referencia: es lo que ves si desinstalas la extensión.
  "Classic Comfy": {
    handleFactor:             0.25,
    nodeFactor:               1.0,
    rerouteFactor:            1.0,
    nonLinear:                1.0,
    distFactor:               1.0,
    backwardStretch:          1.0,
    maxHandleRatio:           0,
    minSplineOffset:          0,
    inversionPull:            0,
    stubLength:               0,
    invertBackward:           false,
    nodeBodyClearance:        0,
  },
}

// Usado al aplicar un preset o una config del laboratorio, para sincronizar la
// UI de ajustes de ComfyUI.
export const SETTING_ID_MAP = {
  "NKD Reroutes.Mode":                   "mode",
  "NKD Reroutes.PcbEnabled":             "pcbEnabled",
  "NKD Reroutes.CornerRadius":           "cornerRadius",
  "NKD Reroutes.SimpleRerouteOffset":    "simpleRerouteOffset",
  "NKD Reroutes.WireCurvature":          "handleFactor",
  "NKD Reroutes.NodePull":               "nodeFactor",
  "NKD Reroutes.ReroutePull":            "rerouteFactor",
  "NKD Reroutes.RerouteDotSize":           "rerouteRadius",
  "NKD Reroutes.NonLinear":             "nonLinear",
  "NKD Reroutes.DistFactor":            "distFactor",
  "NKD Reroutes.MinHandle":             "minSplineOffset",
  "NKD Reroutes.MaxHandleRatio":        "maxHandleRatio",
  "NKD Reroutes.CrossingMargin":        "crossingMargin",
  "NKD Reroutes.BackwardStretch":       "backwardStretch",
  "NKD Reroutes.InversionPull":         "inversionPull",
  "NKD Reroutes.StubLength":            "stubLength",
  "NKD Reroutes.InvertBackward":        "invertBackward",
  "NKD Reroutes.NodeBodyClearance":     "nodeBodyClearance",
  "NKD Reroutes.MagnetEnabled":    "magnetEnabled",
  "NKD Reroutes.MagnetRadius":     "magnetRadius",
  "NKD Reroutes.MagnetGapX":       "magnetGapX",
  "NKD Reroutes.MagnetGapY":       "magnetGapY",
  "NKD Reroutes.MagnetGuides":     "magnetGuides",
  "NKD Reroutes.MagnetMatchWidth": "magnetMatchWidth",
}
