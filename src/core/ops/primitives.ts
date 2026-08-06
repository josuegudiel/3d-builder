/**
 * Primitivas geométricas: generadores PUROS de puntos 3D.
 *
 * Ninguna función de este módulo toca la `Geometry`; se limitan a producir
 * listas de puntos (en METROS) que las herramientas insertan después con
 * `drawPolyline`. Todas son deterministas, sin efectos secundarios y no lanzan
 * excepciones: ante entradas degeneradas (radio nulo, puntos colineales, menos
 * de tres lados...) devuelven `[]` o `null`.
 */

import {
  Vec3, v2, v3, add, sub, mul, dot, cross, normalize, length, lengthSq,
  addScaled, lerpV, minV, maxV, anyPerpendicular, AXIS_X, AXIS_Z,
} from '../math/vec';
import { EPS, ANG_EPS, clamp } from '../math/tolerance';
import { circleFrom3Points2, normalizeAngle } from '../math/geom';

// ---------------------------------------------------------------------------
// Marco de trabajo (base ortonormal de un plano)
// ---------------------------------------------------------------------------

/**
 * Base ortonormal derecha de un plano: `u × v = n`.
 * Es estructuralmente compatible con `PlaneBasis` de `math/plane.ts`.
 */
export interface PlaneFrame {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  n: Vec3;
}

/** Umbral de coseno para considerar que la normal coincide con un eje. */
const AXIS_COS = 1 - 1e-9;

/**
 * Base ortonormal determinista para el plano que pasa por `origin` con normal
 * `normal`.
 *
 * Reglas (imitan el comportamiento de SketchUp, donde el rectángulo dibujado
 * sobre el suelo sale alineado con los ejes rojo/verde):
 *  - normal ≈ ±Z (plano horizontal) → u = X global, v = ±Y.
 *  - resto de planos → u = normalize(Z × n), es decir, la recta HORIZONTAL del
 *    plano; entonces v = n × u apunta siempre "hacia arriba" (v.z > 0). Para
 *    normal ≈ ±X esto da u = ±Y y v = Z, tal y como se espera del plano YZ.
 *  - `hintU` (si es utilizable) manda sobre todo lo anterior: se proyecta al
 *    plano y se normaliza. Sirve para alinear un rectángulo con una arista
 *    existente.
 *
 * Una normal degenerada (vector nulo) se sustituye por Z para no lanzar.
 */
export function frameFromNormal(origin: Vec3, normal: Vec3, hintU?: Vec3): PlaneFrame {
  let n = normalize(normal);
  if (lengthSq(n) <= 0.5) n = AXIS_Z; // normal degenerada: plano horizontal

  if (hintU) {
    // Componente de la pista contenida en el plano (Gram-Schmidt).
    const proj = sub(hintU, mul(n, dot(hintU, n)));
    if (length(proj) > EPS) {
      const u = normalize(proj);
      return { origin, u, v: cross(n, u), n };
    }
  }

  const u = Math.abs(dot(n, AXIS_Z)) >= AXIS_COS
    ? AXIS_X
    : normalize(cross(AXIS_Z, n));
  return { origin, u, v: cross(n, u), n };
}

/** Coordenadas 2D de un punto en la base del marco (proyección ortogonal). */
function toLocal(f: PlaneFrame, p: Vec3): { u: number; v: number } {
  const d = sub(p, f.origin);
  return { u: dot(d, f.u), v: dot(d, f.v) };
}

/** Punto 3D a partir de coordenadas locales del marco. */
function fromLocal(f: PlaneFrame, cu: number, cv: number): Vec3 {
  return add(f.origin, add(mul(f.u, cu), mul(f.v, cv)));
}

/** ¿Es un número finito y estrictamente mayor que la tolerancia? */
function isPositive(x: number): boolean {
  return Number.isFinite(x) && x > EPS;
}

/** Convierte a número entero de tramos; devuelve 0 si el valor no sirve. */
function toSegments(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const n = Math.floor(x);
  return n > 0 ? n : 0;
}

// ---------------------------------------------------------------------------
// Rectángulos
// ---------------------------------------------------------------------------

/**
 * Rectángulo definido por dos esquinas opuestas, con los lados paralelos a
 * `frame.u` / `frame.v`. Las esquinas se proyectan al plano del marco.
 *
 * El resultado se devuelve siempre en sentido antihorario respecto de
 * `frame.n` (área con signo positiva), sea cual sea el orden de las esquinas:
 * así la cara resultante tiene una orientación coherente.
 */
