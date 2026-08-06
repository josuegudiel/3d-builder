import { Id } from '../core/model/types';
import { Vec3, sub, add, mul, dot, lengthSq, addScaled } from '../core/math/vec';
import { Ray } from '../core/math/geom';
import { rayTriangleFast, rayPointDistanceSq, rayDepth, raySegmentDistance } from './fastmath';
import { clamp } from '../core/math/tolerance';
import { PickCache, PickGroup } from '../render/scene';
import { Viewport } from '../render/viewport';
import { SNAP_PIXELS } from '../render/theme';

export type PickKind = 'vertex' | 'edge' | 'face' | 'instance';

export interface PickResult {
  kind: PickKind;
  id: Id;
  /** Ruta de instancias hasta el contenedor de la entidad. */
  path: Id[];
  /** Punto exacto en coordenadas del mundo. */
  point: Vec3;
  /** Distancia a lo largo del rayo. */
  distance: number;
  /** Distancia en píxeles al cursor (0 para caras). */
  screenDistance: number;
  /** Sólo para aristas: parámetro del punto sobre la arista. */
  t?: number;
}

export interface PickOptions {
  /** Permitir seleccionar vértices. */
  vertices?: boolean;
  /** Permitir seleccionar aristas. */
  edges?: boolean;
  /** Permitir seleccionar caras. */
  faces?: boolean;
  /** Permitir seleccionar instancias (grupos y componentes). */
  instances?: boolean;
  /** Radio de captura en píxeles (multiplicador). */
  toleranceScale?: number;
}

const DEFAULTS: Required<PickOptions> = {
  vertices: true, edges: true, faces: true, instances: true, toleranceScale: 1,
};

interface ScreenPoint {
  x: number;
  y: number;
  depth: number;
}

/**
 * Selecciona la entidad más adecuada bajo el cursor.
 *
 * El orden de preferencia reproduce el de SketchUp: primero los vértices,
 * después las aristas y por último las caras. Los vértices y aristas ocultos
 * detrás de una cara no se consideran, de modo que sólo se engancha a lo que
 * realmente se ve.
 */
