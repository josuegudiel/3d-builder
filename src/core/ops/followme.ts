import { Geometry } from '../model/geometry';
import { Id } from '../model/types';
import {
  Vec3, add, sub, mul, dot, cross, normalize, length, distance, addScaled, v3,
  angleBetween, rotateAround,
} from '../math/vec';
import { EPS } from '../math/tolerance';
import { insertPolyline, insertSegment } from '../topology/insert';
import { collectCandidatePlanes, rebuildFaces } from '../topology/rebuild';
import { orientFacesConsistently } from '../topology/orient';

export interface FollowMeResult {
  createdFaces: Id[];
  rings: Vec3[][];
}

/** Tangentes en cada vértice del camino (bisectriz en los vértices interiores). */
function pathTangents(points: readonly Vec3[], closed: boolean): Vec3[] {
  const n = points.length;
  const dirs: Vec3[] = [];
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    dirs.push(normalize(sub(points[(i + 1) % n], points[i])));
  }

  const tangents: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    if (closed) {
      const a = dirs[(i - 1 + dirs.length) % dirs.length];
      const b = dirs[i % dirs.length];
      tangents.push(normalize(add(a, b)));
    } else if (i === 0) {
      tangents.push(dirs[0]);
    } else if (i === n - 1) {
      tangents.push(dirs[dirs.length - 1]);
    } else {
      tangents.push(normalize(add(dirs[i - 1], dirs[i])));
    }
  }
  return tangents;
}

/**
 * Barrido de un perfil a lo largo de un camino ("Sígueme" de SketchUp).
 *
 * Se usa un transporte paralelo del sistema de referencia para evitar que el
 * perfil gire sobre sí mismo, y en cada vértice del camino se corta con el
 * plano bisectriz para que las uniones sean limpias (inglete).
 *
 * `profilePoints` debe ser un contorno cerrado. `pathPoints` es la polilínea a
 * seguir; su primer punto marca la posición inicial del perfil.
 */
export function sweepProfile(
  geo: Geometry,
  profilePoints: readonly Vec3[],
  profileNormal: Vec3,
  pathPoints: readonly Vec3[],
  closedPath = false,
): FollowMeResult {
  if (profilePoints.length < 3 || pathPoints.length < 2) {
    return { createdFaces: [], rings: [] };
  }

  const tangents = pathTangents(pathPoints, closedPath);

  // --- Sistema de referencia inicial ---------------------------------------
  const n0 = normalize(profileNormal);
  const t0 = tangents[0];
  // Rotación mínima que lleva la normal del perfil a la tangente inicial.
  let axis = cross(n0, t0);
  let angle = angleBetween(n0, t0);
  if (length(axis) <= EPS) {
    // Paralelas o antiparalelas.
    axis = Math.abs(dot(n0, t0)) > 0.5 && dot(n0, t0) < 0
      ? perpendicularTo(n0)
      : v3(0, 0, 1);
    angle = dot(n0, t0) < 0 ? Math.PI : 0;
  } else {
    axis = normalize(axis);
  }

  const anchor = pathPoints[0];
  const ring0 = profilePoints.map((p) => {
    const rel = sub(p, anchor);
    const rot = angle === 0 ? rel : rotateAround(rel, axis, angle);
    return add(anchor, rot);
  });

  // --- Transporte a lo largo del camino ------------------------------------
  const rings: Vec3[][] = [ring0];
  let prevTangent = t0;
  let current = ring0;

  const count = closedPath ? pathPoints.length : pathPoints.length;
  for (let i = 1; i < count; i++) {
    const idx = i % pathPoints.length;
    const move = sub(pathPoints[idx], pathPoints[i - 1]);
    let ring = current.map((p) => add(p, move));

    const t = tangents[idx];
    const ax = cross(prevTangent, t);
    const ang = angleBetween(prevTangent, t);
    if (length(ax) > EPS && ang > 1e-9) {
      const a = normalize(ax);
      const c = pathPoints[idx];
      ring = ring.map((p) => add(c, rotateAround(sub(p, c), a, ang)));
      // Compensación de inglete: se estira la sección en la dirección del giro
      // para que el grosor se mantenga al doblar.
      const half = ang / 2;
      const factor = 1 / Math.max(0.2, Math.cos(half));
      const bend = normalize(cross(a, t));
      ring = ring.map((p) => {
        const rel = sub(p, c);
        const along = dot(rel, bend);
        return add(c, addScaled(rel, bend, along * (factor - 1)));
      });
    }

    rings.push(ring);
    current = ring;
    prevTangent = t;
  }

  if (closedPath && rings.length > 1) rings.pop();

  // --- Construir la superficie ---------------------------------------------
  const affected: Id[] = [];
  const ringCount = rings.length;
  const m = profilePoints.length;

  for (const ring of rings) {
    const r = insertPolyline(geo, ring, true);
    affected.push(...r.affectedEdges);
  }

  const lastRing = closedPath ? ringCount : ringCount - 1;
  for (let i = 0; i < lastRing; i++) {
    const a = rings[i];
    const b = rings[(i + 1) % ringCount];
    for (let k = 0; k < m; k++) {
      if (distance(a[k], b[k]) <= EPS) continue;
      const r = insertSegment(geo, a[k], b[k]);
      affected.push(...r.affectedEdges);
    }
  }

  const rb = rebuildFaces(geo, collectCandidatePlanes(geo, affected), {
    newEdges: new Set(affected),
  });
  orientFacesConsistently(geo, rb.created);

  return { createdFaces: rb.created, rings };
}