export function rectanglePoints(frame: PlaneFrame, corner0: Vec3, corner1: Vec3): Vec3[] {
  const a = toLocal(frame, corner0);
  const b = toLocal(frame, corner1);
  const du = b.u - a.u;
  const dv = b.v - a.v;
  // Un lado nulo no genera rectángulo.
  if (!(Math.abs(du) > EPS) || !(Math.abs(dv) > EPS)) return [];

  const pts = [
    fromLocal(frame, a.u, a.v),
    fromLocal(frame, b.u, a.v),
    fromLocal(frame, b.u, b.v),
    fromLocal(frame, a.u, b.v),
  ];
  // El área con signo local vale du·dv; si es negativa invertimos el recorrido.
  return du * dv > 0 ? pts : pts.reverse();
}

/**
 * Rectángulo exacto `width × height` a partir de una esquina, medido sobre
 * `frame.u` y `frame.v`. Es la versión que usa el cuadro de medidas (escribir
 * "3;2" tras arrastrar). Admite medidas negativas para invertir el sentido.
 */
export function rectangleFromSize(
  frame: PlaneFrame, origin: Vec3, width: number, height: number,
): Vec3[] {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return [];
  if (!(Math.abs(width) > EPS) || !(Math.abs(height) > EPS)) return [];
  const du = mul(frame.u, width);
  const dv = mul(frame.v, height);
  const pts = [origin, add(origin, du), add(add(origin, du), dv), add(origin, dv)];
  return width * height > 0 ? pts : pts.reverse();
}

/**
 * Rectángulo girado (herramienta "Rectángulo girado"):
 *  - `p0 → p1` define el primer lado (y por tanto el giro dentro del plano).
 *  - `p2` fija la profundidad, medida PERPENDICULARMENTE a ese lado.
 * El resultado tiene los cuatro ángulos rectos por construcción, aunque `p2`
 * no esté alineado.
 */
export function rotatedRectanglePoints(
  frame: PlaneFrame, p0: Vec3, p1: Vec3, p2: Vec3,
): Vec3[] {
  const n = frame.n;
  const raw = sub(p1, p0);
  // Primer lado proyectado al plano (garantiza que el rectángulo sea plano).
  const sideA = sub(raw, mul(n, dot(raw, n)));
  const la = length(sideA);
  if (!(la > EPS)) return [];
  const dir = mul(sideA, 1 / la);
  const perp = cross(n, dir); // unitario y contenido en el plano
  const depth = dot(sub(p2, p1), perp);
  if (!(Math.abs(depth) > EPS)) return [];
  const sideB = mul(perp, depth);
  const q1 = add(p0, sideA);
  return [p0, q1, add(q1, sideB), add(p0, sideB)];
}

// ---------------------------------------------------------------------------
// Círculos y polígonos regulares
// ---------------------------------------------------------------------------

/**
 * Vértices de un círculo teselado. Igual que en SketchUp, `radius` es el radio
 * del círculo CIRCUNSCRITO al polígono, es decir, la distancia del centro a
 * cada vértice: el polígono dibujado queda por dentro del círculo teórico y su
 * área es menor que π·r².
 *
 * Devuelve exactamente `segments` puntos (el polígono es cerrado, el último
 * vértice NO repite el primero). `startDir` fija el vértice inicial.
 */
export function circlePoints(
  center: Vec3, normal: Vec3, radius: number, segments: number, startDir?: Vec3,
): Vec3[] {
  const n = toSegments(segments);
  if (n < 3 || !isPositive(radius)) return [];
  if (lengthSq(normalize(normal)) <= 0.5) return []; // normal degenerada
  const f = frameFromNormal(center, normal, startDir);
  const step = (Math.PI * 2) / n;
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = i * step;
    out.push(fromLocal(f, radius * Math.cos(a), radius * Math.sin(a)));
  }
  return out;
}

/**
 * Polígono regular de `sides` lados.
 *  - `inscribed = true`: el polígono está INSCRITO en la circunferencia de
 *    radio `radius`; `radius` es la distancia a los vértices (circunradio).
 *  - `inscribed = false`: el polígono CIRCUNSCRIBE la circunferencia; `radius`
 *    es la apotema (distancia a los puntos medios de los lados). Como la
 *    apotema vale R·cos(π/n), el circunradio necesario es R = a / cos(π/n).
 */
export function polygonPoints(
  center: Vec3, normal: Vec3, radius: number, sides: number,
  inscribed: boolean, startDir?: Vec3,
): Vec3[] {
  const n = toSegments(sides);
  if (n < 3 || !isPositive(radius)) return [];
  const circum = inscribed ? radius : radius / Math.cos(Math.PI / n);
  return circlePoints(center, normal, circum, n, startDir);
}

