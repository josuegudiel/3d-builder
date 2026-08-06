import {
  Vec2, Vec3, v2, v3, add, sub, mul, dot, cross, length, lengthSq, distance,
  distanceSq, normalize, addScaled, cross2, sub2, distanceSq2,
} from './vec';
import { EPS, clamp } from './tolerance';

/** Rayo con origen y dirección unitaria. */
export interface Ray {
  readonly origin: Vec3;
  readonly dir: Vec3;
}

export function ray(origin: Vec3, dir: Vec3): Ray {
  return { origin, dir: normalize(dir) };
}

export function rayAt(r: Ray, t: number): Vec3 {
  return addScaled(r.origin, r.dir, t);
}

// ---------------------------------------------------------------------------
// Punto ↔ segmento
// ---------------------------------------------------------------------------

/** Parámetro t ∈ [0,1] del punto del segmento AB más cercano a P. */
export function closestParamOnSegment(a: Vec3, b: Vec3, p: Vec3): number {
  const ab = sub(b, a);
  const l2 = lengthSq(ab);
  if (l2 <= 1e-24) return 0;
  return clamp(dot(sub(p, a), ab) / l2, 0, 1);
}

/** Punto del segmento AB más cercano a P. */
export function closestPointOnSegment(a: Vec3, b: Vec3, p: Vec3): Vec3 {
  return addScaled(a, sub(b, a), closestParamOnSegment(a, b, p));
}

export function distanceToSegment(a: Vec3, b: Vec3, p: Vec3): number {
  return distance(p, closestPointOnSegment(a, b, p));
}

/** Punto de la recta infinita AB más cercano a P (sin recortar). */
export function closestPointOnLine(a: Vec3, b: Vec3, p: Vec3): Vec3 {
  const ab = sub(b, a);
  const l2 = lengthSq(ab);
  if (l2 <= 1e-24) return a;
  return addScaled(a, ab, dot(sub(p, a), ab) / l2);
}

export function distanceToLine(a: Vec3, b: Vec3, p: Vec3): number {
  return distance(p, closestPointOnLine(a, b, p));
}

/**
 * ¿Está P sobre el segmento AB (incluidos extremos) dentro de tolerancia?
 */
export function pointOnSegment(a: Vec3, b: Vec3, p: Vec3, eps = EPS): boolean {
  return distanceToSegment(a, b, p) <= eps;
}

/**
 * ¿Está P estrictamente en el interior del segmento AB (excluyendo extremos)?
 * Usado para decidir si una arista debe partirse.
 */
export function pointStrictlyInsideSegment(a: Vec3, b: Vec3, p: Vec3, eps = EPS): boolean {
  if (distanceSq(a, p) <= eps * eps) return false;
  if (distanceSq(b, p) <= eps * eps) return false;
  const ab = sub(b, a);
  const l2 = lengthSq(ab);
  if (l2 <= eps * eps) return false;
  const t = dot(sub(p, a), ab) / l2;
  if (t <= 0 || t >= 1) return false;
  return distance(p, addScaled(a, ab, t)) <= eps;
}

// ---------------------------------------------------------------------------
// Segmento ↔ segmento en 3D
// ---------------------------------------------------------------------------

export interface SegSegResult {
  /** Parámetro sobre el primer segmento. */
  s: number;
  /** Parámetro sobre el segundo segmento. */
  t: number;
  /** Punto más cercano sobre el primer segmento. */
  p1: Vec3;
  /** Punto más cercano sobre el segundo segmento. */
  p2: Vec3;
  /** Distancia mínima entre los segmentos. */
  dist: number;
  /** true si las direcciones son (casi) paralelas. */
  parallel: boolean;
}

/**
 * Distancia mínima entre dos segmentos 3D y los puntos que la realizan.
 * Implementación robusta de Ericson, "Real-Time Collision Detection".
 */
