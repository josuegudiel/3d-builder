import { Geometry } from '../model/geometry';
import { Id, Loop } from '../model/types';
import { Vec3, sub, dot, distance, distanceSq, lengthSq, normalize, addScaled } from '../math/vec';
import { EPS } from '../math/tolerance';
import {
  distanceToSegment, pointStrictlyInsideSegment, segmentSegmentIntersection,
  segmentsCollinear,
} from '../math/geom';

/** Resultado de partir una arista. */
export interface SplitResult {
  /** Aristas resultantes, en orden de `a` a `b` de la arista original. */
  edges: Id[];
  /** Cadena de vértices de `a` a `b`, incluidos los extremos. */
  vertices: Id[];
  /** true si realmente se produjo alguna partición. */
  changed: boolean;
}

/**
 * Parte una arista en los puntos indicados, actualizando IN SITU los bucles de
 * todas las caras que la usan. Ninguna cara se pierde ni se invalida.
 */
export function splitEdge(geo: Geometry, edgeId: Id, cutPoints: readonly Vec3[]): SplitResult {
  const e = geo.edges.get(edgeId);
  if (!e) return { edges: [], vertices: [], changed: false };

  const A = e.a;
  const B = e.b;
  const pa = geo.vertexPos(A);
  const pb = geo.vertexPos(B);
  const ab = sub(pb, pa);
  const len2 = lengthSq(ab);
  if (len2 <= EPS * EPS) return { edges: [edgeId], vertices: [A, B], changed: false };

  // Parámetros de corte estrictamente interiores, ordenados y sin duplicados.
  const params: number[] = [];
  const margin = EPS / Math.sqrt(len2);
  for (const p of cutPoints) {
    const t = dot(sub(p, pa), ab) / len2;
    if (t <= margin || t >= 1 - margin) continue;
    // El punto debe estar realmente sobre la arista.
    if (distance(p, addScaled(pa, ab, t)) > EPS) continue;
    params.push(t);
  }
  if (params.length === 0) return { edges: [edgeId], vertices: [A, B], changed: false };

  params.sort((x, y) => x - y);
  const unique: number[] = [];
  for (const t of params) {
    if (unique.length === 0 || t - unique[unique.length - 1] > margin) unique.push(t);
  }

  // Vértices intermedios (se reutilizan los ya existentes en esas posiciones).
  const chain: Id[] = [A];
  for (const t of unique) {
    const v = geo.addVertex(addScaled(pa, ab, t));
    if (v !== chain[chain.length - 1]) chain.push(v);
  }
  if (chain[chain.length - 1] !== B) chain.push(B);
  if (chain.length < 3) return { edges: [edgeId], vertices: [A, B], changed: false };

  // Caras afectadas antes de tocar la topología.
  const facesUsing = [...(geo.edgeFaces.get(edgeId) ?? [])];
  const flags = { soft: e.soft, smooth: e.smooth, hidden: e.hidden };

  // Retirar la arista original sin destruir las caras.
  geo.vertexEdges.get(A)?.delete(edgeId);
  geo.vertexEdges.get(B)?.delete(edgeId);
  geo.edges.delete(edgeId);
  geo.edgeFaces.delete(edgeId);

  // Crear las subaristas.
  const subEdges: Id[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const id = geo.addEdgeByVertices(chain[i], chain[i + 1]);
    if (id === null) continue;
    const se = geo.edges.get(id)!;
    se.soft = flags.soft;
    se.smooth = flags.smooth;
    se.hidden = flags.hidden;
    subEdges.push(id);
  }

  // Actualizar los bucles de las caras.
  for (const fid of facesUsing) {
    const face = geo.faces.get(fid);
    if (!face) continue;
    for (const loop of face.loops) {
      replaceEdgeInLoop(geo, loop, edgeId, chain, subEdges);
    }
    // Reasociar las subaristas con la cara.
    for (const sub2 of subEdges) {
      let set = geo.edgeFaces.get(sub2);
      if (!set) {
        set = new Set();
        geo.edgeFaces.set(sub2, set);
      }
      set.add(fid);
    }
  }

  return { edges: subEdges, vertices: chain, changed: true };
}

