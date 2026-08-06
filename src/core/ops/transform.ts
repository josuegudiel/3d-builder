import { Geometry } from '../model/geometry';
import { Id } from '../model/types';
import { Vec3, add, sub, dot, mul, normalize, distance } from '../math/vec';
import { Mat4, matMul, matTranslation, matRotation, matScale, transformPoint } from '../math/mat';
import { Plane, planeFromPolygon, planeDistance } from '../math/plane';
import { EPS } from '../math/tolerance';
import { collectCandidatePlanes, collectPlanesFromFaces, rebuildFaces } from '../topology/rebuild';
import { weldCoincidentVertices, removeDegenerateEdges } from '../topology/weld';
import { insertSegment } from '../topology/insert';
import { orientFacesConsistently } from '../topology/orient';
import { planeBasis, to2D } from '../math/plane';
import earcut from 'earcut';

/** Entidades sobre las que actúa una transformación. */
export interface TransformTargets {
  vertices?: Iterable<Id>;
  edges?: Iterable<Id>;
  faces?: Iterable<Id>;
  instances?: Iterable<Id>;
}

export interface TransformResult {
  movedVertices: Id[];
  createdFaces: Id[];
  removedFaces: Id[];
  /** Aristas añadidas para triangular caras que dejaron de ser planas. */
  repairEdges: Id[];
}

/** Vértices afectados por un conjunto de entidades. */
export function resolveVertices(geo: Geometry, targets: TransformTargets): Set<Id> {
  const out = new Set<Id>();
  for (const v of targets.vertices ?? []) {
    if (geo.vertices.has(v)) out.add(v);
  }
  for (const e of targets.edges ?? []) {
    const edge = geo.edges.get(e);
    if (!edge) continue;
    out.add(edge.a);
    out.add(edge.b);
  }
  for (const f of targets.faces ?? []) {
    for (const v of geo.faceVertices(f)) out.add(v);
  }
  return out;
}

/**
 * Aplica una matriz a las entidades indicadas.
 *
 * La geometría conectada se estira: si se mueve una cara, las aristas que
 * llegan a sus vértices desde el resto del modelo la siguen, exactamente como
 * en SketchUp. Las caras que dejan de ser planas se triangulan añadiendo
 * diagonales suaves.
 */
export function transformEntities(
  geo: Geometry,
  targets: TransformTargets,
  matrix: Mat4,
): TransformResult {
  // --- Instancias: basta con componer su transformación --------------------
  for (const id of targets.instances ?? []) {
    const inst = geo.instances.get(id);
    if (inst) inst.transform = matMul(matrix, inst.transform);
  }

  const verts = resolveVertices(geo, targets);
  if (verts.size === 0) {
    return { movedVertices: [], createdFaces: [], removedFaces: [], repairEdges: [] };
  }

  // --- Planos y caras implicados ANTES de mover -----------------------------
  const touchedFaces = new Set<Id>();
  const touchedEdges = new Set<Id>();
  for (const v of verts) {
    for (const e of geo.vertexEdges.get(v) ?? []) {
      touchedEdges.add(e);
      for (const f of geo.edgeFaces.get(e) ?? []) touchedFaces.add(f);
    }
  }
  const planesBefore: Plane[] = [
    ...collectPlanesFromFaces(geo, touchedFaces),
    ...collectCandidatePlanes(geo, touchedEdges),
  ];

  // --- Mover ----------------------------------------------------------------
  for (const v of verts) {
    geo.moveVertex(v, transformPoint(matrix, geo.vertexPos(v)));
  }

  // --- Actualizar los planos de las caras afectadas -------------------------
  for (const fid of touchedFaces) {
    const f = geo.faces.get(fid);
    if (!f) continue;
    const pts = f.loops[0].vertices.map((v) => geo.vertexPos(v));
    const pl = planeFromPolygon(pts);
    if (pl) f.plane = dot(pl.n, f.plane.n) >= 0 ? pl : { n: mul(pl.n, -1), d: -pl.d };
  }

  // --- Triangular las caras que han dejado de ser planas --------------------
  const repairEdges = repairNonPlanarFaces(geo, touchedFaces);

  // --- Soldar vértices coincidentes y limpiar -------------------------------
  const weld = weldCoincidentVertices(geo, verts);
  removeDegenerateEdges(geo);

  // --- Reconstruir ----------------------------------------------------------
  const liveEdges = [...touchedEdges, ...weld.affectedEdges, ...repairEdges]
    .filter((e) => geo.edges.has(e));
  const planes: Plane[] = [
    ...planesBefore,
    ...collectCandidatePlanes(geo, liveEdges),
    ...collectPlanesFromFaces(geo, [...touchedFaces].filter((f) => geo.faces.has(f))),
  ];

  const before = new Set(geo.faces.keys());
  const rb = rebuildFaces(geo, planes, { newEdges: new Set(repairEdges) });
  const removed = [...before].filter((f) => !geo.faces.has(f));

  orientFacesConsistently(geo, [
    ...rb.created,
    ...[...touchedFaces].filter((f) => geo.faces.has(f)),
  ]);

  return {
    movedVertices: [...verts],
    createdFaces: rb.created,
    removedFaces: removed,
    repairEdges,
  };
}

/**
 * Detecta caras cuyos vértices ya no son coplanares y las divide en triángulos
 * añadiendo diagonales marcadas como suaves (no se dibujan, pero mantienen la
 * geometría correcta). Es lo que hace SketchUp al deformar un cuadrilátero.
 */
