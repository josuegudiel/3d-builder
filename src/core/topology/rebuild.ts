import { Geometry } from '../model/geometry';
import { Id, Loop, Face } from '../model/types';
import { Vec2, Vec3, dot } from '../math/vec';
import {
  Plane, planeKey, planeFrom3Points, planeCanonical, planeFlip, planeContains,
  to2D, PlaneBasis,
} from '../math/plane';
import { EPS, PLANE_EPS } from '../math/tolerance';
import { interiorPoint2, pointInPolygon2 } from '../math/geom';
import { computeArrangement, Cycle, Region, regionKey } from './arrangement';
import { reverseLoop } from './loops';
import { regionKeyOf, keyPoints } from './keys';

export interface RebuildOptions {
  /**
   * Aristas dibujadas de nuevo sobre trazos existentes. Si una región borrada a
   * mano contiene alguna de estas aristas, se vuelve a crear (como en SketchUp,
   * donde repasar una arista regenera la cara).
   */
  retracedEdges?: ReadonlySet<Id>;
  /** Aristas recién creadas: también reactivan regiones suprimidas. */
  newEdges?: ReadonlySet<Id>;
  /** Si se indica, las caras nuevas se orientan hacia este vector. */
  orientToward?: Vec3;
}

export interface RebuildResult {
  created: Id[];
  removed: Id[];
  kept: Id[];
}

/** Clave estable de una cara existente, análoga a `regionKey`. */
export function faceRegionKey(geo: Geometry, faceId: Id): string {
  const f = geo.faces.get(faceId);
  if (!f || f.loops.length === 0) return '';
  const pointsOf = (loop: Loop) => loop.vertices
    .map((v) => geo.vertices.get(v)?.p)
    .filter((p): p is NonNullable<typeof p> => p !== undefined);
  return regionKeyOf(pointsOf(f.loops[0]), f.loops.slice(1).map(pointsOf));
}

/**
 * Descarta las regiones suprimidas cuyos vértices ya no existen.
 *
 * Sin esta poda el conjunto crecería sin límite: cada cara borrada dejaría su
 * huella para siempre, se copiaría en cada instantánea de deshacer y se
 * escribiría en cada archivo guardado.
 */
export function pruneSuppressedRegions(geo: Geometry): number {
  if (geo.suppressedRegions.size === 0) return 0;
  let removed = 0;
  for (const key of [...geo.suppressedRegions]) {
    const points = keyPoints(key);
    if (points.length === 0) {
      geo.suppressedRegions.delete(key);
      removed++;
      continue;
    }
    let alive = true;
    for (const [x, y, z] of points) {
      if (geo.findVertexAt({ x, y, z }, 1e-5) === null) {
        alive = false;
        break;
      }
    }
    if (!alive) {
      geo.suppressedRegions.delete(key);
      removed++;
    }
  }
  return removed;
}

/**
 * Planos candidatos donde pueden haberse formado o destruido caras tras
 * modificar las aristas indicadas.
 *
 * Para cada arista modificada se consideran:
 *  - los planos de las caras que ya la usan;
 *  - el plano definido por la arista y cada arista vecina en sus extremos.
 *
 * Basta con vecinos a un salto: el contorno de cualquier cara que pase por la
 * arista nueva incluye necesariamente otra arista incidente en sus extremos.
 */
export function collectCandidatePlanes(geo: Geometry, edgeIds: Iterable<Id>): Plane[] {
  const found = new Map<string, Plane>();

  const addPlane = (p: Plane | null) => {
    if (!p) return;
    const c = planeCanonical(p);
    const k = planeKey(c);
    if (!found.has(k)) found.set(k, c);
  };

  for (const eid of edgeIds) {
    const e = geo.edges.get(eid);
    if (!e) continue;

    for (const fid of geo.edgeFaces.get(eid) ?? []) {
      const f = geo.faces.get(fid);
      if (f) addPlane(f.plane);
    }

    const pa = geo.vertices.get(e.a)?.p;
    const pb = geo.vertices.get(e.b)?.p;
    if (!pa || !pb) continue;

    for (const [v, pv, pOther] of [
      [e.a, pa, pb],
      [e.b, pb, pa],
    ] as Array<[Id, Vec3, Vec3]>) {
      for (const nid of geo.vertexEdges.get(v) ?? []) {
        if (nid === eid) continue;
        const ne = geo.edges.get(nid);
        if (!ne) continue;
        const otherV = ne.a === v ? ne.b : ne.a;
        const po = geo.vertices.get(otherV)?.p;
        if (!po) continue;
        addPlane(planeFrom3Points(pOther, pv, po));
      }
    }
  }

  return [...found.values()];
}