/**
 * Sustituye todas las apariciones de `edgeId` en un bucle por la secuencia de
 * subaristas, respetando el sentido de recorrido.
 */
function replaceEdgeInLoop(
  geo: Geometry,
  loop: Loop,
  edgeId: Id,
  chain: readonly Id[],
  subEdges: readonly Id[],
): void {
  let idx = loop.edges.indexOf(edgeId);
  while (idx >= 0) {
    const forward = loop.dirs[idx];
    const verts = forward ? [...chain] : [...chain].reverse();
    const seq = forward ? [...subEdges] : [...subEdges].reverse();

    // Si por cualquier motivo la cadena de vértices y la de subaristas no
    // encajan, es preferible dejar el bucle intacto que romper el invariante
    // `vertices[i] = origen de edges[i]`, que sí detectaría `validate()`.
    if (seq.length !== verts.length - 1) return;

    const dirs: boolean[] = [];
    for (let i = 0; i < seq.length; i++) {
      const se = geo.edges.get(seq[i]);
      dirs.push(se ? se.a === verts[i] : true);
    }

    loop.edges.splice(idx, 1, ...seq);
    loop.dirs.splice(idx, 1, ...dirs);
    loop.vertices.splice(idx, 1, ...verts.slice(0, verts.length - 1));

    idx = loop.edges.indexOf(edgeId, idx + seq.length);
  }
}

export interface InsertResult {
  /** Aristas creadas por esta inserción. */
  newEdges: Id[];
  /**
   * Aristas preexistentes sobre las que se dibujó de nuevo (redibujado).
   * Sirve para reactivar caras que el usuario había borrado.
   */
  retracedEdges: Id[];
  /** Cadena de vértices resultante, de `p0` a `p1`. */
  vertices: Id[];
  /** Todas las aristas tocadas (nuevas + redibujadas + resultado de particiones). */
  affectedEdges: Id[];
}

const EMPTY_INSERT: InsertResult = { newEdges: [], retracedEdges: [], vertices: [], affectedEdges: [] };

/**
 * Inserta un segmento en la geometría respetando la semántica de SketchUp:
 *
 *  - Las aristas existentes se parten allí donde el nuevo segmento las corta.
 *  - El nuevo segmento se parte en cada cruce y en cada vértice que atraviesa.
 *  - Redibujar sobre una arista existente no la duplica.
 *
 * Devuelve las aristas creadas y la cadena de vértices resultante.
 */