export function closestPointsSegmentSegment(
  p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3,
): SegSegResult {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = lengthSq(d1);
  const e = lengthSq(d2);
  const f = dot(d2, r);

  let s: number;
  let t: number;
  let parallel = false;

  if (a <= 1e-24 && e <= 1e-24) {
    s = 0; t = 0;
  } else if (a <= 1e-24) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = dot(d1, r);
    if (e <= 1e-24) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      // denom ≈ 0 ⇒ segmentos paralelos.
      if (denom > 1e-14 * a * e) {
        s = clamp((b * f - c * e) / denom, 0, 1);
      } else {
        parallel = true;
        s = 0;
      }
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }

  const c1 = addScaled(p1, d1, s);
  const c2 = addScaled(p2, d2, t);
  return { s, t, p1: c1, p2: c2, dist: distance(c1, c2), parallel };
}

/**
 * Intersección "real" de dos segmentos 3D dentro de tolerancia.
 * Devuelve el punto medio de la mínima distancia si los segmentos se cruzan
 * (o casi), o null en caso contrario. No devuelve nada para solapamientos
 * colineales: ese caso lo trata el partidor de aristas por separado.
 */
export function segmentSegmentIntersection(
  p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3, eps = EPS,
): { point: Vec3; s: number; t: number } | null {
  const r = closestPointsSegmentSegment(p1, q1, p2, q2);
  if (r.parallel) return null;
  if (r.dist > eps) return null;
  const point = v3(
    (r.p1.x + r.p2.x) * 0.5,
    (r.p1.y + r.p2.y) * 0.5,
    (r.p1.z + r.p2.z) * 0.5,
  );
  return { point, s: r.s, t: r.t };
}

/** ¿Son colineales dos segmentos (misma recta soporte) dentro de tolerancia? */
export function segmentsCollinear(
  p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3, eps = EPS,
): boolean {
  const d1 = sub(q1, p1);
  if (lengthSq(d1) <= eps * eps) return false;
  return distanceToLine(p1, q1, p2) <= eps && distanceToLine(p1, q1, q2) <= eps;
}

// ---------------------------------------------------------------------------
// Polígonos 2D
// ---------------------------------------------------------------------------

/** Área con signo: positiva si el polígono está en sentido antihorario. */
export function signedArea2(poly: readonly Vec2[]): number {
  let a = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}

/** Perímetro del polígono. */
export function perimeter2(poly: readonly Vec2[]): number {
  let s = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    s += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return s;
}

/** Centroide geométrico (del área) de un polígono simple. */
export function centroid2(poly: readonly Vec2[]): Vec2 {
  const n = poly.length;
  if (n === 0) return v2();
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-18) {
    // Degenerado: media aritmética.
    let sx = 0, sy = 0;
    for (const p of poly) { sx += p.x; sy += p.y; }
    return v2(sx / n, sy / n);
  }
  a *= 0.5;
  return v2(cx / (6 * a), cy / (6 * a));
}

/**
 * ¿Está el punto dentro del polígono? Ray casting con regla par-impar.
 * Los puntos exactamente sobre el borde dan un resultado indefinido, por lo que
 * el llamador debe descartar antes esos casos (`pointOnPolygonBoundary2`).
 */
export function pointInPolygon2(poly: readonly Vec2[], p: Vec2): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y)) {
      const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

/** ¿Está el punto sobre el borde del polígono, dentro de tolerancia? */
export function pointOnPolygonBoundary2(poly: readonly Vec2[], p: Vec2, eps = EPS): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if (distanceToSegment2(a, b, p) <= eps) return true;
  }
  return false;
}

