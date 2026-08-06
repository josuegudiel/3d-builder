import {
  Vec3, Vec2, v3, v2, add, sub, mul, dot, cross, normalize, length, lengthSq,
  anyPerpendicular, addScaled,
} from './vec';
import { PLANE_EPS, EPS } from './tolerance';
import { Mat4, transformPoint, transformNormal } from './mat';

/**
 * Plano en forma normal-distancia: `dot(n, p) = d`, con `n` unitario.
 */
export interface Plane {
  readonly n: Vec3;
  readonly d: number;
}

export function planeFromPointNormal(p: Vec3, n: Vec3): Plane {
  const nn = normalize(n);
  return { n: nn, d: dot(nn, p) };
}

/**
 * Plano por tres puntos. Devuelve null si son colineales.
 * La normal sigue la regla de la mano derecha sobre (a, b, c).
 */
export function planeFrom3Points(a: Vec3, b: Vec3, c: Vec3): Plane | null {
  const n = cross(sub(b, a), sub(c, a));
  const l = length(n);
  // El área del triángulo es l/2; exigimos un área mínima relativa al tamaño.
  const scale = Math.max(lengthSq(sub(b, a)), lengthSq(sub(c, a)), 1e-12);
  if (l * l <= 1e-14 * scale * scale) return null;
  const nn = mul(n, 1 / l);
  return { n: nn, d: dot(nn, a) };
}

/**
 * Ajusta el mejor plano a un polígono usando el área proyectada (Newell).
 * Es numéricamente mucho más estable que tomar tres vértices cualesquiera y es
 * el método correcto para polígonos casi planos con muchos vértices.
 */
export function planeFromPolygon(pts: readonly Vec3[]): Plane | null {
  const n = newellNormal(pts);
  if (lengthSq(n) <= 1e-24) return null;
  const nn = normalize(n);
  // Centroide como punto del plano: minimiza el error cuadrático medio.
  let cx = 0, cy = 0, cz = 0;
  for (const p of pts) { cx += p.x; cy += p.y; cz += p.z; }
  const inv = 1 / pts.length;
  const c = v3(cx * inv, cy * inv, cz * inv);
  return { n: nn, d: dot(nn, c) };
}

/** Normal de Newell (sin normalizar): su módulo es el área del polígono. */
export function newellNormal(pts: readonly Vec3[]): Vec3 {
  let nx = 0, ny = 0, nz = 0;
  const m = pts.length;
  for (let i = 0; i < m; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % m];
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  return v3(nx * 0.5, ny * 0.5, nz * 0.5);
}

/** Distancia con signo del punto al plano. */
export function planeDistance(pl: Plane, p: Vec3): number {
  return dot(pl.n, p) - pl.d;
}

export function planeContains(pl: Plane, p: Vec3, eps = PLANE_EPS): boolean {
  return Math.abs(planeDistance(pl, p)) <= eps;
}

/** Proyección ortogonal del punto sobre el plano. */
export function planeProject(pl: Plane, p: Vec3): Vec3 {
  return addScaled(p, pl.n, -planeDistance(pl, p));
}

/** Un punto cualquiera del plano (el más cercano al origen). */
export function planeOrigin(pl: Plane): Vec3 {
  return mul(pl.n, pl.d);
}

export function planeFlip(pl: Plane): Plane {
  return { n: mul(pl.n, -1), d: -pl.d };
}

/**
 * ¿Son el mismo plano geométrico? Si `oriented` es false, un plano y su
 * opuesto se consideran iguales (es lo que interesa para agrupar caras
 * coplanares).
 */
export function planeEquals(a: Plane, b: Plane, oriented = false, eps = PLANE_EPS): boolean {
  const same = Math.abs(a.n.x - b.n.x) <= 1e-7 && Math.abs(a.n.y - b.n.y) <= 1e-7 && Math.abs(a.n.z - b.n.z) <= 1e-7
    && Math.abs(a.d - b.d) <= eps;
  if (same) return true;
  if (oriented) return false;
  return Math.abs(a.n.x + b.n.x) <= 1e-7 && Math.abs(a.n.y + b.n.y) <= 1e-7 && Math.abs(a.n.z + b.n.z) <= 1e-7
    && Math.abs(a.d + b.d) <= eps;
}

/**
 * Forma canónica de un plano no orientado: se fuerza el primer componente no
 * nulo significativo de la normal a ser positivo. Permite usar el plano como
 * clave de un mapa.
 */
