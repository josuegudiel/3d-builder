import { Id } from '../core/model/types';
import { Geometry } from '../core/model/geometry';
import {
  Vec3, v3, add, sub, mul, dot, cross, normalize, length, lengthSq, distance,
  addScaled, midpoint, AXIS_X, AXIS_Y, AXIS_Z,
} from '../core/math/vec';
import { Plane, planeFromPointNormal, linePlaneIntersect, planeProject } from '../core/math/plane';
import { Ray, closestPointsSegmentSegment } from '../core/math/geom';
import { EPS, clamp } from '../core/math/tolerance';
import { Viewport } from '../render/viewport';
import { PickCache } from '../render/scene';
import { THEME, SNAP_PIXELS } from '../render/theme';
import { GlyphShape } from '../render/overlay';
import { pickEntity, PickResult } from './picker';
import { faceCentroid } from '../core/topology/triangulate';

export type InferenceKind =
  | 'endpoint' | 'midpoint' | 'onEdge' | 'onFace' | 'center' | 'origin'
  | 'axisX' | 'axisY' | 'axisZ'
  | 'parallel' | 'perpendicular'
  | 'onPlane' | 'ground' | 'free' | 'length';

export interface InferenceGuide {
  from: Vec3;
  to: Vec3;
  color: string;
}

export interface InferenceHit {
  point: Vec3;
  kind: InferenceKind;
  /** Texto que se muestra junto al cursor. */
  label: string;
  color: string;
  glyph: GlyphShape | null;
  /** Entidad de referencia sobre la que se ha enganchado. */
  ref?: { kind: 'vertex' | 'edge' | 'face'; id: Id };
  /** Líneas de guía a dibujar. */
  guides: InferenceGuide[];
  /** Dirección restringida, si la hay. */
  direction?: Vec3;
  /** Plano de trabajo resultante. */
  plane?: Plane;
}

export interface InferenceContext {
  viewport: Viewport;
  cache: PickCache;
  geometry: Geometry;
  clientX: number;
  clientY: number;
  /** Punto de partida (por ejemplo, el primer clic de la línea). */
  anchor: Vec3 | null;
  /** Plano de trabajo activo. */
  workPlane: Plane | null;
  /** Eje bloqueado por el usuario (flechas o Mayús). */
  lockedAxis: Vec3 | null;
  /** Dirección de referencia para inferencias de paralelismo. */
  referenceDirection: Vec3 | null;
  /** Desactivar el enganche a entidades (tecla Alt). */
  disableSnap?: boolean;
}

const AXIS_INFO: Array<{ dir: Vec3; kind: InferenceKind; label: string; color: string }> = [
  { dir: AXIS_X, kind: 'axisX', label: 'En el eje rojo', color: THEME.axisX },
  { dir: AXIS_Y, kind: 'axisY', label: 'En el eje verde', color: THEME.axisY },
  { dir: AXIS_Z, kind: 'axisZ', label: 'En el eje azul', color: THEME.axisZ },
];

/**
 * Motor de inferencia: convierte la posición del ratón en un punto 3D
 * significativo, enganchándose a la geometría existente y a los ejes.
 *
 * El orden de prioridad reproduce el de SketchUp:
 *   punto final > punto medio > centro > sobre arista > sobre cara,
 * y por encima de todo, cualquier bloqueo de eje activo.
 */