export function pickEntity(
  cache: PickCache,
  viewport: Viewport,
  clientX: number,
  clientY: number,
  options: PickOptions = {},
): PickResult | null {
  const opts = { ...DEFAULTS, ...options };
  const ray = viewport.rayFromClient(clientX, clientY);
  const cursor = viewport.toLocal(clientX, clientY);

  /**
   * Radio en unidades del mundo que corresponde a `px` píxeles a una
   * profundidad dada. Permite descartar candidatos con aritmética escalar,
   * antes de proyectar nada a pantalla, que es la parte cara.
   */
  const worldRadius = (px: number, depth: number) =>
    px * viewport.worldPerPixel(addScaled(ray.origin, ray.dir, Math.max(depth, 1e-6)));

  // Bloques cuya caja envolvente cruza el rayo, con un margen para que los
  // enganches a vértices y aristas cercanos al borde no se pierdan.
  const active = visibleGroups(cache, ray, viewport);

  // --- 1. Cara más cercana --------------------------------------------------
  let faceHit: PickResult | null = null;
  let faceT = Infinity;
  for (const g of active) {
    for (let i = g.triStart; i < g.triEnd; i++) {
      const tri = cache.triangles[i];
      const t = rayTriangleFast(ray, tri.a, tri.b, tri.c);
      if (t < 0 || t >= faceT) continue;
      faceT = t;
      const point = addScaled(ray.origin, ray.dir, t);
      if (tri.active) {
        faceHit = {
          kind: 'face', id: tri.faceId, path: tri.path, point, distance: t, screenDistance: 0,
        };
      } else if (tri.topInstance !== null) {
        faceHit = {
          kind: 'instance', id: tri.topInstance, path: tri.path.slice(0, tri.path.length),
          point, distance: t, screenDistance: 0,
        };
      } else {
        faceHit = null;
      }
    }
  }

  // Margen de profundidad para considerar "visible" lo que está justo delante.
  const depthSlack = faceT === Infinity ? Infinity : faceT + Math.max(faceT * 1e-3, 1e-5);

  // --- 2. Vértices ----------------------------------------------------------
  let best: PickResult | null = null;
  if (opts.vertices) {
    const tol = SNAP_PIXELS.vertex * opts.toleranceScale;
    let bestD = tol;
    for (const g of active) {
      for (let i = g.vertStart; i < g.vertEnd; i++) {
      const v = cache.vertices[i];
      if (!v.active) continue;
      const along = rayDepth(ray, v.p);
      if (along <= 0 || along > depthSlack) continue;
      // Rechazo barato en el espacio del mundo, con margen de seguridad.
      const limit = worldRadius(tol * 1.5, along);
      if (rayPointDistanceSq(ray, v.p) > limit * limit) continue;

      const s = project(viewport, v.p);
      if (!s || s.depth <= 0) continue;
      const d = Math.hypot(s.x - cursor.x, s.y - cursor.y);
      if (d < bestD) {
        bestD = d;
        best = {
          kind: 'vertex', id: v.vertexId, path: v.path, point: v.p,
          distance: along, screenDistance: d,
        };
      }
      }
    }
    if (best) return best;
  }

  // --- 3. Aristas -----------------------------------------------------------
  if (opts.edges) {
    const tol = SNAP_PIXELS.edge * opts.toleranceScale;
    let bestD = tol;
    for (const g of active) {
      for (let i = g.segStart; i < g.segEnd; i++) {
      const seg = cache.segments[i];
      if (!seg.active) continue;
      const near = raySegmentDistance(ray, seg.a, seg.b);
      if (near.depth <= 0 || near.depth > depthSlack) continue;
      const limit = worldRadius(tol * 1.5, near.depth);
      if (near.distSq > limit * limit) continue;

      const sa = project(viewport, seg.a);
      const sb = project(viewport, seg.b);
      if (!sa || !sb || sa.depth <= 0 || sb.depth <= 0) continue;
      const { dist, t } = pointSegmentDistance2D(cursor, sa, sb);
      if (dist >= bestD) continue;
      const point = add(seg.a, mul(sub(seg.b, seg.a), t));
      const along = dot(sub(point, ray.origin), ray.dir);
      if (along > depthSlack) continue;
      bestD = dist;
      best = {
        kind: 'edge', id: seg.edgeId, path: seg.path, point,
        distance: along, screenDistance: dist, t,
      };
      }
    }
    if (best) return best;
  }

  // --- 4. Aristas de instancias (para poder seleccionar grupos por su borde) -
  if (opts.instances) {
    const tol = SNAP_PIXELS.edge * opts.toleranceScale;
    let bestD = tol;
    for (const g of active) {
      for (let i = g.segStart; i < g.segEnd; i++) {
      const seg = cache.segments[i];
      if (seg.active || seg.topInstance === null) continue;
      const near = raySegmentDistance(ray, seg.a, seg.b);
      if (near.depth <= 0 || near.depth > depthSlack) continue;
      const limit = worldRadius(tol * 1.5, near.depth);
      if (near.distSq > limit * limit) continue;
      const sa = project(viewport, seg.a);
      const sb = project(viewport, seg.b);
      if (!sa || !sb || sa.depth <= 0 || sb.depth <= 0) continue;
      const { dist, t } = pointSegmentDistance2D(cursor, sa, sb);
      if (dist >= bestD) continue;
      const point = add(seg.a, mul(sub(seg.b, seg.a), t));
      const along = dot(sub(point, ray.origin), ray.dir);
      if (along > depthSlack) continue;
      bestD = dist;
      best = {
        kind: 'instance', id: seg.topInstance, path: seg.path, point,
        distance: along, screenDistance: dist,
      };
      }
    }
    if (best) return best;
  }

  // --- 5. Cara / instancia por rayo -----------------------------------------
  if (faceHit) {
    if (faceHit.kind === 'face' && !opts.faces) return null;
    if (faceHit.kind === 'instance' && !opts.instances) return null;
    return faceHit;
  }
  return null;
}

/** Sólo caras: útil para las herramientas que dibujan sobre una superficie. */
export function pickFace(
  cache: PickCache,
  viewport: Viewport,
  clientX: number,
  clientY: number,
): PickResult | null {
  const ray = viewport.rayFromClient(clientX, clientY);
  let bestT = Infinity;
  let result: PickResult | null = null;
  for (const g of visibleGroups(cache, ray, viewport)) {
    for (let i = g.triStart; i < g.triEnd; i++) {
      const tri = cache.triangles[i];
      if (!tri.active) continue;
      const t = rayTriangleFast(ray, tri.a, tri.b, tri.c);
      if (t < 0 || t >= bestT) continue;
      bestT = t;
      result = {
        kind: 'face', id: tri.faceId, path: tri.path,
        point: addScaled(ray.origin, ray.dir, t), distance: t, screenDistance: 0,
      };
    }
  }
  return result;
}

/** Todas las entidades cuya proyección cae dentro de un rectángulo. */
export interface BoxSelectResult {
  faces: Id[];
  edges: Id[];
  instances: Id[];
}

/**
 * Selección por ventana.
 * `crossing = true` incluye lo que sólo toca el rectángulo (ventana de derecha
 * a izquierda); `false` exige que la entidad quede completamente dentro.
 */