function repairNonPlanarFaces(geo: Geometry, faceIds: Iterable<Id>): Id[] {
  const added: Id[] = [];

  for (const fid of faceIds) {
    const f = geo.faces.get(fid);
    if (!f) continue;
    const loop = f.loops[0];
    if (loop.vertices.length < 4) continue;

    const pts = loop.vertices.map((v) => geo.vertexPos(v));
    const pl = planeFromPolygon(pts);
    if (!pl) continue;

    let maxDev = 0;
    for (const p of pts) maxDev = Math.max(maxDev, Math.abs(planeDistance(pl, p)));
    // Tolerancia relativa al tamaño de la cara para no dividir por ruido.
    let size = 0;
    for (let i = 0; i < pts.length; i++) size = Math.max(size, distance(pts[i], pts[(i + 1) % pts.length]));
    if (maxDev <= Math.max(EPS, size * 1e-6)) continue;

    // Triangular sobre el plano de mejor ajuste y añadir las diagonales.
    const basis = planeBasis(pl);
    const flat: number[] = [];
    for (const p of pts) {
      const q = to2D(basis, p);
      flat.push(q.x, q.y);
    }
    const tri = earcut(flat, undefined, 2);
    const n = pts.length;
    const isBoundary = (a: number, b: number) => (a + 1) % n === b || (b + 1) % n === a;

    const done = new Set<string>();
    for (let i = 0; i < tri.length; i += 3) {
      const idx = [tri[i], tri[i + 1], tri[i + 2]];
      for (let k = 0; k < 3; k++) {
        const a = idx[k];
        const b = idx[(k + 1) % 3];
        if (isBoundary(a, b)) continue;
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (done.has(key)) continue;
        done.add(key);
        const r = insertSegment(geo, pts[a], pts[b]);
        for (const eid of r.newEdges) {
          const e = geo.edges.get(eid);
          if (e) {
            e.soft = true;
            e.smooth = true;
          }
          added.push(eid);
        }
      }
    }
  }

  return added;
}

/** Traslada las entidades indicadas. */
export function moveEntities(geo: Geometry, targets: TransformTargets, delta: Vec3): TransformResult {
  return transformEntities(geo, targets, matTranslation(delta));
}

/** Rota las entidades alrededor de un eje que pasa por `origin`. */
export function rotateEntities(
  geo: Geometry,
  targets: TransformTargets,
  axis: Vec3,
  angle: number,
  origin: Vec3,
): TransformResult {
  return transformEntities(geo, targets, matRotation(axis, angle, origin));
}

/** Escala las entidades respecto de `origin`. */
export function scaleEntities(
  geo: Geometry,
  targets: TransformTargets,
  factors: Vec3,
  origin: Vec3,
): TransformResult {
  return transformEntities(geo, targets, matScale(factors, origin));
}

/**
 * Copia las entidades indicadas aplicándoles una transformación.
 * Es la operación que ejecuta Mover/Rotar con Ctrl pulsado.
 */
export function copyEntities(
  geo: Geometry,
  targets: TransformTargets,
  matrix: Mat4,
): { createdEdges: Id[]; createdFaces: Id[]; createdInstances: Id[] } {
  const createdEdges: Id[] = [];
  const createdInstances: Id[] = [];

  // Aristas a copiar: las indicadas más las de las caras.
  const edges = new Set<Id>(targets.edges ?? []);
  for (const f of targets.faces ?? []) {
    for (const e of geo.faceEdges(f)) edges.add(e);
  }

  const affected: Id[] = [];
  for (const eid of edges) {
    const e = geo.edges.get(eid);
    if (!e) continue;
    const a = transformPoint(matrix, geo.vertexPos(e.a));
    const b = transformPoint(matrix, geo.vertexPos(e.b));
    const r = insertSegment(geo, a, b);
    createdEdges.push(...r.newEdges);
    affected.push(...r.affectedEdges);
  }

  for (const id of targets.instances ?? []) {
    const inst = geo.instances.get(id);
    if (!inst) continue;
    createdInstances.push(geo.addInstance({
      definitionId: inst.definitionId,
      transform: matMul(matrix, inst.transform),
      name: inst.name,
      materialId: inst.materialId,
      hidden: inst.hidden,
      locked: inst.locked,
    }));
  }

  const rb = rebuildFaces(geo, collectCandidatePlanes(geo, affected), {
    newEdges: new Set(createdEdges),
  });
  orientFacesConsistently(geo, rb.created);

  return { createdEdges, createdFaces: rb.created, createdInstances };
}

/**
 * Descompone un vector de desplazamiento en la componente paralela a un eje.
 * Se usa al bloquear la dirección de movimiento con las flechas del teclado.
 */
export function projectOnAxis(delta: Vec3, axis: Vec3): Vec3 {
  const a = normalize(axis);
  return mul(a, dot(delta, a));
}

/** Desplazamiento necesario para llevar `from` a `to` restringido a un eje. */
export function axisConstrainedDelta(from: Vec3, to: Vec3, axis: Vec3 | null): Vec3 {
  const d = sub(to, from);
  return axis ? projectOnAxis(d, axis) : d;
}

/** Suma de un punto y un desplazamiento (reexport por comodidad). */
export { add as addPoints };
