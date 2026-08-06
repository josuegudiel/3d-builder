import earcut from 'earcut';
import { Geometry } from '../model/geometry';
import { Id } from '../model/types';
import { Vec2, Vec3, cross, dot, sub, normalize } from '../math/vec';
import { planeBasis, to2D } from '../math/plane';
import { AREA_EPS } from '../math/tolerance';

export interface TriangulatedFace {
  /** Posiciones 3D de los vértices usados. */
  positions: Vec3[];
  /** Índices de triángulos (múltiplo de 3) sobre `positions`. */
  indices: number[];
  /** Normal frontal de la cara. */
  normal: Vec3;
}

/**
 * Elimina los "picos" de un bucle: secuencias en las que el recorrido entra y
 * sale por la misma arista (aristas colgantes que tocan el contorno). Estos
 * picos tienen área nula y hacen fallar a earcut, pero deben conservarse en la
 * topología, así que sólo se retiran para triangular.
 */
function stripSpikes(indices: number[]): number[] {
  let ring = [...indices];
  let changed = true;
  while (changed && ring.length > 3) {
    changed = false;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const prev = ring[(i - 1 + n) % n];
      const next = ring[(i + 1) % n];
      if (prev === next) {
        // `ring[i]` es la punta de un pico: se elimina junto con una repetición.
        const remove = new Set<number>([i, (i + 1) % n]);
        ring = ring.filter((_, k) => !remove.has(k));
        changed = true;
        break;
      }
    }
  }
  // Eliminar vértices consecutivos repetidos.
  const out: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    if (out.length === 0 || out[out.length - 1] !== ring[i]) out.push(ring[i]);
  }
  if (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
  return out;
}

/** Área con signo de un anillo dado por índices en `pts2`. */
function ringArea(ring: readonly number[], pts2: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = pts2[ring[i]];
    const q = pts2[ring[(i + 1) % ring.length]];
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}

/**
 * Triangula una cara del modelo, incluidos sus agujeros.
 * Los triángulos se devuelven con el mismo sentido que la normal frontal.
 */
export function triangulateFace(geo: Geometry, faceId: Id): TriangulatedFace | null {
  const face = geo.faces.get(faceId);
  if (!face || face.loops.length === 0) return null;

  const basis = planeBasis(face.plane);

  // Mapa vértice → índice local.
  const positions: Vec3[] = [];
  const pts2: Vec2[] = [];
  const indexOf = new Map<Id, number>();

  const localIndex = (v: Id): number => {
    let i = indexOf.get(v);
    if (i === undefined) {
      const p = geo.vertexPos(v);
      i = positions.length;
      positions.push(p);
      pts2.push(to2D(basis, p));
      indexOf.set(v, i);
    }
    return i;
  };

  const rings: number[][] = [];
  for (const loop of face.loops) {
    const ring = stripSpikes(loop.vertices.map(localIndex));
    if (ring.length >= 3) rings.push(ring);
  }
  if (rings.length === 0) return null;

  const outer = rings[0];
  const holes = rings.slice(1);

  // El contorno exterior debe ser antihorario y los agujeros horarios para que
  // earcut oriente bien los triángulos.
  const outerRing = ringArea(outer, pts2) < 0 ? [...outer].reverse() : outer;
  const holeRings = holes.map((h) => (ringArea(h, pts2) > 0 ? [...h].reverse() : h));

  const flat: number[] = [];
  const ringToLocal: number[] = [];
  for (const i of outerRing) {
    flat.push(pts2[i].x, pts2[i].y);
    ringToLocal.push(i);
  }
  const holeIndices: number[] = [];
  for (const hole of holeRings) {
    holeIndices.push(ringToLocal.length);
    for (const i of hole) {
      flat.push(pts2[i].x, pts2[i].y);
      ringToLocal.push(i);
    }
  }

  const tri = earcut(flat, holeIndices.length ? holeIndices : undefined, 2);
  if (tri.length === 0) return null;

  const indices: number[] = [];
  for (let i = 0; i < tri.length; i += 3) {
    const a = ringToLocal[tri[i]];
    const b = ringToLocal[tri[i + 1]];
    const c = ringToLocal[tri[i + 2]];
    if (a === b || b === c || a === c) continue;
    // Verificar orientación respecto de la normal frontal.
    const n = cross(sub(positions[b], positions[a]), sub(positions[c], positions[a]));
    if (dot(n, face.plane.n) >= 0) indices.push(a, b, c);
    else indices.push(a, c, b);
  }

  if (indices.length === 0) return null;
  return { positions, indices, normal: face.plane.n };
}

/** Área real de una cara (descontando agujeros). */
export function faceArea(geo: Geometry, faceId: Id): number {
  const face = geo.faces.get(faceId);
  if (!face) return 0;
  const basis = planeBasis(face.plane);
  let area = 0;
  for (let i = 0; i < face.loops.length; i++) {
    const pts = face.loops[i].vertices.map((v) => to2D(basis, geo.vertexPos(v)));
    let a = 0;
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      const q = pts[(k + 1) % pts.length];
      a += p.x * q.y - q.x * p.y;
    }
    area += a * 0.5;
  }
  return Math.abs(area) < AREA_EPS ? 0 : Math.abs(area);
}

/** Centroide aproximado de una cara (media de los triángulos por área). */
export function faceCentroid(geo: Geometry, faceId: Id): Vec3 | null {
  const t = triangulateFace(geo, faceId);
  if (!t) {
    const f = geo.faces.get(faceId);
    if (!f || f.loops.length === 0) return null;
    const pts = f.loops[0].vertices.map((v) => geo.vertexPos(v));
    if (pts.length === 0) return null;
    let x = 0, y = 0, z = 0;
    for (const p of pts) { x += p.x; y += p.y; z += p.z; }
    return { x: x / pts.length, y: y / pts.length, z: z / pts.length };
  }
  let total = 0;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < t.indices.length; i += 3) {
    const a = t.positions[t.indices[i]];
    const b = t.positions[t.indices[i + 1]];
    const c = t.positions[t.indices[i + 2]];
    const ar = 0.5 * Math.hypot(
      (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
      (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
      (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
    );
    total += ar;
    cx += ((a.x + b.x + c.x) / 3) * ar;
    cy += ((a.y + b.y + c.y) / 3) * ar;
    cz += ((a.z + b.z + c.z) / 3) * ar;
  }
  if (total <= 0) return null;
  return { x: cx / total, y: cy / total, z: cz / total };
}

/** Normal geométrica de una cara calculada por Newell (para validación). */
export function faceGeometricNormal(geo: Geometry, faceId: Id): Vec3 | null {
  const f = geo.faces.get(faceId);
  if (!f || f.loops.length === 0) return null;
  const pts = f.loops[0].vertices.map((v) => geo.vertexPos(v));
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  return normalize({ x: nx, y: ny, z: nz });
}