export function infer(ctx: InferenceContext): InferenceHit {
  const { viewport, anchor } = ctx;
  const ray = viewport.rayFromClient(ctx.clientX, ctx.clientY);
  const cursor = viewport.toLocal(ctx.clientX, ctx.clientY);

  // --- Bloqueo explícito de eje --------------------------------------------
  if (ctx.lockedAxis && anchor) {
    const p = closestPointOnLineToRay(anchor, ctx.lockedAxis, ray);
    const info = axisInfoFor(ctx.lockedAxis);
    return {
      point: p,
      kind: info?.kind ?? 'free',
      label: info ? `${info.label} (bloqueado)` : 'Dirección bloqueada',
      color: info?.color ?? THEME.guide,
      glyph: null,
      guides: [{ from: anchor, to: p, color: info?.color ?? THEME.guide }],
      direction: normalize(ctx.lockedAxis),
    };
  }

  // --- Enganche a entidades -------------------------------------------------
  let entity: PickResult | null = null;
  if (!ctx.disableSnap) {
    entity = pickEntity(ctx.cache, viewport, ctx.clientX, ctx.clientY, {
      vertices: true, edges: true, faces: true, instances: false,
    });
  }

  const candidates: InferenceHit[] = [];

  if (entity) {
    if (entity.kind === 'vertex') {
      candidates.push({
        point: entity.point,
        kind: 'endpoint',
        label: 'Punto final',
        color: THEME.inferenceEndpoint,
        glyph: 'square',
        ref: { kind: 'vertex', id: entity.id },
        guides: [],
      });
    } else if (entity.kind === 'edge') {
      const edge = ctx.geometry.edges.get(entity.id);
      if (edge) {
        const a = ctx.geometry.vertexPos(edge.a);
        const b = ctx.geometry.vertexPos(edge.b);
        const mid = midpoint(a, b);
        const midScreen = viewport.worldToScreen(mid);
        const dMid = Math.hypot(midScreen.x - cursor.x, midScreen.y - cursor.y);
        if (dMid <= SNAP_PIXELS.vertex) {
          candidates.push({
            point: mid,
            kind: 'midpoint',
            label: 'Punto medio',
            color: THEME.inferenceMidpoint,
            glyph: 'diamond',
            ref: { kind: 'edge', id: entity.id },
            guides: [],
          });
        } else {
          candidates.push({
            point: entity.point,
            kind: 'onEdge',
            label: 'En la arista',
            color: THEME.inferenceOnEdge,
            glyph: 'circle',
            ref: { kind: 'edge', id: entity.id },
            guides: [],
          });
        }
      }
    } else if (entity.kind === 'face') {
      const face = ctx.geometry.faces.get(entity.id);
      if (face) {
        const centroid = faceCentroid(ctx.geometry, entity.id);
        if (centroid) {
          const cs = viewport.worldToScreen(centroid);
          if (Math.hypot(cs.x - cursor.x, cs.y - cursor.y) <= SNAP_PIXELS.vertex) {
            candidates.push({
              point: centroid,
              kind: 'center',
              label: 'Centro de la cara',
              color: THEME.inferenceCenter,
              glyph: 'circle',
              ref: { kind: 'face', id: entity.id },
              guides: [],
              plane: face.plane,
            });
          }
        }
        candidates.push({
          point: entity.point,
          kind: 'onFace',
          label: 'En la cara',
          color: THEME.inferenceOnFace,
          glyph: 'triangle',
          ref: { kind: 'face', id: entity.id },
          guides: [],
          plane: face.plane,
        });
      }
    }
  }

  // --- Origen del modelo ----------------------------------------------------
  if (!ctx.disableSnap) {
    const originScreen = viewport.worldToScreen(v3(0, 0, 0));
    if (Math.hypot(originScreen.x - cursor.x, originScreen.y - cursor.y) <= SNAP_PIXELS.vertex) {
      candidates.push({
        point: v3(0, 0, 0),
        kind: 'origin',
        label: 'Origen',
        color: THEME.inferenceEndpoint,
        glyph: 'square',
        guides: [],
      });
    }
  }

  const best = pickBestCandidate(candidates);

  // --- Inferencias direccionales desde el punto de partida ------------------
  if (anchor) {
    const axisHit = inferAxisFromAnchor(ctx, ray, cursor, anchor);
    if (axisHit) {
      // Un enganche a entidad tiene prioridad si además cae sobre el eje.
      if (best && isOnLine(anchor, axisHit.direction!, best.point)) {
        return {
          ...best,
          guides: [...best.guides, { from: anchor, to: best.point, color: axisHit.color }],
          direction: axisHit.direction,
        };
      }
      if (!best || best.kind === 'onFace' || best.kind === 'ground') return axisHit;
      // Preferimos el enganche a entidad si está muy cerca del cursor.
      const bs = viewport.worldToScreen(best.point);
      const dEntity = Math.hypot(bs.x - cursor.x, bs.y - cursor.y);
      if (dEntity <= SNAP_PIXELS.vertex * 0.8) return best;
      return axisHit;
    }

    if (ctx.referenceDirection) {
      const parallel = inferParallel(ctx, ray, cursor, anchor, ctx.referenceDirection);
      if (parallel && !best) return parallel;
    }
  }

  if (best) return best;

  // --- Sin enganche: proyectar sobre el plano de trabajo --------------------
  return projectToWorkPlane(ctx, ray);
}

function pickBestCandidate(candidates: InferenceHit[]): InferenceHit | null {
  if (candidates.length === 0) return null;
  const order: InferenceKind[] = ['endpoint', 'origin', 'midpoint', 'center', 'onEdge', 'onFace'];
  candidates.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  return candidates[0];
}

/** Comprueba si `p` está sobre la recta anchor+t·dir (con tolerancia relativa). */
function isOnLine(anchor: Vec3, dir: Vec3, p: Vec3): boolean {
  const rel = sub(p, anchor);
  const l = length(rel);
  if (l <= EPS) return true;
  const d = normalize(dir);
  const perp = sub(rel, mul(d, dot(rel, d)));
  return length(perp) <= Math.max(EPS, l * 1e-4);
}

function axisInfoFor(dir: Vec3) {
  const d = normalize(dir);
  for (const info of AXIS_INFO) {
    if (Math.abs(Math.abs(dot(d, info.dir)) - 1) < 1e-6) return info;
  }
  return null;
}

/**
 * ¿Está el cursor cerca de una de las rectas que pasan por `anchor` en la
 * dirección de los ejes globales? La comprobación se hace en píxeles para que
 * la sensibilidad sea independiente del zoom.
 */
