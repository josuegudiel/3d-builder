/**
 * Tolerancias globales del kernel geométrico.
 *
 * La unidad interna del modelo es el METRO. Todas las longitudes almacenadas en
 * el modelo están en metros; la conversión a/desde mm, cm, pulgadas, pies, etc.
 * ocurre únicamente en la capa de unidades (`core/units.ts`).
 *
 * Elegir el metro como unidad interna mantiene las coordenadas típicas en el
 * rango 1e-3 .. 1e3, lo que conserva precisión tanto en float64 (kernel) como
 * en float32 (buffers de GPU).
 */

/** Distancia por debajo de la cual dos puntos se consideran el mismo punto (1 micra). */
export const EPS = 1e-6;

/** Tolerancia al cuadrado, para comparar distancias sin raíz cuadrada. */
export const EPS2 = EPS * EPS;

/** Tolerancia angular en radianes (~0.0000573°). Usada para paralelismo/perpendicularidad. */
export const ANG_EPS = 1e-6;

/** Tolerancia usada para decidir si un punto pertenece a un plano. */
export const PLANE_EPS = 1e-6;

/** Área mínima para que un bucle cerrado genere una cara (1e-10 m² = 0.0001 mm²). */
export const AREA_EPS = 1e-10;

/**
 * Tamaño de celda para el "welding" (fusión) de vértices coincidentes.
 * Debe ser >= EPS para que el hash espacial encuentre los vecinos correctos.
 */
export const WELD_GRID = EPS;

/** ¿Son iguales dos escalares dentro de tolerancia? */
export function eq(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) <= eps;
}

/** ¿Es prácticamente cero? */
export function isZero(a: number, eps = EPS): boolean {
  return Math.abs(a) <= eps;
}

/** Signo con zona muerta: -1, 0 o 1. */
export function sgn(a: number, eps = EPS): -1 | 0 | 1 {
  if (a > eps) return 1;
  if (a < -eps) return -1;
  return 0;
}

/** Limita `v` al rango [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Interpolación lineal. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Redondea a un múltiplo de `step`. Se usa para construir claves estables de
 * hash espacial y para el "snap" a rejilla.
 */
export function quantize(v: number, step: number): number {
  return Math.round(v / step) * step;
}

/** Elimina el -0 que aparece al redondear valores negativos muy pequeños. */
export function unsignedZero(v: number): number {
  return v === 0 ? 0 : v;
}
