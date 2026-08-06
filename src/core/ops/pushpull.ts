import { Geometry } from '../model/geometry';
import { Id } from '../model/types';
import { Vec3, addScaled, dot, sub, mul, normalize, distance } from '../math/vec';
import { Plane, planeFromPolygon, planeCanonical, planeFromPointNormal } from '../math/plane';
import { EPS } from '../math/tolerance';
import { insertSegment, insertPolyline } from '../topology/insert';
import { collectCandidatePlanes, rebuildFaces, collectPlanesFromFaces } from '../topology/rebuild';
import { weldCoincidentVertices, removeDegenerateEdges } from '../topology/weld';
import { faceCentroid, faceArea } from '../topology/triangulate';
import { orientFacesConsistently } from '../topology/orient';

export interface PushPullOptions {
  /**
   * Fuerza la creación de geometría nueva conservando la cara original, como
   * al mantener Ctrl/Alt pulsado en SketchUp.
   */
  createNew?: boolean;
}

export interface PushPullResult {
  /** Cara que queda en la posición desplazada (para encadenar operaciones). */
  faceId: Id | null;
  /** Modo empleado. */
  mode: 'slide' | 'extrude' | 'none';
  createdFaces: Id[];
  removedFaces: Id[];
  distance: number;
}

const NO_OP: PushPullResult = {
  faceId: null, mode: 'none', createdFaces: [], removedFaces: [], distance: 0,
};

/**
 * ¿Se puede "deslizar" la cara en lugar de crear geometría nueva?
 *
 * Es posible cuando cada arista del contorno tiene exactamente una cara vecina
 * y todas esas vecinas contienen la dirección de empuje (es decir, son
 * paralelas a `dir`). Ése es el caso de la tapa de un prisma: al desplazarla,
 * los laterales simplemente se estiran.
 */
export function canSlide(geo: Geometry, faceId: Id, dir: Vec3): boolean {
  const face = geo.faces.get(faceId);
  if (!face) return false;
  const n = normalize(dir);
  for (const loop of face.loops) {
    for (const eid of loop.edges) {
      const users = [...(geo.edgeFaces.get(eid) ?? [])].filter((f) => f !== faceId);
      if (users.length !== 1) return false;
      const other = geo.faces.get(users[0]);
      if (!other) return false;
      if (Math.abs(dot(other.plane.n, n)) > 1e-6) return false;
    }
  }
  return true;
}

/**
 * ¿Está la cara "cerrada", es decir, cada arista de su contorno tiene ya otra
 * cara adyacente? En ese caso, al extruir, la cara original queda encerrada
 * entre dos volúmenes y debe eliminarse (comportamiento de SketchUp).
 */
function isEnclosed(geo: Geometry, faceId: Id): boolean {
  const face = geo.faces.get(faceId);
  if (!face) return false;
  for (const loop of face.loops) {
    for (const eid of loop.edges) {
      const users = [...(geo.edgeFaces.get(eid) ?? [])].filter((f) => f !== faceId);
      if (users.length === 0) return false;
    }
  }
  return true;
}

/**
 * Empuja o tira de una cara a lo largo de su normal.
 *
 * `distance` positivo desplaza en el sentido de la normal frontal.
 */
export function pushPull(
  geo: Geometry,
  faceId: Id,
  distance: number,
  opts: PushPullOptions = {},
): PushPullResult {
  const face = geo.faces.get(faceId);
  if (!face) return { ...NO_OP };
  if (Math.abs(distance) <= EPS) return { ...NO_OP, faceId };

  const n = face.plane.n;
  const offset = mul(n, distance);

  if (!opts.createNew && canSlide(geo, faceId, n)) {
    return slideFace(geo, faceId, offset);
  }
  return extrudeFace(geo, faceId, offset, opts.createNew === true);
}

