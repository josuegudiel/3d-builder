import { Geometry } from '../model/geometry';
import { Id } from '../model/types';
import { Vec2, Vec3, v2, sub2, cross2, normalize2, distance2 } from '../math/vec';
import { planeBasis, to2D, to3D } from '../math/plane';
import { EPS } from '../math/tolerance';
import { signedArea2, lineLineIntersect2 } from '../math/geom';
import { drawPolyline } from './draw';
import { orientFacesConsistently } from '../topology/orient';

/**
 * Desplaza un polígono cerrado una distancia constante.
 *
 * Convenio: `distance > 0` desplaza hacia el INTERIOR del polígono (el lado
 * hacia el que apunta la normal izquierda de cada arista en un contorno
 * antihorario). Es el mismo criterio que la herramienta Equidistancia.
 *
 * Cada arista se traslada y los vértices nuevos se obtienen intersecando las
 * rectas desplazadas consecutivas (unión en inglete). Las aristas paralelas
 * consecutivas se resuelven con una simple traslación.
 */
export function offsetPolygon2(points: readonly Vec2[], distance: number): Vec2[] {
  const n = points.length;
  if (n < 3 || Math.abs(distance) <= EPS) return points.map((p) => v2(p.x, p.y));

  // Normalizamos a sentido antihorario para que el criterio sea estable.
  const ccw = signedArea2(points) >= 0;
  const poly = ccw ? points : [...points].reverse();
  const d = distance;

  // Recta desplazada de cada arista.
  const lines: Array<{ a: Vec2; b: Vec2 } | null> = [];
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const dir = normalize2(sub2(q, p));
    if (Math.abs(dir.x) + Math.abs(dir.y) < 1e-12) {
      lines.push(null);
      continue;
    }
    // Normal izquierda: apunta al interior en un contorno antihorario.
    const nx = -dir.y;
    const ny = dir.x;
    lines.push({
      a: v2(p.x + nx * d, p.y + ny * d),
      b: v2(q.x + nx * d, q.y + ny * d),
    });
  }

  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = lines[(i - 1 + n) % n];
    const cur = lines[i];
    if (!prev || !cur) {
      out.push(poly[i]);
      continue;
    }
    const hit = lineLineIntersect2(prev.a, prev.b, cur.a, cur.b);
    if (hit) {
      // Un inglete demasiado largo (ángulos muy agudos) se recorta.
      const limit = Math.abs(d) * 20 + 1e-6;
      if (distance2(hit, poly[i]) <= limit) {
        out.push(hit);
        continue;
      }
    }
    // Aristas paralelas o inglete excesivo: se usa el punto trasladado.
    out.push(cur.a);
  }

  const cleaned = removeFlippedSegments(poly, out);
  return ccw ? cleaned : cleaned.reverse();
}

/**
 * Elimina los vértices en los que el contorno desplazado se ha invertido
 * (aristas que han cambiado de sentido porque la equidistancia las ha
 * consumido). Es una limpieza sencilla pero suficiente para el uso normal.
 */
function removeFlippedSegments(original: readonly Vec2[], offsetPts: Vec2[]): Vec2[] {
  const n = original.length;
  const keep: boolean[] = new Array(n).fill(true);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const o = sub2(original[j], original[i]);
    const q = sub2(offsetPts[j], offsetPts[i]);
    if (o.x * q.x + o.y * q.y < 0) {
      keep[j] = false;
    }
  }
  const out = offsetPts.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : offsetPts;
}

export interface OffsetResult {
  createdFaces: Id[];
  points: Vec3[];
}

/**
 * Aplica la equidistancia al contorno exterior de una cara y dibuja el
 * resultado sobre el mismo plano.
 *
 * `distance > 0` desplaza hacia dentro de la cara.
 */
export function offsetFace(geo: Geometry, faceId: Id, distance: number): OffsetResult | null {
  const face = geo.faces.get(faceId);
  if (!face || Math.abs(distance) <= EPS) return null;

  const basis = planeBasis(face.plane);
  const pts3 = face.loops[0].vertices.map((v) => geo.vertexPos(v));
  const pts2 = pts3.map((p) => to2D(basis, p));

  const offset2 = offsetPolygon2(pts2, distance);
  if (offset2.length < 3) return null;

  // Un desplazamiento que colapsa el polígono se descarta.
  const areaBefore = Math.abs(signedArea2(pts2));
  const areaAfter = Math.abs(signedArea2(offset2));
  if (areaAfter < 1e-12 || (distance > 0 && areaAfter >= areaBefore)) {
    if (distance > 0) return null;
  }

  const points = offset2.map((p) => to3D(basis, p));
  const r = drawPolyline(geo, points, true);
  orientFacesConsistently(geo, r.rebuild.created);
  return { createdFaces: r.rebuild.created, points };
}

/**
 * Equidistancia de una polilínea abierta (contorno seleccionado, no una cara).
 * Devuelve los puntos desplazados sin cerrar el contorno.
 */
export function offsetPolyline2(points: readonly Vec2[], distance: number): Vec2[] {
  const n = points.length;
  if (n < 2) return [];
  const out: Vec2[] = [];
  const lines: Array<{ a: Vec2; b: Vec2 }> = [];
  for (let i = 0; i < n - 1; i++) {
    const dir = normalize2(sub2(points[i + 1], points[i]));
    const nx = -dir.y;
    const ny = dir.x;
    lines.push({
      a: v2(points[i].x + nx * distance, points[i].y + ny * distance),
      b: v2(points[i + 1].x + nx * distance, points[i + 1].y + ny * distance),
    });
  }
  out.push(lines[0].a);
  for (let i = 1; i < lines.length; i++) {
    const hit = lineLineIntersect2(lines[i - 1].a, lines[i - 1].b, lines[i].a, lines[i].b);
    out.push(hit ?? lines[i].a);
  }
  out.push(lines[lines.length - 1].b);
  return out;
}

/** Signo que hace que la equidistancia vaya hacia el punto indicado. */
export function offsetSignTowards(
  points: readonly Vec2[],
  target: Vec2,
): 1 | -1 {
  // Interior = a la izquierda en sentido antihorario.
  const ccw = signedArea2(points) >= 0;
  const n = points.length;
  let best = Infinity;
  let sign: 1 | -1 = 1;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const q = points[(i + 1) % n];
    const dir = normalize2(sub2(q, p));
    const rel = sub2(target, p);
    const side = cross2(dir, rel);
    const d = Math.abs(side);
    if (d < best) {
      best = d;
      const inward = ccw ? side > 0 : side < 0;
      sign = inward ? 1 : -1;
    }
  }
  return sign;
}