// ---------------------------------------------------------------------------
// Arcos
// ---------------------------------------------------------------------------

/**
 * Arco de `segments` tramos ⇒ `segments + 1` puntos, empezando en la
 * proyección de `startPoint` sobre el plano del arco.
 *
 * `sweepAngle` en radianes, positivo en sentido antihorario alrededor de
 * `normal` (regla de la mano derecha).
 */
export function arcPoints(
  center: Vec3, normal: Vec3, startPoint: Vec3, sweepAngle: number, segments: number,
): Vec3[] {
  const segs = toSegments(segments);
  if (segs < 1) return [];
  if (!Number.isFinite(sweepAngle) || Math.abs(sweepAngle) <= ANG_EPS) return [];
  if (lengthSq(normalize(normal)) <= 0.5) return []; // normal degenerada

  // El marco se alinea con el punto inicial: u apunta del centro al inicio.
  const f = frameFromNormal(center, normal, sub(startPoint, center));
  const d = sub(startPoint, center);
  const inPlane = sub(d, mul(f.n, dot(d, f.n)));
  const r = length(inPlane);
  if (!(r > EPS)) return [];

  const out: Vec3[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = (sweepAngle * i) / segs;
    out.push(fromLocal(f, r * Math.cos(a), r * Math.sin(a)));
  }
  return out;
}

/** Resultado de `arcFrom3Points`. */
export interface Arc3Points {
  points: Vec3[];
  center: Vec3;
  radius: number;
  normal: Vec3;
}

/**
 * Arco que pasa por tres puntos: `p1` y `p3` son los extremos y `p2` un punto
 * intermedio que decide por qué lado va el arco (y si es menor o mayor que una
 * semicircunferencia).
 *
 * Método: el plano del arco es el de los tres puntos; se proyectan a 2D y se
 * calcula el circuncentro (intersección de las mediatrices, resuelta de forma
 * cerrada en `circleFrom3Points2`). Después se recorre desde el ángulo de `p1`
 * hasta el de `p3` en el sentido que pasa por `p2`.
 *
 * Devuelve `null` si los puntos son colineales o coincidentes.
 */
export function arcFrom3Points(
  p1: Vec3, p2: Vec3, p3: Vec3, segments: number,
): Arc3Points | null {
  const segs = toSegments(segments);
  if (segs < 1) return null;

  const e2 = sub(p2, p1);
  const e3 = sub(p3, p1);
  const nRaw = cross(e2, e3);
  // Criterio de colinealidad relativo al tamaño (igual que planeFrom3Points).
  const scale = Math.max(lengthSq(e2), lengthSq(e3), 1e-12);
  if (lengthSq(nRaw) <= 1e-14 * scale * scale) return null;
  const normal = normalize(nRaw);

  // Marco con origen en p1: sus coordenadas locales son (0, 0).
  const f = frameFromNormal(p1, normal);
  const b = toLocal(f, p2);
  const c = toLocal(f, p3);
  const circ = circleFrom3Points2(v2(0, 0), v2(b.u, b.v), v2(c.u, c.v));
  if (!circ) return null;
  const radius = circ.radius;
  if (!isPositive(radius)) return null;
  const center = fromLocal(f, circ.center.x, circ.center.y);

  // Ángulos alrededor del centro, en el plano local.
  const a1 = Math.atan2(-circ.center.y, -circ.center.x);
  const a2 = Math.atan2(b.v - circ.center.y, b.u - circ.center.x);
  const a3 = Math.atan2(c.v - circ.center.y, c.u - circ.center.x);
  const d2 = normalizeAngle(a2 - a1); // avance antihorario hasta p2 ∈ [0, 2π)
  const d3 = normalizeAngle(a3 - a1); // avance antihorario hasta p3 ∈ [0, 2π)
  // Si p2 se encuentra antes que p3 girando en positivo, el arco es antihorario.
  const sweep = d2 < d3 ? d3 : d3 - Math.PI * 2;

  const points = arcPoints(center, normal, p1, sweep, segs);
  if (points.length === 0) return null;
  return { points, center, radius, normal };
}

/**
 * Arco definido por cuerda + comba (los "2 puntos + flecha" de la herramienta
 * Arco de SketchUp). `bulge` es la distancia perpendicular del punto medio del
 * arco a la cuerda; su signo elige el lado, medido sobre `normal × cuerda`.
 *
 * Como la flecha `s` y la semicuerda `a` determinan el radio
 * (R = (a² + s²) / 2s), basta con construir el vértice del arco y reutilizar
 * el arco por tres puntos.
 *
 * Devuelve `[]` si la cuerda es nula o si la comba es despreciable (en ese caso
 * el resultado sería un segmento recto y la herramienta debe dibujarlo como tal).
 */