/** Desplaza los vértices de la cara; los laterales se estiran. */
function slideFace(geo: Geometry, faceId: Id, offset: Vec3): PushPullResult {
  const face = geo.faces.get(faceId)!;
  const verts = geo.faceVertices(faceId);

  // Planos implicados ANTES de mover nada.
  const planesBefore: Plane[] = [];
  const touchedFaces = new Set<Id>();
  const touchedEdges = new Set<Id>();
  for (const v of verts) {
    for (const e of geo.vertexEdges.get(v) ?? []) {
      touchedEdges.add(e);
      for (const f of geo.edgeFaces.get(e) ?? []) touchedFaces.add(f);
    }
  }
  planesBefore.push(...collectPlanesFromFaces(geo, touchedFaces));

  // Mover.
  for (const v of verts) {
    geo.moveVertex(v, addScaled(geo.vertexPos(v), offset, 1));
  }

  // Actualizar los planos de las caras afectadas (conservando su orientación).
  for (const fid of touchedFaces) {
    const f = geo.faces.get(fid);
    if (!f) continue;
    const pts = f.loops[0].vertices.map((vv) => geo.vertexPos(vv));
    const pl = planeFromPolygon(pts);
    if (pl) {
      f.plane = dot(pl.n, f.plane.n) >= 0 ? pl : { n: mul(pl.n, -1), d: -pl.d };
    }
  }

  // Soldar vértices que hayan quedado superpuestos (empuje hasta el fondo).
  const weld = weldCoincidentVertices(geo, verts);
  removeDegenerateEdges(geo);

  // Reconstruir.
  const planes: Plane[] = [...planesBefore];
  const liveEdges = [...touchedEdges, ...weld.affectedEdges].filter((e) => geo.edges.has(e));
  planes.push(...collectCandidatePlanes(geo, liveEdges));
  planes.push(...collectPlanesFromFaces(geo, [...geo.faces.keys()].filter((f) => touchedFaces.has(f))));

  const before = new Set(geo.faces.keys());
  const rb = rebuildFaces(geo, planes);
  const removed = [...before].filter((f) => !geo.faces.has(f));

  // Cara resultante: la que está en la posición desplazada.
  const survived = geo.faces.has(faceId) ? faceId : findFaceAt(geo, face.plane, rb.created);

  orientFacesConsistently(geo, [
    ...(survived !== null ? [survived] : []),
    ...rb.created,
    ...[...touchedFaces].filter((f) => geo.faces.has(f)),
  ]);

  return {
    faceId: survived,
    mode: 'slide',
    createdFaces: rb.created,
    removedFaces: removed,
    distance: Math.hypot(offset.x, offset.y, offset.z),
  };
}

/** Crea el prisma: laterales + tapa desplazada. */
function extrudeFace(geo: Geometry, faceId: Id, offset: Vec3, keepOriginal: boolean): PushPullResult {
  const face = geo.faces.get(faceId)!;
  const enclosed = isEnclosed(geo, faceId);
  const originalPlane = face.plane;

  // Puntos de partida de cada bucle (posiciones, no ids: las particiones
  // pueden cambiar los identificadores).
  const rings: Vec3[][] = face.loops.map((l) => l.vertices.map((v) => geo.vertexPos(v)));
  const movedRings = rings.map((ring) => ring.map((p) => addScaled(p, offset, 1)));

  const affected: Id[] = [];
  const planes: Plane[] = [];

  // Los planos existentes alrededor deben reconstruirse también.
  const neighbourFaces = new Set<Id>([faceId]);
  for (const eid of geo.faceEdges(faceId)) {
    for (const f of geo.edgeFaces.get(eid) ?? []) neighbourFaces.add(f);
  }
  planes.push(...collectPlanesFromFaces(geo, neighbourFaces));

  // Tapa desplazada.
  for (const ring of movedRings) {
    const r = insertPolyline(geo, ring, true);
    affected.push(...r.affectedEdges);
  }

  // Aristas verticales.
  for (let i = 0; i < rings.length; i++) {
    for (let j = 0; j < rings[i].length; j++) {
      const r = insertSegment(geo, rings[i][j], movedRings[i][j]);
      affected.push(...r.affectedEdges);
    }
  }

  // Plano de la tapa.
  const capPlane = planeCanonical(
    planeFromPointNormal(movedRings[0][0], originalPlane.n),
  );
  planes.push(capPlane);
  planes.push(...collectCandidatePlanes(geo, affected));

  const before = new Set(geo.faces.keys());
  const rb = rebuildFaces(geo, planes, { newEdges: new Set(affected) });

  // Si la cara original quedó encerrada entre dos volúmenes, se elimina.
  let removedOriginal = false;
  if (enclosed && !keepOriginal) {
    const inner = findFaceAt(geo, originalPlane, [...geo.faces.keys()]);
    if (inner !== null) {
      geo.removeFace(inner);
      removedOriginal = true;
    }
  }

  // Los agujeros deben atravesar el volumen: se retira la cara que el
  // reconstructor crea tapando cada agujero en el plano desplazado, igual que
  // hace SketchUp al extruir una cara con huecos.
  for (let i = 1; i < movedRings.length; i++) {
    const capOverHole = findFaceWithBoundary(geo, capPlane, movedRings[i]);
    if (capOverHole !== null) {
      geo.suppressedRegions.add(pointSetKey(movedRings[i]));
      geo.removeFace(capOverHole);
    }
  }

  const removed = [...before].filter((f) => !geo.faces.has(f));
  const cap = findFaceAt(geo, capPlane, [...geo.faces.keys()], movedRings[0]);

  orientFacesConsistently(geo, [
    ...(cap !== null ? [cap] : []),
    ...rb.created.filter((f) => geo.faces.has(f)),
    ...[...neighbourFaces].filter((f) => geo.faces.has(f)),
  ]);

  return {
    faceId: cap,
    mode: 'extrude',
    createdFaces: rb.created.filter((f) => geo.faces.has(f)),
    removedFaces: removed.concat(removedOriginal ? [] : []),
    distance: Math.hypot(offset.x, offset.y, offset.z),
  };
}