/** Planos de un conjunto de caras (útil antes de borrarlas). */
export function collectPlanesFromFaces(geo: Geometry, faceIds: Iterable<Id>): Plane[] {
  const found = new Map<string, Plane>();
  for (const fid of faceIds) {
    const f = geo.faces.get(fid);
    if (!f) continue;
    const c = planeCanonical(f.plane);
    found.set(planeKey(c), c);
  }
  return [...found.values()];
}

interface OldFaceInfo {
  id: Id;
  poly2: Vec2[];
  holes2: Vec2[][];
  /** Caja envolvente 2D y área, para descartar sin probar el polígono. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
  frontMaterial: string | null;
  backMaterial: string | null;
  hidden: boolean;
  flipped: boolean;
  signature: string;
}

/**
 * Reconstruye las caras contenidas en los planos indicados.
 *
 * Estrategia: en cada plano se calcula el arreglo planar completo de sus
 * aristas y se comparan las regiones resultantes con las caras existentes.
 *  - Región cuya firma coincide con una cara existente → la cara se conserva
 *    (mantiene su identificador, material y selección).
 *  - Región nueva → se crea una cara, heredando el material y la orientación de
 *    la cara antigua que la contenía.
 *  - Cara existente sin región correspondiente → se elimina.
 */
export function rebuildFaces(
  geo: Geometry,
  planes: readonly Plane[],
  opts: RebuildOptions = {},
): RebuildResult {
  const created: Id[] = [];
  const removed: Id[] = [];
  const kept: Id[] = [];

  pruneSuppressedRegions(geo);

  const seen = new Set<string>();
  for (const planeIn of planes) {
    const plane = planeCanonical(planeIn);
    const key = planeKey(plane);
    if (seen.has(key)) continue;
    seen.add(key);

    const r = rebuildPlane(geo, plane, opts);
    created.push(...r.created);
    removed.push(...r.removed);
    kept.push(...r.kept);
  }

  return { created, removed, kept };
}

function rebuildPlane(geo: Geometry, plane: Plane, opts: RebuildOptions): RebuildResult {
  const edgeIds = geo.edgesOnPlane(plane, PLANE_EPS);

  // Una cara pertenece al plano si TODOS sus vértices están en él. Es el mismo
  // criterio que usa `edgesOnPlane`, de modo que nunca puede ocurrir que las
  // aristas de una cara entren en el arreglo y la cara se quede fuera de la
  // lista de existentes: eso dejaría dos caras coplanares superpuestas.
  //
  // Las candidatas salen de las propias aristas del plano: una cara contenida
  // en él tiene todas sus aristas ahí, así que aparece necesariamente. Evita
  // recorrer todas las caras del modelo en cada plano.
  const candidateFaces = new Set<Id>();
  for (const eid of edgeIds) {
    for (const fid of geo.edgeFaces.get(eid) ?? []) candidateFaces.add(fid);
  }

  const existing: Id[] = [];
  for (const fid of candidateFaces) {
    const f = geo.faces.get(fid);
    if (!f) continue;
    let onPlane = true;
    for (const loop of f.loops) {
      for (const v of loop.vertices) {
        const p = geo.vertices.get(v);
        if (!p || !planeContains(plane, p.p, PLANE_EPS)) {
          onPlane = false;
          break;
        }
      }
      if (!onPlane) break;
    }
    if (onPlane) existing.push(fid);
  }

  if (edgeIds.length === 0) {
    // Sin aristas en el plano no puede quedar ninguna cara. Aquí sí hace falta
    // el barrido completo: no hay aristas de las que partir.
    const orphans: Id[] = [];
    for (const f of geo.faces.values()) {
      let onPlane = f.loops.length > 0;
      for (const loop of f.loops) {
        for (const v of loop.vertices) {
          const p = geo.vertices.get(v);
          if (!p || !planeContains(plane, p.p, PLANE_EPS)) {
            onPlane = false;
            break;
          }
        }
        if (!onPlane) break;
      }
      if (onPlane) orphans.push(f.id);
    }
    for (const id of orphans) geo.removeFace(id);
    return { created: [], removed: orphans, kept: [] };
  }

  const arr = computeArrangement(geo, plane, edgeIds);
  const basis = arr.basis;

  // --- Información de las caras previas (para heredar material/orientación) --
  const oldFaces: OldFaceInfo[] = [];
  for (const id of existing) {
    const f = geo.faces.get(id);
    if (!f) continue;
    const poly2 = f.loops[0]?.vertices.map((v) => to2D(basis, geo.vertexPos(v))) ?? [];
    const holes2 = f.loops.slice(1).map((l) => l.vertices.map((v) => to2D(basis, geo.vertexPos(v))));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of poly2) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    oldFaces.push({
      id,
      poly2,
      holes2,
      minX,
      minY,
      maxX,
      maxY,
      area: Math.abs(polyArea(poly2)),
      frontMaterial: f.frontMaterial,
      backMaterial: f.backMaterial,
      hidden: f.hidden,
      flipped: dot(f.plane.n, plane.n) < 0,
      signature: faceSignature(f),
    });
  }