function inferAxisFromAnchor(
  ctx: InferenceContext,
  ray: Ray,
  cursor: { x: number; y: number },
  anchor: Vec3,
): InferenceHit | null {
  let best: InferenceHit | null = null;
  let bestDist: number = SNAP_PIXELS.axis;

  for (const info of AXIS_INFO) {
    const p = closestPointOnLineToRay(anchor, info.dir, ray);
    if (distance(p, anchor) <= EPS) continue;
    const s = ctx.viewport.worldToScreen(p);
    if (!Number.isFinite(s.x)) continue;
    const d = Math.hypot(s.x - cursor.x, s.y - cursor.y);
    if (d >= bestDist) continue;
    bestDist = d;
    best = {
      point: p,
      kind: info.kind,
      label: info.label,
      color: info.color,
      glyph: null,
      guides: [{ from: anchor, to: p, color: info.color }],
      direction: info.dir,
    };
  }
  return best;
}

function inferParallel(
  ctx: InferenceContext,
  ray: Ray,
  cursor: { x: number; y: number },
  anchor: Vec3,
  reference: Vec3,
): InferenceHit | null {
  const dir = normalize(reference);
  const p = closestPointOnLineToRay(anchor, dir, ray);
  const s = ctx.viewport.worldToScreen(p);
  if (!Number.isFinite(s.x)) return null;
  if (Math.hypot(s.x - cursor.x, s.y - cursor.y) > SNAP_PIXELS.axis) return null;
  return {
    point: p,
    kind: 'parallel',
    label: 'Paralelo a la arista',
    color: THEME.inferenceParallel,
    glyph: null,
    guides: [{ from: anchor, to: p, color: THEME.inferenceParallel }],
    direction: dir,
  };
}

/** Proyecta el rayo sobre el plano de trabajo activo. */
function projectToWorkPlane(ctx: InferenceContext, ray: Ray): InferenceHit {
  const plane = ctx.workPlane
    ?? (ctx.anchor ? planeFromPointNormal(ctx.anchor, AXIS_Z) : planeFromPointNormal(v3(0, 0, 0), AXIS_Z));

  const hit = linePlaneIntersect(plane, ray.origin, ray.dir);
  if (hit && hit.t > 0) {
    const onGround = Math.abs(plane.n.z) > 0.999 && Math.abs(plane.d) < EPS;
    return {
      point: hit.p,
      kind: onGround ? 'ground' : 'onPlane',
      label: onGround ? 'En el plano del suelo' : 'En el plano de trabajo',
      color: THEME.guide,
      glyph: null,
      guides: [],
      plane,
    };
  }

  // El rayo es paralelo al plano: se usa un punto a distancia fija.
  const fallback = addScaled(ray.origin, ray.dir, ctx.viewport.cameraCtl.distance);
  return {
    point: ctx.workPlane ? planeProject(ctx.workPlane, fallback) : fallback,
    kind: 'free',
    label: '',
    color: THEME.guide,
    glyph: null,
    guides: [],
    plane,
  };
}

/** Punto de la recta `origin + t·dir` más cercano al rayo. */
export function closestPointOnLineToRay(origin: Vec3, dir: Vec3, ray: Ray): Vec3 {
  const d1 = normalize(dir);
  const d2 = ray.dir;
  const w0 = sub(origin, ray.origin);
  const a = dot(d1, d1);
  const b = dot(d1, d2);
  const c = dot(d2, d2);
  const d = dot(d1, w0);
  const e = dot(d2, w0);
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-12) return origin;
  const t = (b * e - c * d) / denom;
  return addScaled(origin, d1, t);
}

/**
 * Restringe un punto a estar a una distancia exacta del ancla, conservando la
 * dirección. Es lo que hace el cuadro de medidas al escribir una longitud.
 */
export function applyLength(anchor: Vec3, target: Vec3, lengthValue: number): Vec3 {
  const dir = sub(target, anchor);
  const l = length(dir);
  if (l <= EPS) return anchor;
  return addScaled(anchor, mul(dir, 1 / l), lengthValue);
}

/** Distancia mínima entre dos segmentos (reexport para las herramientas). */
export { closestPointsSegmentSegment };

/**
 * Plano de trabajo deducido de una inferencia: la cara sobre la que se está,
 * o un plano horizontal por el punto.
 */
export function workPlaneFrom(hit: InferenceHit, fallbackNormal: Vec3 = AXIS_Z): Plane {
  if (hit.plane) return hit.plane;
  return planeFromPointNormal(hit.point, fallbackNormal);
}

/** Eje más alineado con una dirección, o null si no hay ninguno claro. */
export function dominantAxis(dir: Vec3, tolerance = 1e-4): Vec3 | null {
  const d = normalize(dir);
  for (const info of AXIS_INFO) {
    if (Math.abs(Math.abs(dot(d, info.dir)) - 1) <= tolerance) return info.dir;
  }
  return null;
}

/** Color asociado a un eje, para pintar las guías. */
export function axisColor(dir: Vec3): string {
  return axisInfoFor(dir)?.color ?? THEME.guide;
}

/** Utilidades reexportadas para las herramientas. */
export { clamp, lengthSq, cross, add, mul, clampToPlane };

function clampToPlane(plane: Plane, p: Vec3): Vec3 {
  return planeProject(plane, p);
}