export function insertSegment(geo: Geometry, p0: Vec3, p1: Vec3): InsertResult {
  if (distanceSq(p0, p1) <= EPS * EPS) return { ...EMPTY_INSERT };

  // --- 1. Intersecciones con las aristas existentes ------------------------
  const cutsPerEdge = new Map<Id, Vec3[]>();
  const pushCut = (eid: Id, p: Vec3) => {
    const list = cutsPerEdge.get(eid);
    if (list) list.push(p);
    else cutsPerEdge.set(eid, [p]);
  };

  const segMin = {
    x: Math.min(p0.x, p1.x) - EPS,
    y: Math.min(p0.y, p1.y) - EPS,
    z: Math.min(p0.z, p1.z) - EPS,
  };
  const segMax = {
    x: Math.max(p0.x, p1.x) + EPS,
    y: Math.max(p0.y, p1.y) + EPS,
    z: Math.max(p0.z, p1.z) + EPS,
  };

  for (const e of [...geo.edges.values()]) {
    const A = geo.vertices.get(e.a);
    const B = geo.vertices.get(e.b);
    if (!A || !B) continue;
    // Rechazo rápido por caja envolvente.
    if (Math.max(A.p.x, B.p.x) < segMin.x || Math.min(A.p.x, B.p.x) > segMax.x) continue;
    if (Math.max(A.p.y, B.p.y) < segMin.y || Math.min(A.p.y, B.p.y) > segMax.y) continue;
    if (Math.max(A.p.z, B.p.z) < segMin.z || Math.min(A.p.z, B.p.z) > segMax.z) continue;

    if (segmentsCollinear(p0, p1, A.p, B.p)) {
      // Solapamiento colineal: sólo hay que partir donde caen los extremos.
      if (pointStrictlyInsideSegment(A.p, B.p, p0)) pushCut(e.id, p0);
      if (pointStrictlyInsideSegment(A.p, B.p, p1)) pushCut(e.id, p1);
      continue;
    }

    const hit = segmentSegmentIntersection(p0, p1, A.p, B.p, EPS);
    if (hit && pointStrictlyInsideSegment(A.p, B.p, hit.point)) {
      pushCut(e.id, hit.point);
    }
    // Un extremo del nuevo segmento puede apoyarse en el interior de la arista
    // aunque no haya cruce propiamente dicho (unión en T).
    if (pointStrictlyInsideSegment(A.p, B.p, p0)) pushCut(e.id, p0);
    if (pointStrictlyInsideSegment(A.p, B.p, p1)) pushCut(e.id, p1);
  }

  // --- 2. Partir las aristas afectadas -------------------------------------
  for (const [eid, pts] of cutsPerEdge) {
    splitEdge(geo, eid, pts);
  }

  // --- 3. Asegurar los vértices extremos -----------------------------------
  geo.addVertex(p0);
  geo.addVertex(p1);

  // --- 4. Recolectar todos los vértices sobre el segmento ------------------
  const dir = sub(p1, p0);
  const len = Math.sqrt(lengthSq(dir));
  const u = normalize(dir);
  const onSeg: Array<{ id: Id; t: number }> = [];
  for (const v of geo.vertices.values()) {
    if (v.p.x < segMin.x || v.p.x > segMax.x) continue;
    if (v.p.y < segMin.y || v.p.y > segMax.y) continue;
    if (v.p.z < segMin.z || v.p.z > segMax.z) continue;
    if (distanceToSegment(p0, p1, v.p) > EPS) continue;
    const t = dot(sub(v.p, p0), u) / len;
    onSeg.push({ id: v.id, t: Math.min(1, Math.max(0, t)) });
  }
  onSeg.sort((a, b) => a.t - b.t);

  // Eliminar duplicados consecutivos (mismo vértice o vértices coincidentes).
  const chain: Id[] = [];
  for (const item of onSeg) {
    if (chain.length === 0 || chain[chain.length - 1] !== item.id) chain.push(item.id);
  }
  if (chain.length < 2) return { ...EMPTY_INSERT };

  // --- 5. Crear la cadena de aristas ---------------------------------------
  const newEdges: Id[] = [];
  const retraced: Id[] = [];
  const affected: Id[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const existed = geo.findEdge(chain[i], chain[i + 1]);
    const id = geo.addEdgeByVertices(chain[i], chain[i + 1]);
    if (id === null) continue;
    if (existed === null) newEdges.push(id);
    else retraced.push(id);
    affected.push(id);
  }

  return { newEdges, retracedEdges: retraced, vertices: chain, affectedEdges: affected };
}

/**
 * Inserta una polilínea. Cada segmento se procesa en orden, de modo que los
 * segmentos posteriores ven la geometría creada por los anteriores.
 */
export function insertPolyline(
  geo: Geometry,
  points: readonly Vec3[],
  closed = false,
): InsertResult {
  const newEdges: Id[] = [];
  const retraced: Id[] = [];
  const affected: Id[] = [];
  const verts: Id[] = [];

  const n = points.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const r = insertSegment(geo, points[i], points[(i + 1) % n]);
    newEdges.push(...r.newEdges);
    retraced.push(...r.retracedEdges);
    affected.push(...r.affectedEdges);
    for (const v of r.vertices) {
      if (verts[verts.length - 1] !== v) verts.push(v);
    }
  }

  return {
    newEdges: dedupe(newEdges),
    retracedEdges: dedupe(retraced),
    vertices: verts,
    affectedEdges: dedupe(affected),
  };
}

function dedupe(ids: Id[]): Id[] {
  return [...new Set(ids)];
}
