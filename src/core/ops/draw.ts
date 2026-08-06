import { Geometry } from '../model/geometry';
import { Id } from '../model/types';
import { Vec3 } from '../math/vec';
import { Plane } from '../math/plane';
import { insertPolyline, insertSegment, InsertResult } from '../topology/insert';
import { collectCandidatePlanes, rebuildFaces, RebuildResult } from '../topology/rebuild';

export interface DrawResult {
  insert: InsertResult;
  rebuild: RebuildResult;
}

export interface DrawOptions {
  /** Orienta las caras nuevas hacia este vector (normalmente, hacia la cámara). */
  orientToward?: Vec3;
  /** Planos adicionales a reconstruir. */
  extraPlanes?: readonly Plane[];
}

/**
 * Dibuja una polilínea en la geometría y reconstruye las caras afectadas.
 * Es la operación básica sobre la que se apoyan casi todas las herramientas de
 * dibujo (línea, rectángulo, círculo, polígono, arco...).
 */
export function drawPolyline(
  geo: Geometry,
  points: readonly Vec3[],
  closed: boolean,
  opts: DrawOptions = {},
): DrawResult {
  const insert = insertPolyline(geo, points, closed);
  const rebuild = rebuildAfterInsert(geo, insert, opts);
  return { insert, rebuild };
}

/** Dibuja un único segmento. */
export function drawSegment(
  geo: Geometry,
  a: Vec3,
  b: Vec3,
  opts: DrawOptions = {},
): DrawResult {
  const insert = insertSegment(geo, a, b);
  const rebuild = rebuildAfterInsert(geo, insert, opts);
  return { insert, rebuild };
}

/** Reconstruye las caras tras una inserción, con los planos candidatos correctos. */
export function rebuildAfterInsert(
  geo: Geometry,
  insert: InsertResult,
  opts: DrawOptions = {},
): RebuildResult {
  if (insert.affectedEdges.length === 0 && (opts.extraPlanes?.length ?? 0) === 0) {
    return { created: [], removed: [], kept: [] };
  }
  const planes: Plane[] = [
    ...collectCandidatePlanes(geo, insert.affectedEdges),
    ...(opts.extraPlanes ?? []),
  ];
  return rebuildFaces(geo, planes, {
    newEdges: new Set(insert.newEdges),
    retracedEdges: new Set(insert.retracedEdges),
    orientToward: opts.orientToward,
  });
}

/**
 * Devuelve los identificadores de las caras que contienen todas las aristas
 * indicadas (útil para saber qué cara acaba de crearse bajo el cursor).
 */
export function facesUsingEdges(geo: Geometry, edges: Iterable<Id>): Id[] {
  const out = new Set<Id>();
  for (const e of edges) {
    for (const f of geo.edgeFaces.get(e) ?? []) out.add(f);
  }
  return [...out];
}