/**
 * Busca entre `candidates` la cara contenida en `plane`. Si se aportan puntos
 * de referencia, se elige la que los contenga (por cercanía del centroide).
 */
function findFaceAt(
  geo: Geometry,
  plane: Plane,
  candidates: Id[],
  reference?: Vec3[],
): Id | null {
  const target = planeCanonical(plane);
  let best: Id | null = null;
  let bestScore = Infinity;
  let bestArea = -1;

  let refCentroid: Vec3 | null = null;
  if (reference && reference.length > 0) {
    let x = 0, y = 0, z = 0;
    for (const p of reference) { x += p.x; y += p.y; z += p.z; }
    refCentroid = { x: x / reference.length, y: y / reference.length, z: z / reference.length };
  }

  for (const fid of candidates) {
    const f = geo.faces.get(fid);
    if (!f) continue;
    const c = planeCanonical(f.plane);
    const aligned = Math.abs(Math.abs(dot(c.n, target.n)) - 1) < 1e-6 && Math.abs(c.d - target.d) < 1e-5;
    if (!aligned) continue;

    if (refCentroid) {
      const cen = faceCentroid(geo, fid);
      const score = cen ? distance(cen, refCentroid) : Infinity;
      if (score < bestScore) {
        bestScore = score;
        best = fid;
      }
    } else {
      const a = faceArea(geo, fid);
      if (a > bestArea) {
        bestArea = a;
        best = fid;
      }
    }
  }
  return best;
}

/**
 * Clave estable de un conjunto de puntos, con el mismo formato que usa el
 * reconstructor para las regiones suprimidas.
 */
function pointSetKey(points: readonly Vec3[]): string {
  const q = (n: number) => (Math.round(n * 1e6) / 1e6).toFixed(6);
  return points.map((p) => `${q(p.x)},${q(p.y)},${q(p.z)}`).sort().join(';');
}

/** Cara del plano indicado cuyo contorno exterior coincide con `boundary`. */
function findFaceWithBoundary(geo: Geometry, plane: Plane, boundary: readonly Vec3[]): Id | null {
  const target = pointSetKey(boundary);
  const canon = planeCanonical(plane);
  for (const f of geo.faces.values()) {
    const c = planeCanonical(f.plane);
    if (Math.abs(Math.abs(dot(c.n, canon.n)) - 1) > 1e-6) continue;
    if (Math.abs(c.d - canon.d) > 1e-5) continue;
    const pts = f.loops[0].vertices.map((v) => geo.vertexPos(v));
    if (pts.length !== boundary.length) continue;
    if (pointSetKey(pts) === target) return f.id;
  }
  return null;
}

/**
 * Distancia de empuje deducida de la posición del ratón: proyección del
 * desplazamiento del cursor sobre la normal de la cara.
 */
export function pushPullDistanceFromPoints(
  faceNormal: Vec3,
  start: Vec3,
  current: Vec3,
): number {
  return dot(sub(current, start), normalize(faceNormal));
}