export function planeCanonical(pl: Plane): Plane {
  const { x, y, z } = pl.n;
  const t = 1e-9;
  let flip = false;
  if (x < -t) flip = true;
  else if (Math.abs(x) <= t) {
    if (y < -t) flip = true;
    else if (Math.abs(y) <= t && z < -t) flip = true;
  }
  return flip ? planeFlip(pl) : pl;
}

/** Clave de texto estable para agrupar planos coplanares con tolerancia. */
export function planeKey(pl: Plane, angStep = 1e-6, distStep = 1e-6): string {
  const c = planeCanonical(pl);
  const q = (v: number, s: number) => {
    const r = Math.round(v / s) * s;
    return (r === 0 ? 0 : r).toFixed(9);
  };
  return `${q(c.n.x, angStep)}|${q(c.n.y, angStep)}|${q(c.n.z, angStep)}|${q(c.d, distStep)}`;
}

/**
 * Base ortonormal (u, v) del plano, elegida de forma determinista y alineada
 * con los ejes globales siempre que sea posible. Esto hace que los resultados
 * del subdivisor planar sean reproducibles.
 */
export interface PlaneBasis {
  readonly origin: Vec3;
  readonly u: Vec3;
  readonly v: Vec3;
  readonly n: Vec3;
}

export function planeBasis(pl: Plane): PlaneBasis {
  const n = pl.n;
  const u = anyPerpendicular(n);
  const v = cross(n, u);
  return { origin: planeOrigin(pl), u, v, n };
}

/** Proyecta un punto 3D a las coordenadas 2D de la base del plano. */
export function to2D(b: PlaneBasis, p: Vec3): Vec2 {
  const d = sub(p, b.origin);
  return v2(dot(d, b.u), dot(d, b.v));
}

/** Reconstruye el punto 3D a partir de coordenadas 2D del plano. */
export function to3D(b: PlaneBasis, p: Vec2): Vec3 {
  return add(b.origin, add(mul(b.u, p.x), mul(b.v, p.y)));
}

/** Transforma un plano por una matriz (correcto con escalados no uniformes). */
export function planeTransform(pl: Plane, m: Mat4): Plane {
  const p = transformPoint(m, planeOrigin(pl));
  const n = transformNormal(m, pl.n);
  return planeFromPointNormal(p, n);
}

/**
 * Intersección de dos planos. Devuelve un punto y una dirección de la recta,
 * o null si son paralelos.
 */
export function planePlaneIntersect(a: Plane, b: Plane): { p: Vec3; dir: Vec3 } | null {
  const dir = cross(a.n, b.n);
  const dl2 = lengthSq(dir);
  if (dl2 <= 1e-18) return null;
  // Punto de la recta más cercano al origen:
  //   p = (d_a·(n_b × dir) + d_b·(dir × n_a)) / |dir|²
  // que equivale a ((d_a·n_b − d_b·n_a) × dir) / |dir|².
  const p = mul(
    add(mul(cross(b.n, dir), a.d), mul(cross(dir, a.n), b.d)),
    1 / dl2,
  );
  return { p, dir: normalize(dir) };
}

/**
 * Intersección recta-plano. `p0 + t·dir`. Devuelve null si la recta es
 * paralela al plano (aunque esté contenida en él).
 */
export function linePlaneIntersect(pl: Plane, p0: Vec3, dir: Vec3): { t: number; p: Vec3 } | null {
  const denom = dot(pl.n, dir);
  if (Math.abs(denom) <= 1e-12) return null;
  const t = (pl.d - dot(pl.n, p0)) / denom;
  return { t, p: addScaled(p0, dir, t) };
}

/**
 * Intersección segmento-plano con tolerancia en los extremos.
 * Devuelve null si el segmento no cruza el plano.
 */
export function segmentPlaneIntersect(pl: Plane, a: Vec3, b: Vec3, eps = PLANE_EPS): Vec3 | null {
  const da = planeDistance(pl, a);
  const db = planeDistance(pl, b);
  if (Math.abs(da) <= eps && Math.abs(db) <= eps) return null; // coplanar
  if ((da > eps && db > eps) || (da < -eps && db < -eps)) return null;
  const denom = da - db;
  if (Math.abs(denom) <= 1e-18) return null;
  const t = da / denom;
  if (t < -EPS || t > 1 + EPS) return null;
  return addScaled(a, sub(b, a), Math.min(1, Math.max(0, t)));
}