export function bulgeArcPoints(
  start: Vec3, end: Vec3, bulge: number, normal: Vec3, segments: number,
): Vec3[] {
  const segs = toSegments(segments);
  if (segs < 1) return [];
  if (!Number.isFinite(bulge) || !(Math.abs(bulge) > EPS)) return [];

  const chord = sub(end, start);
  const c = length(chord);
  if (!(c > EPS)) return [];
  const dir = mul(chord, 1 / c);

  // Perpendicular a la cuerda dentro del plano del arco.
  let perp = cross(normalize(normal), dir);
  perp = length(perp) > EPS ? normalize(perp) : anyPerpendicular(dir);

  const mid = addScaled(start, chord, 0.5);
  const apex = addScaled(mid, perp, bulge); // vértice del arco
  const arc = arcFrom3Points(start, apex, end, segs);
  return arc ? arc.points : [];
}

// ---------------------------------------------------------------------------
// Bézier
// ---------------------------------------------------------------------------

/** Evaluación de una Bézier de grado n por el algoritmo de De Casteljau. */
function deCasteljau(controls: readonly Vec3[], t: number): Vec3 {
  let cur: Vec3[] = controls.slice();
  while (cur.length > 1) {
    const next: Vec3[] = [];
    for (let i = 0; i < cur.length - 1; i++) next.push(lerpV(cur[i], cur[i + 1], t));
    cur = next;
  }
  return cur[0];
}

/**
 * Curva de Bézier de grado `controls.length - 1` teselada en `segments`
 * tramos ⇒ `segments + 1` puntos.
 *
 * Los extremos se copian tal cual de los puntos de control (sin pasar por la
 * evaluación) para que coincidan EXACTAMENTE con ellos: así la polilínea
 * resultante suelda bien con la geometría existente.
 */
export function bezierPoints(controls: readonly Vec3[], segments: number): Vec3[] {
  const segs = toSegments(segments);
  if (segs < 1 || controls.length < 2) return [];
  const out: Vec3[] = [controls[0]];
  for (let i = 1; i < segs; i++) out.push(deCasteljau(controls, i / segs));
  out.push(controls[controls.length - 1]);
  return out;
}

// ---------------------------------------------------------------------------
// Cajas y teselado
// ---------------------------------------------------------------------------

/**
 * Las 12 aristas de una caja alineada a ejes: 4 de la base, 4 de la tapa y 4
 * verticales. Acepta las esquinas en cualquier orden.
 */
export function boxEdges(min: Vec3, max: Vec3): Array<[Vec3, Vec3]> {
  const lo = minV(min, max);
  const hi = maxV(min, max);
  const c: Vec3[] = [
    v3(lo.x, lo.y, lo.z), v3(hi.x, lo.y, lo.z), v3(hi.x, hi.y, lo.z), v3(lo.x, hi.y, lo.z),
    v3(lo.x, lo.y, hi.z), v3(hi.x, lo.y, hi.z), v3(hi.x, hi.y, hi.z), v3(lo.x, hi.y, hi.z),
  ];
  const idx: Array<[number, number]> = [
    [0, 1], [1, 2], [2, 3], [3, 0], // base
    [4, 5], [5, 6], [6, 7], [7, 4], // tapa
    [0, 4], [1, 5], [2, 6], [3, 7], // verticales
  ];
  return idx.map(([a, b]) => [c[a], c[b]] as [Vec3, Vec3]);
}

/** Número mínimo de tramos por círculo. */
export const MIN_CIRCLE_SEGMENTS = 8;
/** Número máximo de tramos por círculo (evita mallas absurdas). */
export const MAX_CIRCLE_SEGMENTS = 128;

/**
 * Número de tramos recomendado para un círculo de radio `radius` (metros)
 * partiendo de `defaultSegments` (24 en SketchUp, definido para 1 m).
 *
 * Se escala con la raíz cúbica del radio: el número de lados crece despacio, de
 * modo que un círculo 8 veces mayor solo duplica los tramos. El resultado se
 * limita a [8, 128].
 */
export function segmentsPerCircle(radius: number, defaultSegments: number): number {
  const base = Number.isFinite(defaultSegments) && defaultSegments >= 3
    ? Math.floor(defaultSegments)
    : 24;
  if (!isPositive(radius)) {
    return clamp(base, MIN_CIRCLE_SEGMENTS, MAX_CIRCLE_SEGMENTS);
  }
  const n = Math.round(base * Math.cbrt(radius));
  return clamp(n, MIN_CIRCLE_SEGMENTS, MAX_CIRCLE_SEGMENTS);
}