export function boxSelect(
  cache: PickCache,
  viewport: Viewport,
  x0: number, y0: number, x1: number, y1: number,
  crossing: boolean,
): BoxSelectResult {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);

  const inside = (p: ScreenPoint) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;

  const edges = new Set<Id>();
  const faces = new Set<Id>();
  const instances = new Set<Id>();
  const instanceAll = new Map<Id, { in: number; total: number }>();

  for (const seg of cache.segments) {
    const sa = project(viewport, seg.a);
    const sb = project(viewport, seg.b);
    if (!sa || !sb) continue;
    const ia = inside(sa);
    const ib = inside(sb);
    const hit = crossing
      ? ia || ib || segmentIntersectsRect(sa, sb, minX, minY, maxX, maxY)
      : ia && ib;

    if (seg.active) {
      if (hit) edges.add(seg.edgeId);
    } else if (seg.topInstance !== null) {
      const rec = instanceAll.get(seg.topInstance) ?? { in: 0, total: 0 };
      rec.total++;
      if (hit) rec.in++;
      instanceAll.set(seg.topInstance, rec);
    }
  }

  for (const [id, rec] of instanceAll) {
    if (crossing ? rec.in > 0 : rec.in === rec.total && rec.total > 0) instances.add(id);
  }

  // Una cara entra si todas (o alguna, en modo cruce) de sus aristas entran.
  const faceEdgeState = new Map<Id, { in: number; total: number }>();
  for (const tri of cache.triangles) {
    if (!tri.active) continue;
    const sa = project(viewport, tri.a);
    const sb = project(viewport, tri.b);
    const sc = project(viewport, tri.c);
    if (!sa || !sb || !sc) continue;
    const inCount = [sa, sb, sc].filter(inside).length;
    const rec = faceEdgeState.get(tri.faceId) ?? { in: 0, total: 0 };
    rec.total += 3;
    rec.in += inCount;
    faceEdgeState.set(tri.faceId, rec);
  }
  for (const [id, rec] of faceEdgeState) {
    if (crossing ? rec.in > 0 : rec.in === rec.total) faces.add(id);
  }

  return { faces: [...faces], edges: [...edges], instances: [...instances] };
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function project(viewport: Viewport, p: Vec3): ScreenPoint | null {
  const s = viewport.worldToScreen(p);
  if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) return null;
  return s;
}

function pointSegmentDistance2D(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): { dist: number; t: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  if (l2 <= 1e-12) return { dist: Math.hypot(p.x - a.x, p.y - a.y), t: 0 };
  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / l2, 0, 1);
  return {
    dist: Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t)),
    t,
  };
}

function segmentIntersectsRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  minX: number, minY: number, maxX: number, maxY: number,
): boolean {
  // Recorte de Liang–Barsky simplificado.
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const checks: Array<[number, number]> = [
    [-dx, a.x - minX], [dx, maxX - a.x],
    [-dy, a.y - minY], [dy, maxY - a.y],
  ];
  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}

/** Punto de la arista más cercano a un rayo (para engancharse a mitad de arista). */
export function closestPointOnSegmentToRay(a: Vec3, b: Vec3, ray: Ray): Vec3 {
  const ab = sub(b, a);
  const l2 = lengthSq(ab);
  if (l2 <= 1e-18) return a;
  const w0 = sub(a, ray.origin);
  const A = l2;
  const B = dot(ab, ray.dir);
  const C = 1;
  const D = dot(ab, w0);
  const E = dot(ray.dir, w0);
  const denom = A * C - B * B;
  if (Math.abs(denom) < 1e-15) return a;
  const s = clamp((B * E - C * D) / denom, 0, 1);
  return addScaled(a, ab, s);
}


/**
 * Bloques cuya caja envolvente atraviesa el rayo. La caja se dilata en el
 * equivalente en mundo al radio de captura, para no perder los enganches a
 * vértices y aristas que quedan justo al borde del objeto.
 */
function visibleGroups(cache: PickCache, ray: Ray, viewport: Viewport): PickGroup[] {
  if (cache.groups.length <= 1) return cache.groups;
  const out: PickGroup[] = [];
  for (const g of cache.groups) {
    const centre = {
      x: (g.box.min.x + g.box.max.x) / 2,
      y: (g.box.min.y + g.box.max.y) / 2,
      z: (g.box.min.z + g.box.max.z) / 2,
    };
    const pad = viewport.worldPerPixel(centre) * (SNAP_PIXELS.vertex * 2);
    if (rayHitsBox(ray, g.box, pad)) out.push(g);
  }
  return out;
}

/** Prueba rayo-caja por planos deslizantes, sin asignaciones. */
function rayHitsBox(ray: Ray, box: { min: Vec3; max: Vec3 }, pad: number): boolean {
  if (box.min.x > box.max.x) return false;
  let tmin = 0;
  let tmax = Infinity;

  const axis = (o: number, d: number, lo: number, hi: number): boolean => {
    if (Math.abs(d) < 1e-12) return o >= lo - pad && o <= hi + pad;
    const inv = 1 / d;
    let t1 = (lo - pad - o) * inv;
    let t2 = (hi + pad - o) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    return tmax >= tmin;
  };

  if (!axis(ray.origin.x, ray.dir.x, box.min.x, box.max.x)) return false;
  if (!axis(ray.origin.y, ray.dir.y, box.min.y, box.max.y)) return false;
  if (!axis(ray.origin.z, ray.dir.z, box.min.z, box.max.z)) return false;
  return true;
}