  // Orden ascendente por área: `findContainingOldFace` devuelve la primera que
  // contiene el punto, que es ya la más pequeña.
  const oldFacesByArea = [...oldFaces].sort((a, b) => a.area - b.area);

  const bySignature = new Map<string, OldFaceInfo>();
  for (const info of oldFaces) {
    if (!bySignature.has(info.signature)) bySignature.set(info.signature, info);
  }

  const keptIds = new Set<Id>();
  const created: Id[] = [];

  const retraced = opts.retracedEdges;
  const fresh = opts.newEdges;

  // --- Recorrer las regiones del arreglo ------------------------------------
  interface PendingFace {
    region: Region;
    signature: string;
    interior: Vec2 | null;
  }
  const pending: PendingFace[] = [];

  for (const region of arr.regions) {
    const signature = regionSignature(region);
    const match = bySignature.get(signature);
    if (match && geo.faces.has(match.id)) {
      keptIds.add(match.id);
      continue;
    }

    // Región suprimida por el usuario: sólo revive si se ha vuelto a trazar
    // alguna de sus aristas de contorno.
    const rkey = regionKey(geo, region);
    if (geo.suppressedRegions.has(rkey)) {
      const revived = regionTouches(region, retraced) || regionTouches(region, fresh);
      if (!revived) continue;
      geo.suppressedRegions.delete(rkey);
    }

    const poly = region.outer.halves.map((h) => arr.points.get(h.from)!);
    pending.push({ region, signature, interior: interiorPoint2(poly) });
  }

  // --- Eliminar las caras que ya no corresponden a ninguna región -----------
  const removed: Id[] = [];
  for (const info of oldFaces) {
    if (keptIds.has(info.id)) continue;
    geo.removeFace(info.id);
    removed.push(info.id);
  }

  // --- Crear las caras nuevas ----------------------------------------------
  for (const p of pending) {
    const loops = buildLoops(geo, p.region, basis);
    if (!loops) continue;

    const inherited = p.interior ? findContainingOldFace(oldFacesByArea, p.interior) : null;
    let facePlane = plane;
    let front = inherited?.frontMaterial ?? null;
    let back = inherited?.backMaterial ?? null;

    if (inherited?.flipped) {
      facePlane = planeFlip(plane);
    } else if (!inherited && opts.orientToward) {
      if (dot(plane.n, opts.orientToward) < 0) facePlane = planeFlip(plane);
    }

    // Si la cara se invierte, los bucles deben recorrerse al revés para que el
    // contorno exterior siga siendo antihorario visto desde el frente.
    const finalLoops = dot(facePlane.n, plane.n) < 0 ? loops.map(reverseLoop) : loops;

    const id = geo.addFace(finalLoops, facePlane, front, back);
    if (inherited?.hidden) {
      const f = geo.faces.get(id);
      if (f) f.hidden = true;
    }
    created.push(id);
  }

