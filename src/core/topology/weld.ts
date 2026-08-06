import { Geometry } from '../model/geometry';
import { Id } from '../model/types';
import { EPS } from '../math/tolerance';

export interface WeldResult {
  /** Número de vértices absorbidos. */
  merged: number;
  /** Aristas que siguen existiendo y han quedado implicadas. */
  affectedEdges: Id[];
  /** Caras eliminadas durante el proceso (deben reconstruirse). */
  removedFaces: Id[];
}

/**
 * Funde en uno solo los vértices que han quedado coincidentes, por ejemplo tras
 * empujar la cara superior de una caja hasta la base.
 *
 * Las caras implicadas se destruyen: la topología de sus bucles deja de ser
 * válida en cuanto se reasignan aristas. El llamador debe reconstruirlas con
 * `rebuildFaces` sobre los planos que haya recogido ANTES de soldar.
 */
export function weldCoincidentVertices(
  geo: Geometry,
  vertexIds: Iterable<Id>,
  eps = EPS,
): WeldResult {
  const result: WeldResult = { merged: 0, affectedEdges: [], removedFaces: [] };
  const affected = new Set<Id>();

  for (const v of vertexIds) {
    const vert = geo.vertices.get(v);
    if (!vert) continue;
    const others = geo.findVerticesNear(vert.p, eps).filter((x) => x !== v);
    if (others.length === 0) continue;

    for (const w of others) {
      if (!geo.vertices.has(w)) continue;
      removeFacesAround(geo, v, result);
      removeFacesAround(geo, w, result);
      mergeVertex(geo, w, v, affected);
      result.merged++;
    }
  }

  for (const e of affected) {
    if (geo.edges.has(e)) result.affectedEdges.push(e);
  }
  return result;
}

function removeFacesAround(geo: Geometry, v: Id, result: WeldResult): void {
  for (const e of [...(geo.vertexEdges.get(v) ?? [])]) {
    for (const f of [...(geo.edgeFaces.get(e) ?? [])]) {
      if (geo.faces.has(f)) {
        geo.removeFace(f);
        result.removedFaces.push(f);
      }
    }
  }
}

/** Absorbe el vértice `from` dentro de `to`, reasignando sus aristas. */
function mergeVertex(geo: Geometry, from: Id, to: Id, affected: Set<Id>): void {
  if (from === to) return;
  const incident = [...(geo.vertexEdges.get(from) ?? [])];

  for (const eid of incident) {
    const e = geo.edges.get(eid);
    if (!e) continue;
    const other = e.a === from ? e.b : e.a;

    if (other === to) {
      // La arista se vuelve degenerada.
      geo.removeEdge(eid);
      continue;
    }

    const duplicate = geo.findEdge(to, other);
    if (duplicate !== null) {
      // Ya existe una arista equivalente: se conserva la antigua.
      geo.removeEdge(eid);
      affected.add(duplicate);
      continue;
    }

    // Reasignar el extremo.
    geo.vertexEdges.get(from)?.delete(eid);
    if (e.a === from) e.a = to;
    else e.b = to;
    geo.vertexEdges.get(to)?.add(eid);
    affected.add(eid);
  }

  geo.removeVertexIfIsolated(from);
}

/**
 * Elimina aristas de longitud nula que hayan podido aparecer tras mover
 * vértices. Devuelve cuántas se han eliminado.
 */
export function removeDegenerateEdges(geo: Geometry): number {
  let n = 0;
  for (const e of [...geo.edges.values()]) {
    const a = geo.vertices.get(e.a);
    const b = geo.vertices.get(e.b);
    if (!a || !b) {
      geo.removeEdge(e.id);
      n++;
      continue;
    }
    const dx = a.p.x - b.p.x;
    const dy = a.p.y - b.p.y;
    const dz = a.p.z - b.p.z;
    if (dx * dx + dy * dy + dz * dz <= EPS * EPS) {
      geo.removeEdge(e.id);
      n++;
    }
  }
  return n;
}
