import { Vec3 } from '../core/math/vec';
import { Ray } from '../core/math/geom';

/**
 * Versiones sin asignaciones de las operaciones que se ejecutan una vez por
 * entidad en cada movimiento del ratón.
 *
 * Las funciones equivalentes de `core/math` devuelven objetos nuevos, lo que es
 * cómodo y correcto para el kernel, pero en el selector se llaman decenas de
 * miles de veces por evento: la presión sobre el recolector de basura llegaba a
 * dominar el coste. Aquí sólo se opera con escalares.
 */

/** Distancia al cuadrado del punto `p` a la recta del rayo. */
export function rayPointDistanceSq(r: Ray, p: Vec3): number {
  const ox = p.x - r.origin.x;
  const oy = p.y - r.origin.y;
  const oz = p.z - r.origin.z;
  const t = ox * r.dir.x + oy * r.dir.y + oz * r.dir.z;
  const px = ox - r.dir.x * t;
  const py = oy - r.dir.y * t;
  const pz = oz - r.dir.z * t;
  return px * px + py * py + pz * pz;
}

/** Profundidad del punto a lo largo del rayo (negativa si queda detrás). */
export function rayDepth(r: Ray, p: Vec3): number {
  return (p.x - r.origin.x) * r.dir.x
    + (p.y - r.origin.y) * r.dir.y
    + (p.z - r.origin.z) * r.dir.z;
}

/**
 * Distancia mínima entre el rayo y el segmento AB, junto con el parámetro del
 * punto más cercano sobre el segmento. Sin asignaciones.
 */
export interface RaySegmentResult {
  distSq: number;
  t: number;
  depth: number;
}

const raySegScratch: RaySegmentResult = { distSq: 0, t: 0, depth: 0 };

export function raySegmentDistance(r: Ray, a: Vec3, b: Vec3): RaySegmentResult {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const wx = a.x - r.origin.x;
  const wy = a.y - r.origin.y;
  const wz = a.z - r.origin.z;

  const A = dx * dx + dy * dy + dz * dz;             // |AB|²
  const B = dx * r.dir.x + dy * r.dir.y + dz * r.dir.z; // AB · dir
  const D = dx * wx + dy * wy + dz * wz;             // AB · w
  const E = r.dir.x * wx + r.dir.y * wy + r.dir.z * wz; // dir · w

  // |dir| = 1, así que el denominador es A − B².
  const denom = A - B * B;
  let t: number;
  if (A <= 1e-24) {
    t = 0;
  } else if (Math.abs(denom) < 1e-12 * (A + 1)) {
    // Segmento paralelo al rayo: el punto más cercano es un extremo.
    t = 0;
  } else {
    t = (B * E - D) / denom;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }

  const px = a.x + dx * t;
  const py = a.y + dy * t;
  const pz = a.z + dz * t;
  const ox = px - r.origin.x;
  const oy = py - r.origin.y;
  const oz = pz - r.origin.z;
  const depth = ox * r.dir.x + oy * r.dir.y + oz * r.dir.z;
  const qx = ox - r.dir.x * depth;
  const qy = oy - r.dir.y * depth;
  const qz = oz - r.dir.z * depth;

  raySegScratch.distSq = qx * qx + qy * qy + qz * qz;
  raySegScratch.t = t;
  raySegScratch.depth = depth;
  return raySegScratch;
}

/** Möller–Trumbore sin asignaciones. Devuelve la distancia o -1. */
export function rayTriangleFast(r: Ray, a: Vec3, b: Vec3, c: Vec3): number {
  const e1x = b.x - a.x;
  const e1y = b.y - a.y;
  const e1z = b.z - a.z;
  const e2x = c.x - a.x;
  const e2y = c.y - a.y;
  const e2z = c.z - a.z;

  const px = r.dir.y * e2z - r.dir.z * e2y;
  const py = r.dir.z * e2x - r.dir.x * e2z;
  const pz = r.dir.x * e2y - r.dir.y * e2x;

  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-14 && det < 1e-14) return -1;
  const inv = 1 / det;

  const tx = r.origin.x - a.x;
  const ty = r.origin.y - a.y;
  const tz = r.origin.z - a.z;

  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return -1;

  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;

  const v = (r.dir.x * qx + r.dir.y * qy + r.dir.z * qz) * inv;
  if (v < -1e-9 || u + v > 1 + 1e-9) return -1;

  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-9 ? t : -1;
}