function perpendicularTo(n: Vec3): Vec3 {
  const helper = Math.abs(n.x) < 0.9 ? v3(1, 0, 0) : v3(0, 1, 0);
  return normalize(cross(n, helper));
}

/**
 * Versión de alto nivel: barre la cara `profileFaceId` a lo largo de la
 * polilínea formada por las aristas indicadas.
 */
export function followMe(
  geo: Geometry,
  profileFaceId: Id,
  pathEdges: readonly Id[],
): FollowMeResult {
  const face = geo.faces.get(profileFaceId);
  if (!face) return { createdFaces: [], rings: [] };

  const path = orderPath(geo, pathEdges);
  if (path.points.length < 2) return { createdFaces: [], rings: [] };

  const profile = face.loops[0].vertices.map((v) => geo.vertexPos(v));
  const normal = face.plane.n;

  // El camino debe empezar por el extremo más cercano al perfil.
  const centroid = profile.reduce(
    (acc, p) => add(acc, mul(p, 1 / profile.length)), v3(0, 0, 0),
  );
  const pts = [...path.points];
  if (!path.closed && distance(pts[0], centroid) > distance(pts[pts.length - 1], centroid)) {
    pts.reverse();
  }

  // La cara del perfil desaparece: se convierte en la sección barrida.
  geo.removeFace(profileFaceId);

  return sweepProfile(geo, profile, normal, pts, path.closed);
}

/** Ordena un conjunto de aristas en una polilínea continua. */
export function orderPath(
  geo: Geometry,
  edgeIds: readonly Id[],
): { points: Vec3[]; closed: boolean } {
  const edges = edgeIds.filter((e) => geo.edges.has(e));
  if (edges.length === 0) return { points: [], closed: false };

  const adjacency = new Map<Id, Id[]>();
  for (const eid of edges) {
    const e = geo.edges.get(eid)!;
    for (const v of [e.a, e.b]) {
      const list = adjacency.get(v);
      if (list) list.push(eid);
      else adjacency.set(v, [eid]);
    }
  }

  // Extremo: vértice con una sola arista. Si no hay, el camino es cerrado.
  let start: Id | null = null;
  for (const [v, list] of adjacency) {
    if (list.length === 1) {
      start = v;
      break;
    }
  }
  const closed = start === null;
  if (start === null) start = geo.edges.get(edges[0])!.a;

  const usedEdges = new Set<Id>();
  const order: Id[] = [start];
  let current = start;

  for (let guard = 0; guard < edges.length + 1; guard++) {
    const candidates = (adjacency.get(current) ?? []).filter((e) => !usedEdges.has(e));
    if (candidates.length === 0) break;
    const eid = candidates[0];
    usedEdges.add(eid);
    const e = geo.edges.get(eid)!;
    current = e.a === current ? e.b : e.a;
    if (current === order[0]) break;
    order.push(current);
  }

  return { points: order.map((v) => geo.vertexPos(v)), closed };
}
