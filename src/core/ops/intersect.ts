import { Geometry } from '../model/geometry';
import { Id } from '../model/types';
import {
  Vec2, Vec3, v2, v3, sub, dot, lengthSq, addScaled,
} from '../math/vec';
import { Plane, planeBasis, to2D, planePlaneIntersect, planeEquals, PlaneBasis } from '../math/plane';
import { pointInPolygon2, Box3, emptyBox, expandBox } from '../math/geom';
import { EPS } from '../math/tolerance';
import { insertSegment } from '../topology/insert';

/**
 * Aristas de intersección entre caras ("Intersecar caras" de SketchUp).
 *
 * Dos caras que no son coplanares se cortan a lo largo de la recta común a sus
 * dos planos. El trozo útil de esa recta es el que queda dentro de las DOS
 * caras a la vez, así que se calcula el intervalo dentro de cada una y se
 * intersecan los dos intervalos. Los segmentos resultantes se insertan como
 * aristas de verdad, partiendo lo que haga falta, y a partir de ahí las dos
 * piezas comparten geometría: dejan de estar simplemente superpuestas.
 */

export interface Segment3 {
  a: Vec3;
  b: Vec3;
}

/** Caja envolvente de una cara, con un margen de tolerancia. */
function faceBox(geo: Geometry, faceId: Id): Box3 {
  let box = emptyBox();
  for (const v of geo.faceVertices(faceId)) box = expandBox(box, geo.vertexPos(v));
  box.min = v3(box.min.x - EPS, box.min.y - EPS, box.min.z - EPS);
  box.max = v3(box.max.x + EPS, box.max.y + EPS, box.max.z + EPS);
  return box;
}

function boxesOverlap(a: Box3, b: Box3): boolean {
  return a.min.x <= b.max.x && a.max.x >= b.min.x
    && a.min.y <= b.max.y && a.max.y >= b.min.y
    && a.min.z <= b.max.z && a.max.z >= b.min.z;
}

function cross2(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

/** ¿Está el punto dentro de la cara, contando los agujeros? (par-impar). */
function insideLoops(loops: readonly Vec2[][], p: Vec2): boolean {
  let inside = false;
  for (const loop of loops) {
    if (pointInPolygon2(loop, p)) inside = !inside;
  }
  return inside;
}

/**
 * Intervalos del parámetro `t` en los que la recta `origin + t·dir` está dentro
 * de la cara. La recta debe estar contenida en el plano de la cara; `dir` ha de
 * ser unitario para que `t` sea una longitud.
 */
export function faceLineIntervals(
  geo: Geometry,
  faceId: Id,
  origin: Vec3,
  dir: Vec3,
): Array<[number, number]> {
  const face = geo.faces.get(faceId);
  if (!face || face.loops.length === 0) return [];

  const basis: PlaneBasis = planeBasis(face.plane);
  const loops: Vec2[][] = face.loops.map((l) => l.vertices.map((v) => to2D(basis, geo.vertexPos(v))));
  if (loops[0].length < 3) return [];

  const o = to2D(basis, origin);
  const d = v2(dot(dir, basis.u), dot(dir, basis.v));
  const dLen2 = d.x * d.x + d.y * d.y;
  if (dLen2 <= 1e-18) return []; // la recta es perpendicular al plano

  // --- Parámetros candidatos: cortes con el contorno -----------------------
  const params: number[] = [];
  for (const loop of loops) {
    const n = loop.length;
    for (let i = 0; i < n; i++) {
      const p = loop[i];
      const q = loop[(i + 1) % n];
      const e = v2(q.x - p.x, q.y - p.y);
      const po = v2(p.x - o.x, p.y - o.y);
      const denom = cross2(d, e);
      if (Math.abs(denom) <= 1e-14) {
        // Arista paralela a la recta: sólo interesa si además es colineal, en
        // cuyo caso sus dos extremos marcan un cambio de región.
        if (Math.abs(cross2(po, d)) <= EPS * Math.sqrt(dLen2)) {
          params.push(dot2(po, d) / dLen2);
          params.push(dot2(v2(q.x - o.x, q.y - o.y), d) / dLen2);
        }
        continue;
      }
      const s = cross2(po, d) / denom;
      if (s < -1e-9 || s > 1 + 1e-9) continue;
      params.push(cross2(po, e) / denom);
    }
  }
  if (params.length < 2) return [];

  params.sort((a, b) => a - b);
  const cuts: number[] = [];
  for (const t of params) {
    if (cuts.length === 0 || t - cuts[cuts.length - 1] > EPS) cuts.push(t);
  }
  if (cuts.length < 2) return [];

  // --- Tramos: se prueba el punto medio de cada uno ------------------------
  const out: Array<[number, number]> = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const t0 = cuts[i];
    const t1 = cuts[i + 1];
    if (t1 - t0 <= EPS) continue;
    const mid = (t0 + t1) / 2;
    const p = v2(o.x + d.x * mid, o.y + d.y * mid);
    if (!insideLoops(loops, p)) continue;
    // Unir con el tramo anterior si son contiguos.
    const last = out[out.length - 1];
    if (last && t0 - last[1] <= EPS) last[1] = t1;
    else out.push([t0, t1]);
  }
  return out;
}

