import { EPS, EPS2, clamp } from './tolerance';

/** Punto/vector 3D inmutable por convención (las funciones devuelven objetos nuevos). */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Punto/vector 2D. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export function v3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function v2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export const ZERO3: Vec3 = Object.freeze(v3(0, 0, 0));
/** Eje rojo de SketchUp (X). */
export const AXIS_X: Vec3 = Object.freeze(v3(1, 0, 0));
/** Eje verde de SketchUp (Y). */
export const AXIS_Y: Vec3 = Object.freeze(v3(0, 1, 0));
/** Eje azul de SketchUp (Z, vertical). */
export const AXIS_Z: Vec3 = Object.freeze(v3(0, 0, 1));

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function mul(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function neg(a: Vec3): Vec3 {
  return { x: -a.x, y: -a.y, z: -a.z };
}

/** a + b * s — muy usado, evita crear temporales. */
export function addScaled(a: Vec3, b: Vec3, s: number): Vec3 {
  return { x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function lengthSq(a: Vec3): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

/**
 * Módulo del vector. Usa la ruta rápida (raíz de la suma de cuadrados) y sólo
 * recurre a `Math.hypot` cuando ésta desbordaría o se anularía por
 * subdesbordamiento, lo que ocurre con componentes por debajo de ~1e-154 o por
 * encima de ~1e154.
 */
export function length(a: Vec3): number {
  const l2 = lengthSq(a);
  if (l2 > 0 && Number.isFinite(l2)) return Math.sqrt(l2);
  return Math.hypot(a.x, a.y, a.z);
}

export function distanceSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.sqrt(distanceSq(a, b));
}

/**
 * Normaliza; devuelve el vector cero sólo si el vector es exactamente nulo.
 * Los vectores extremadamente pequeños o grandes se reescalan antes de dividir
 * para no perder la dirección por subdesbordamiento.
 */
export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  if (l > 0 && Number.isFinite(l) && l >= 1e-300) {
    const inv = 1 / l;
    return { x: a.x * inv, y: a.y * inv, z: a.z * inv };
  }
  const m = Math.max(Math.abs(a.x), Math.abs(a.y), Math.abs(a.z));
  if (m === 0 || !Number.isFinite(m)) return ZERO3;
  const x = a.x / m;
  const y = a.y / m;
  const z = a.z / m;
  const l2 = Math.hypot(x, y, z);
  if (l2 === 0) return ZERO3;
  return { x: x / l2, y: y / l2, z: z / l2 };
}

/** Normaliza o devuelve `fallback` si el vector es degenerado. */
export function normalizeOr(a: Vec3, fallback: Vec3): Vec3 {
  const l = length(a);
  if (l <= EPS) return fallback;
  const inv = 1 / l;
  return { x: a.x * inv, y: a.y * inv, z: a.z * inv };
}

export function lerpV(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function midpoint(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5, z: (a.z + b.z) * 0.5 };
}

/** ¿Están dos puntos dentro de la tolerancia de posición? */
export function nearlyEqual(a: Vec3, b: Vec3, eps = EPS): boolean {
  return distanceSq(a, b) <= eps * eps;
}

/** Comparación exacta al cuadrado con la tolerancia por defecto. */
export function samePoint(a: Vec3, b: Vec3): boolean {
  return distanceSq(a, b) <= EPS2;
}

/** ¿Son paralelos (o antiparalelos) dos vectores? Asume vectores no nulos. */
export function isParallel(a: Vec3, b: Vec3, eps = 1e-9): boolean {
  const c = cross(a, b);
  const denom = lengthSq(a) * lengthSq(b);
  if (denom < 1e-300) return false;
  return lengthSq(c) / denom <= eps * eps;
}

/** ¿Son perpendiculares? Asume vectores no nulos. */
export function isPerpendicular(a: Vec3, b: Vec3, eps = 1e-9): boolean {
  const d = dot(a, b);
  const denom = Math.sqrt(lengthSq(a) * lengthSq(b));
  if (denom < 1e-300) return false;
  return Math.abs(d) / denom <= eps;
}

/** Ángulo sin signo entre dos vectores, en radianes [0, π]. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const la = length(a);
  const lb = length(b);
  if (la < 1e-300 || lb < 1e-300) return 0;
  return Math.acos(clamp(dot(a, b) / (la * lb), -1, 1));
}

/**
 * Ángulo con signo de `a` hacia `b` medido alrededor de `axis` (regla de la mano
 * derecha), en radianes (-π, π].
 */
export function signedAngle(a: Vec3, b: Vec3, axis: Vec3): number {
  const n = normalize(axis);
  const ap = sub(a, mul(n, dot(a, n)));
  const bp = sub(b, mul(n, dot(b, n)));
  if (lengthSq(ap) < 1e-24 || lengthSq(bp) < 1e-24) return 0;
  const s = dot(cross(ap, bp), n);
  const c = dot(ap, bp);
  return Math.atan2(s, c);
}

/** Devuelve un vector unitario perpendicular a `n` (elección estable). */
export function anyPerpendicular(n: Vec3): Vec3 {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  // Elegimos el eje canónico menos alineado con n para evitar cancelaciones.
  const helper = ax <= ay && ax <= az ? AXIS_X : ay <= az ? AXIS_Y : AXIS_Z;
  return normalize(cross(n, helper));
}

/** Rota `v` alrededor del eje unitario `axis` un ángulo `ang` (Rodrigues). */
export function rotateAround(v: Vec3, axis: Vec3, ang: number): Vec3 {
  const k = normalize(axis);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const kv = cross(k, v);
  const kd = dot(k, v);
  return {
    x: v.x * c + kv.x * s + k.x * kd * (1 - c),
    y: v.y * c + kv.y * s + k.y * kd * (1 - c),
    z: v.z * c + kv.z * s + k.z * kd * (1 - c),
  };
}

/** Componente a componente: mínimo. */
export function minV(a: Vec3, b: Vec3): Vec3 {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) };
}

/** Componente a componente: máximo. */
export function maxV(a: Vec3, b: Vec3): Vec3 {
  return { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) };
}

/** Componente a componente: valor absoluto. */
export function absV(a: Vec3): Vec3 {
  return { x: Math.abs(a.x), y: Math.abs(a.y), z: Math.abs(a.z) };
}

/** ¿Contiene algún NaN o infinito? */
export function isFiniteV(a: Vec3): boolean {
  return Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);
}

export function cloneV(a: Vec3): Vec3 {
  return { x: a.x, y: a.y, z: a.z };
}

export function toArray(a: Vec3): [number, number, number] {
  return [a.x, a.y, a.z];
}

export function fromArray(a: readonly number[]): Vec3 {
  return { x: a[0] ?? 0, y: a[1] ?? 0, z: a[2] ?? 0 };
}

// ---------------------------------------------------------------------------
// Operaciones 2D (usadas por el subdivisor planar)
// ---------------------------------------------------------------------------

export function add2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function mul2(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

export function dot2(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** Producto cruzado 2D (componente z del cruce 3D). */
export function cross2(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function length2(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function distance2(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceSq2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function normalize2(a: Vec2): Vec2 {
  const l = length2(a);
  if (l < 1e-300) return { x: 0, y: 0 };
  return { x: a.x / l, y: a.y / l };
}

export function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