export function distanceToSegment2(a: Vec2, b: Vec2, p: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  if (l2 <= 1e-24) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/**
 * Encuentra un punto estrictamente interior al polígono simple `poly`.
 * Estrategia: probar el centroide; si cae fuera (polígono cóncavo), buscar el
 * punto medio de una diagonal válida de una "oreja".
 */
export function interiorPoint2(poly: readonly Vec2[]): Vec2 | null {
  const n = poly.length;
  if (n < 3) return null;
  const c = centroid2(poly);
  if (pointInPolygon2(poly, c) && !pointOnPolygonBoundary2(poly, c, 1e-12)) return c;

  // Buscar una oreja convexa y devolver el baricentro de su triángulo.
  const area = signedArea2(poly);
  const orient = area >= 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n];
    const b = poly[i];
    const d = poly[(i + 1) % n];
    const convex = orient * cross2(sub2(b, a), sub2(d, b)) > 0;
    if (!convex) continue;
    const cand = v2((a.x + b.x + d.x) / 3, (a.y + b.y + d.y) / 3);
    if (pointInPolygon2(poly, cand) && !pointOnPolygonBoundary2(poly, cand, 1e-12)) return cand;
  }

  // Último recurso: muestreo sobre segmentos que unen puntos medios de aristas.
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const mid = v2((a.x + b.x) / 2, (a.y + b.y) / 2);
    for (let j = i + 1; j < n; j++) {
      const c2 = poly[j];
      const d2 = poly[(j + 1) % n];
      const mid2 = v2((c2.x + d2.x) / 2, (c2.y + d2.y) / 2);
      const cand = v2((mid.x + mid2.x) / 2, (mid.y + mid2.y) / 2);
      if (pointInPolygon2(poly, cand) && !pointOnPolygonBoundary2(poly, cand, 1e-12)) return cand;
    }
  }
  return null;
}

/** Caja envolvente 2D. */
export function bbox2(poly: readonly Vec2[]): { min: Vec2; max: Vec2 } {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of poly) {
    if (p.x < minx) minx = p.x;
    if (p.y < miny) miny = p.y;
    if (p.x > maxx) maxx = p.x;
    if (p.y > maxy) maxy = p.y;
  }
  return { min: v2(minx, miny), max: v2(maxx, maxy) };
}

// ---------------------------------------------------------------------------
// Intersecciones con primitivas 3D (picking)
// ---------------------------------------------------------------------------

/** Intersección rayo-triángulo (Möller–Trumbore). Devuelve t o null. */
export function rayTriangle(r: Ray, a: Vec3, b: Vec3, c: Vec3, cull = false): number | null {
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const pv = cross(r.dir, e2);
  const det = dot(e1, pv);
  if (cull) {
    if (det < 1e-14) return null;
  } else if (Math.abs(det) < 1e-14) {
    return null;
  }
  const invDet = 1 / det;
  const tv = sub(r.origin, a);
  const u = dot(tv, pv) * invDet;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const qv = cross(tv, e1);
  const v = dot(r.dir, qv) * invDet;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  const t = dot(e2, qv) * invDet;
  return t > 1e-9 ? t : null;
}

/** Intersección rayo-plano infinito. */
export function rayPlane(r: Ray, planeN: Vec3, planeD: number): number | null {
  const denom = dot(planeN, r.dir);
  if (Math.abs(denom) < 1e-12) return null;
  const t = (planeD - dot(planeN, r.origin)) / denom;
  return t > 1e-9 ? t : null;
}

/** Caja alineada a ejes. */
export interface Box3 {
  min: Vec3;
  max: Vec3;
}

export function emptyBox(): Box3 {
  return { min: v3(Infinity, Infinity, Infinity), max: v3(-Infinity, -Infinity, -Infinity) };
}

export function boxIsEmpty(b: Box3): boolean {
  return b.min.x > b.max.x || b.min.y > b.max.y || b.min.z > b.max.z;
}

export function expandBox(b: Box3, p: Vec3): Box3 {
  b.min = v3(Math.min(b.min.x, p.x), Math.min(b.min.y, p.y), Math.min(b.min.z, p.z));
  b.max = v3(Math.max(b.max.x, p.x), Math.max(b.max.y, p.y), Math.max(b.max.z, p.z));
  return b;
}