  return { created, removed, kept: [...keptIds] };
}

function regionTouches(region: Region, set: ReadonlySet<Id> | undefined): boolean {
  if (!set || set.size === 0) return false;
  for (const h of region.outer.halves) if (set.has(h.edgeId)) return true;
  for (const hole of region.holes) {
    for (const h of hole.halves) if (set.has(h.edgeId)) return true;
  }
  return false;
}

/** Firma topológica de una región: conjunto ordenado de aristas por bucle. */
function regionSignature(region: Region): string {
  const loopSig = (c: Cycle) => [...c.halves.map((h) => h.edgeId)].sort((a, b) => a - b).join(',');
  const holes = region.holes.map(loopSig).sort();
  return `${loopSig(region.outer)}#${holes.join('#')}`;
}

function faceSignature(f: Face): string {
  const loopSig = (l: Loop) => [...l.edges].sort((a, b) => a - b).join(',');
  const holes = f.loops.slice(1).map(loopSig).sort();
  return `${loopSig(f.loops[0])}#${holes.join('#')}`;
}

function buildLoops(geo: Geometry, region: Region, _basis: PlaneBasis): Loop[] | null {
  const loops: Loop[] = [];
  const outer = cycleToLoop(geo, region.outer);
  if (!outer) return null;
  loops.push(outer);
  for (const hole of region.holes) {
    const l = cycleToLoop(geo, hole);
    if (l) loops.push(l);
  }
  return loops;
}

function cycleToLoop(geo: Geometry, cycle: Cycle): Loop | null {
  const edges: Id[] = [];
  const dirs: boolean[] = [];
  const vertices: Id[] = [];
  for (const h of cycle.halves) {
    const e = geo.edges.get(h.edgeId);
    if (!e) return null;
    edges.push(h.edgeId);
    dirs.push(h.dir);
    vertices.push(h.from);
  }
  if (edges.length < 3) return null;
  return { edges, dirs, vertices };
}

/**
 * Cara antigua más pequeña que contiene el punto, de la que la nueva región
 * heredará material y orientación.
 *
 * `oldFaces` llega ordenado por área ascendente, de modo que se puede devolver
 * la primera que lo contenga; la caja envolvente descarta el resto sin llegar
 * a la prueba de punto-en-polígono.
 */
function findContainingOldFace(oldFaces: readonly OldFaceInfo[], p: Vec2): OldFaceInfo | null {
  for (const info of oldFaces) {
    if (info.poly2.length < 3) continue;
    if (p.x < info.minX || p.x > info.maxX || p.y < info.minY || p.y > info.maxY) continue;
    if (!pointInPolygon2(info.poly2, p)) continue;
    let inHole = false;
    for (const hole of info.holes2) {
      if (hole.length >= 3 && pointInPolygon2(hole, p)) {
        inHole = true;
        break;
      }
    }
    if (inHole) continue;
    return info;
  }
  return null;
}

function polyArea(poly: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}

/**
 * Punto de conveniencia: inserta las aristas indicadas y reconstruye las caras
 * de todos los planos afectados en una sola llamada.
 */
export function rebuildAround(
  geo: Geometry,
  affectedEdges: Iterable<Id>,
  opts: RebuildOptions = {},
  extraPlanes: readonly Plane[] = [],
): RebuildResult {
  const planes = [...collectCandidatePlanes(geo, affectedEdges), ...extraPlanes];
  return rebuildFaces(geo, planes, opts);
}

/** Marca la región de una cara como suprimida y elimina la cara. */
export function deleteFaceKeepingEdges(geo: Geometry, faceId: Id): void {
  const key = faceRegionKey(geo, faceId);
  if (key) geo.suppressedRegions.add(key);
  geo.removeFace(faceId);
}

/** Tolerancia usada al comparar planos; expuesta para las pruebas. */
export const REBUILD_PLANE_EPS = PLANE_EPS;
export { EPS as REBUILD_EPS };