function dot2(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** Intersección de dos listas de intervalos ordenados. */
function intersectIntervals(
  a: ReadonlyArray<readonly [number, number]>,
  b: ReadonlyArray<readonly [number, number]>,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0]);
    const hi = Math.min(a[i][1], b[j][1]);
    if (hi - lo > EPS) out.push([lo, hi]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}

/** Segmentos en los que se cortan dos caras no coplanares. */
export function faceFaceSegments(geo: Geometry, fa: Id, fb: Id): Segment3[] {
  const a = geo.faces.get(fa);
  const b = geo.faces.get(fb);
  if (!a || !b) return [];

  const line = planePlaneIntersect(a.plane, b.plane);
  if (!line) return []; // planos paralelos o coincidentes

  const ia = faceLineIntervals(geo, fa, line.p, line.dir);
  if (ia.length === 0) return [];
  const ib = faceLineIntervals(geo, fb, line.p, line.dir);
  if (ib.length === 0) return [];

  return intersectIntervals(ia, ib).map(([t0, t1]) => ({
    a: addScaled(line.p, line.dir, t0),
    b: addScaled(line.p, line.dir, t1),
  }));
}

/** Segmentos del contorno de una cara. */
function boundarySegments(geo: Geometry, faceId: Id): Segment3[] {
  const f = geo.faces.get(faceId);
  if (!f) return [];
  const out: Segment3[] = [];
  for (const loop of f.loops) {
    const n = loop.vertices.length;
    for (let i = 0; i < n; i++) {
      out.push({
        a: geo.vertexPos(loop.vertices[i]),
        b: geo.vertexPos(loop.vertices[(i + 1) % n]),
      });
    }
  }
  return out;
}

export interface IntersectResult {
  /** Aristas tocadas por la inserción (nuevas y partidas). */
  edges: Id[];
  /** Segmentos de corte encontrados. */
  segments: number;
}

/**
 * Inserta las aristas de intersección entre dos conjuntos de caras.
 *
 * Los segmentos se calculan TODOS antes de tocar nada: insertar una arista
 * parte otras y cambiaría el reparto de caras a mitad del recorrido, aunque la
 * geometría siga siendo la misma. Con dos pasadas el resultado no depende del
 * orden en que se recorren las parejas.
 */
export function intersectFaceSets(
  geo: Geometry,
  facesA: Iterable<Id>,
  facesB: Iterable<Id>,
): IntersectResult {
  const listA = [...facesA].filter((f) => geo.faces.has(f));
  const listB = [...facesB].filter((f) => geo.faces.has(f));
  if (listA.length === 0 || listB.length === 0) return { edges: [], segments: 0 };

  const boxA = new Map<Id, Box3>();
  for (const f of listA) boxA.set(f, faceBox(geo, f));
  const boxB = new Map<Id, Box3>();
  for (const f of listB) boxB.set(f, faceBox(geo, f));

  const segments: Segment3[] = [];
  const coplanarDone = new Set<Id>();

  for (const fa of listA) {
    const pa = geo.faces.get(fa)!.plane;
    for (const fb of listB) {
      if (fa === fb) continue;
      if (!boxesOverlap(boxA.get(fa)!, boxB.get(fb)!)) continue;
      const pb = geo.faces.get(fb)!.plane;

      if (planeEquals(pa, pb, false)) {
        // Caras en el mismo plano: no hay recta de corte, pero sus contornos
        // sí se cruzan entre sí. Insertando ambos contornos, el reconstructor
        // de caras reparte el plano en las regiones correctas.
        if (!coplanarDone.has(fa)) {
          segments.push(...boundarySegments(geo, fa));
          coplanarDone.add(fa);
        }
        if (!coplanarDone.has(fb)) {
          segments.push(...boundarySegments(geo, fb));
          coplanarDone.add(fb);
        }
        continue;
      }

      segments.push(...faceFaceSegments(geo, fa, fb));
    }
  }

  const edges: Id[] = [];
  for (const s of segments) {
    if (lengthSq(sub(s.b, s.a)) <= EPS * EPS) continue;
    edges.push(...insertSegment(geo, s.a, s.b).affectedEdges);
  }

  return { edges: [...new Set(edges)], segments: segments.length };
}

/** Planos distintos de un conjunto de caras. */
export function planesOfFaces(geo: Geometry, faces: Iterable<Id>): Plane[] {
  const out: Plane[] = [];
  for (const fid of faces) {
    const f = geo.faces.get(fid);
    if (!f) continue;
    if (!out.some((p) => planeEquals(p, f.plane, false))) out.push(f.plane);
  }
  return out;
}