export function unionBox(a: Box3, b: Box3): Box3 {
  if (boxIsEmpty(a)) return { min: b.min, max: b.max };
  if (boxIsEmpty(b)) return { min: a.min, max: a.max };
  return {
    min: v3(Math.min(a.min.x, b.min.x), Math.min(a.min.y, b.min.y), Math.min(a.min.z, b.min.z)),
    max: v3(Math.max(a.max.x, b.max.x), Math.max(a.max.y, b.max.y), Math.max(a.max.z, b.max.z)),
  };
}

export function boxCenter(b: Box3): Vec3 {
  return v3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
}

export function boxSize(b: Box3): Vec3 {
  return v3(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
}

export function boxDiagonal(b: Box3): number {
  if (boxIsEmpty(b)) return 0;
  return length(boxSize(b));
}

export function boxCorners(b: Box3): Vec3[] {
  const { min, max } = b;
  return [
    v3(min.x, min.y, min.z), v3(max.x, min.y, min.z),
    v3(max.x, max.y, min.z), v3(min.x, max.y, min.z),
    v3(min.x, min.y, max.z), v3(max.x, min.y, max.z),
    v3(max.x, max.y, max.z), v3(min.x, max.y, max.z),
  ];
}

// ---------------------------------------------------------------------------
// Utilidades varias
// ---------------------------------------------------------------------------

/** Área de un polígono 3D plano (valor absoluto). */
export function polygonArea3(pts: readonly Vec3[]): number {
  const n = pts.length;
  if (n < 3) return 0;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    nx += a.y * b.z - a.z * b.y;
    ny += a.z * b.x - a.x * b.z;
    nz += a.x * b.y - a.y * b.x;
  }
  return length(v3(nx, ny, nz)) * 0.5;
}

/**
 * Volumen con signo de una malla cerrada dada por triángulos.
 * Positivo si las normales apuntan hacia afuera.
 */
export function meshVolume(triangles: readonly [Vec3, Vec3, Vec3][]): number {
  let vol = 0;
  for (const [a, b, c] of triangles) {
    vol += dot(a, cross(b, c)) / 6;
  }
  return vol;
}

/** Distancia mínima punto-polilínea 2D (para picking en pantalla). */
export function distanceToPolyline2(pts: readonly Vec2[], p: Vec2, closed = false): number {
  let best = Infinity;
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const d = distanceToSegment2(pts[i], pts[(i + 1) % n], p);
    if (d < best) best = d;
  }
  return best;
}

/** ¿Están tres puntos 2D en sentido antihorario? */
export function ccw2(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Distancia al cuadrado entre dos puntos 2D (reexport por comodidad). */
export { distanceSq2 };

/** Cierra un ángulo al rango [0, 2π). */
export function normalizeAngle(a: number): number {
  const tau = Math.PI * 2;
  let x = a % tau;
  if (x < 0) x += tau;
  return x;
}

/** Diferencia angular mínima con signo, en (-π, π]. */
export function angleDelta(from: number, to: number): number {
  const tau = Math.PI * 2;
  let d = (to - from) % tau;
  if (d > Math.PI) d -= tau;
  if (d <= -Math.PI) d += tau;
  return d;
}

/** Interseca dos rectas 2D infinitas; null si son paralelas. */
export function lineLineIntersect2(
  a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2,
): Vec2 | null {
  const d1 = sub2(a1, a0);
  const d2 = sub2(b1, b0);
  const den = cross2(d1, d2);
  if (Math.abs(den) < 1e-18) return null;
  const t = cross2(sub2(b0, a0), d2) / den;
  return v2(a0.x + d1.x * t, a0.y + d1.y * t);
}

/**
 * Círculo que pasa por tres puntos 2D. Devuelve null si son colineales.
 */
export function circleFrom3Points2(a: Vec2, b: Vec2, c: Vec2): { center: Vec2; radius: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-18) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const center = v2(ux, uy);
  return { center, radius: Math.sqrt(distanceSq2(center, a)) };
}

/** Reexports usados por otros módulos del kernel. */
export { add, sub, mul, dot, cross, length, lengthSq, distance, distanceSq, normalize };
