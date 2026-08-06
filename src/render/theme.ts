/** Paleta y estilos visuales de la aplicación. */

export const THEME = {
  /** Fondo del cielo (degradado superior). */
  skyTop: '#c9dcf0',
  skyBottom: '#eef3f8',
  /** Color del suelo bajo el horizonte. */
  ground: '#e6e2da',

  /** Cara frontal por defecto. */
  faceFront: '#f4f2ee',
  /** Cara trasera por defecto (azulado, como en SketchUp). */
  faceBack: '#9fb4c7',

  edge: '#2c2c2c',
  profile: '#1a1a1a',
  softEdge: '#8a8a8a',

  selection: '#2f7bd6',
  selectionFace: '#5b9be0',
  highlight: '#ff9f1c',

  axisX: '#d1462f',
  axisY: '#2f9e44',
  axisZ: '#3b6ea5',
  axisXLight: '#e9a79c',
  axisYLight: '#9fd3ad',
  axisZLight: '#a3bcd6',

  grid: '#b2b2a8',
  gridMajor: '#83837a',

  inferenceEndpoint: '#1a9c3c',
  inferenceMidpoint: '#3aa8d8',
  inferenceIntersection: '#d14a9c',
  inferenceOnEdge: '#d14a9c',
  inferenceOnFace: '#3b6ea5',
  inferenceCenter: '#1a9c3c',
  inferenceParallel: '#c060c0',
  inferencePerpendicular: '#c060c0',

  guide: '#7a7a7a',
  dimension: '#333333',
} as const;

/** Anchuras de línea en píxeles. */
export const LINE_WIDTH = {
  edge: 1.5,
  profile: 2.6,
  selected: 2.8,
  guide: 1.2,
  preview: 1.8,
} as const;

/** Radios de captura en píxeles para el enganche (inferencia). */
export const SNAP_PIXELS = {
  vertex: 12,
  edge: 9,
  axis: 8,
  face: 0,
} as const;

/** Convierte "#rrggbb" a entero 0xrrggbb. */
export function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}
