import { Geometry } from '../model/geometry';
import { Id } from '../model/types';
import { Vec3 } from '../math/vec';
import { EPS } from '../math/tolerance';
import { pointStrictlyInsideSegment } from '../math/geom';
import { splitEdge } from './insert';

/**
 * Reparación de solapamientos colineales.
 *
 * Mover o soldar vértices puede dejar una arista larga cubriendo a otras dos
 * más cortas (A–C sobre A–B y B–C). Esa configuración rompe el subdivisor
 * planar: en el vértice compartido hay dos semiaristas con el mismo ángulo, el
 * recorrido se cierra sobre sí mismo y el plano entero se queda sin caras.
 *
 * La cura es partir toda arista que contenga otro vértice en su interior. Como
 * `addEdgeByVertices` reutiliza las aristas existentes, los tramos duplicados
 * se funden solos y el solapamiento desaparece.
 */
export function splitEdgesAtInteriorVertices(geo: Geometry, edgeIds: Iterable<Id>): Id[] {
  const result: Id[] = [];
  const processed = new Set<Id>();

  for (const eid of new Set(edgeIds)) {
    if (processed.has(eid) || !geo.edges.has(eid)) continue;
    processed.add(eid);

    const edge = geo.edges.get(eid)!;
    const a = geo.vertexPos(edge.a);
    const b = geo.vertexPos(edge.b);

    const minX = Math.min(a.x, b.x) - EPS;
    const maxX = Math.max(a.x, b.x) + EPS;
    const minY = Math.min(a.y, b.y) - EPS;
    const maxY = Math.max(a.y, b.y) + EPS;
    const minZ = Math.min(a.z, b.z) - EPS;
    const maxZ = Math.max(a.z, b.z) + EPS;

    const cuts: Vec3[] = [];
    for (const v of geo.vertices.values()) {
      if (v.id === edge.a || v.id === edge.b) continue;
      if (v.p.x < minX || v.p.x > maxX) continue;
      if (v.p.y < minY || v.p.y > maxY) continue;
      if (v.p.z < minZ || v.p.z > maxZ) continue;
      if (pointStrictlyInsideSegment(a, b, v.p)) cuts.push(v.p);
    }

    if (cuts.length === 0) {
      result.push(eid);
      continue;
    }
    const r = splitEdge(geo, eid, cuts);
    for (const sub of r.edges) {
      processed.add(sub);
      result.push(sub);
    }
  }

  return result;
}

/**
 * Repara los solapamientos que puedan haber aparecido alrededor de un conjunto
 * de vértices que se acaban de mover: tanto en las aristas que inciden en ellos
 * como en las aristas ajenas por cuyo interior hayan pasado a caer.
 */
export function repairAroundVertices(geo: Geometry, vertexIds: Iterable<Id>): Id[] {
  const positions: Vec3[] = [];
  const candidates = new Set<Id>();

  for (const v of vertexIds) {
    const vert = geo.vertices.get(v);
    if (!vert) continue;
    positions.push(vert.p);
    for (const e of geo.vertexEdges.get(v) ?? []) candidates.add(e);
  }
  if (positions.length === 0) return [];

  // Aristas ajenas cuya caja envolvente contiene alguno de los puntos movidos.
  for (const edge of geo.edges.values()) {
    if (candidates.has(edge.id)) continue;
    const a = geo.vertices.get(edge.a)?.p;
    const b = geo.vertices.get(edge.b)?.p;
    if (!a || !b) continue;
    const minX = Math.min(a.x, b.x) - EPS;
    const maxX = Math.max(a.x, b.x) + EPS;
    const minY = Math.min(a.y, b.y) - EPS;
    const maxY = Math.max(a.y, b.y) + EPS;
    const minZ = Math.min(a.z, b.z) - EPS;
    const maxZ = Math.max(a.z, b.z) + EPS;
    for (const p of positions) {
      if (p.x < minX || p.x > maxX) continue;
      if (p.y < minY || p.y > maxY) continue;
      if (p.z < minZ || p.z > maxZ) continue;
      candidates.add(edge.id);
      break;
    }
  }

  return splitEdgesAtInteriorVertices(geo, candidates);
}

/**
 * Comprueba si quedan aristas que solapen a otras. Sólo se usa en las pruebas:
 * es la condición que el subdivisor planar necesita y que `validate()` no
 * puede expresar por sí sola.
 */
export function findOverlappingEdges(geo: Geometry): Id[] {
  const bad: Id[] = [];
  for (const edge of geo.edges.values()) {
    const a = geo.vertexPos(edge.a);
    const b = geo.vertexPos(edge.b);
    for (const v of geo.vertices.values()) {
      if (v.id === edge.a || v.id === edge.b) continue;
      if (pointStrictlyInsideSegment(a, b, v.p)) {
        bad.push(edge.id);
        break;
      }
    }
  }
  return bad;
}
