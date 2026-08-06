import { Geometry } from './model/geometry';
import { Id, EntityKind } from './model/types';

/** Conjunto de entidades seleccionadas dentro del contexto de edición activo. */
export interface Selection {
  faces: Set<Id>;
  edges: Set<Id>;
  vertices: Set<Id>;
  instances: Set<Id>;
}

export function emptySelection(): Selection {
  return { faces: new Set(), edges: new Set(), vertices: new Set(), instances: new Set() };
}

export function cloneSelection(s: Selection): Selection {
  return {
    faces: new Set(s.faces),
    edges: new Set(s.edges),
    vertices: new Set(s.vertices),
    instances: new Set(s.instances),
  };
}

export function selectionSize(s: Selection): number {
  return s.faces.size + s.edges.size + s.vertices.size + s.instances.size;
}

export function isSelectionEmpty(s: Selection): boolean {
  return selectionSize(s) === 0;
}

export function clearSelection(s: Selection): void {
  s.faces.clear();
  s.edges.clear();
  s.vertices.clear();
  s.instances.clear();
}

export function setOf(s: Selection, kind: EntityKind): Set<Id> {
  switch (kind) {
    case 'face': return s.faces;
    case 'edge': return s.edges;
    case 'vertex': return s.vertices;
    case 'instance': return s.instances;
  }
}

export function hasEntity(s: Selection, kind: EntityKind, id: Id): boolean {
  return setOf(s, kind).has(id);
}

export function addEntity(s: Selection, kind: EntityKind, id: Id): void {
  setOf(s, kind).add(id);
}

export function removeEntity(s: Selection, kind: EntityKind, id: Id): void {
  setOf(s, kind).delete(id);
}

export function toggleEntity(s: Selection, kind: EntityKind, id: Id): void {
  const set = setOf(s, kind);
  if (set.has(id)) set.delete(id);
  else set.add(id);
}

/** Elimina de la selección las entidades que ya no existen. */
export function pruneSelection(s: Selection, geo: Geometry): void {
  for (const id of [...s.faces]) if (!geo.faces.has(id)) s.faces.delete(id);
  for (const id of [...s.edges]) if (!geo.edges.has(id)) s.edges.delete(id);
  for (const id of [...s.vertices]) if (!geo.vertices.has(id)) s.vertices.delete(id);
  for (const id of [...s.instances]) if (!geo.instances.has(id)) s.instances.delete(id);
}

/** Selecciona todo el contenido del contexto. */
export function selectAll(s: Selection, geo: Geometry): void {
  clearSelection(s);
  for (const id of geo.faces.keys()) s.faces.add(id);
  for (const id of geo.edges.keys()) s.edges.add(id);
  for (const id of geo.instances.keys()) s.instances.add(id);
}

/** Invierte la selección dentro del contexto. */
export function invertSelection(s: Selection, geo: Geometry): void {
  const faces = new Set<Id>();
  const edges = new Set<Id>();
  const instances = new Set<Id>();
  for (const id of geo.faces.keys()) if (!s.faces.has(id)) faces.add(id);
  for (const id of geo.edges.keys()) if (!s.edges.has(id)) edges.add(id);
  for (const id of geo.instances.keys()) if (!s.instances.has(id)) instances.add(id);
  s.faces = faces;
  s.edges = edges;
  s.instances = instances;
  s.vertices.clear();
}

/**
 * Amplía la selección de una cara a sus aristas de contorno.
 * Es lo que ocurre al hacer doble clic sobre una cara.
 */
export function expandFaceToEdges(s: Selection, geo: Geometry, faceId: Id): void {
  s.faces.add(faceId);
  for (const e of geo.faceEdges(faceId)) s.edges.add(e);
}

/**
 * Selecciona toda la geometría conectada a la entidad indicada (triple clic).
 * Se propaga a través de aristas y caras compartidas.
 */
export function selectConnected(s: Selection, geo: Geometry, seed: { kind: EntityKind; id: Id }): void {
  const edgeQueue: Id[] = [];
  const seenEdges = new Set<Id>();

  if (seed.kind === 'edge') edgeQueue.push(seed.id);
  else if (seed.kind === 'face') edgeQueue.push(...geo.faceEdges(seed.id));
  else if (seed.kind === 'vertex') edgeQueue.push(...(geo.vertexEdges.get(seed.id) ?? []));
  else return;

  while (edgeQueue.length > 0) {
    const eid = edgeQueue.pop()!;
    if (seenEdges.has(eid)) continue;
    const edge = geo.edges.get(eid);
    if (!edge) continue;
    seenEdges.add(eid);
    s.edges.add(eid);

    for (const v of [edge.a, edge.b]) {
      for (const next of geo.vertexEdges.get(v) ?? []) {
        if (!seenEdges.has(next)) edgeQueue.push(next);
      }
    }
    for (const f of geo.edgeFaces.get(eid) ?? []) {
      if (!s.faces.has(f)) {
        s.faces.add(f);
        for (const fe of geo.faceEdges(f)) {
          if (!seenEdges.has(fe)) edgeQueue.push(fe);
        }
      }
    }
  }
}

/**
 * Selecciona las caras coplanares adyacentes a la indicada, hasta encontrar una
 * arista que separe planos distintos. Útil para pintar superficies completas.
 */
export function selectCoplanar(s: Selection, geo: Geometry, faceId: Id): void {
  const start = geo.faces.get(faceId);
  if (!start) return;
  const queue = [faceId];
  const seen = new Set<Id>([faceId]);
  while (queue.length > 0) {
    const fid = queue.pop()!;
    s.faces.add(fid);
    for (const adj of geo.adjacentFaces(fid)) {
      if (seen.has(adj)) continue;
      const f = geo.faces.get(adj);
      if (!f) continue;
      const d = f.plane.n.x * start.plane.n.x + f.plane.n.y * start.plane.n.y + f.plane.n.z * start.plane.n.z;
      if (Math.abs(Math.abs(d) - 1) > 1e-6) continue;
      if (Math.abs(Math.abs(f.plane.d) - Math.abs(start.plane.d)) > 1e-6) continue;
      seen.add(adj);
      queue.push(adj);
    }
  }
}

/**
 * Aristas implicadas por la selección (propias y de las caras).
 *
 * Se filtran las que ya no existen: la selección puede quedar un instante
 * desfasada respecto de la geometría mientras se procesa una operación, y
 * ningún consumidor debería fallar por ello.
 */
export function selectedEdgeSet(s: Selection, geo: Geometry): Set<Id> {
  const out = new Set<Id>();
  for (const e of s.edges) {
    if (geo.edges.has(e)) out.add(e);
  }
  for (const f of s.faces) {
    if (!geo.faces.has(f)) continue;
    for (const e of geo.faceEdges(f)) {
      if (geo.edges.has(e)) out.add(e);
    }
  }
  return out;
}

/** Vértices implicados por la selección completa. */
export function selectedVertexSet(s: Selection, geo: Geometry): Set<Id> {
  const out = new Set<Id>(s.vertices);
  for (const e of selectedEdgeSet(s, geo)) {
    const edge = geo.edges.get(e);
    if (edge) {
      out.add(edge.a);
      out.add(edge.b);
    }
  }
  return out;
}

/** Descripción legible de la selección, para la barra de estado. */
export function describeSelection(s: Selection): string {
  const parts: string[] = [];
  if (s.instances.size) parts.push(`${s.instances.size} grupo(s)`);
  if (s.faces.size) parts.push(`${s.faces.size} cara(s)`);
  if (s.edges.size) parts.push(`${s.edges.size} arista(s)`);
  if (s.vertices.size) parts.push(`${s.vertices.size} punto(s)`);
  if (parts.length === 0) return 'Nada seleccionado';
  return `Seleccionado: ${parts.join(', ')}`;
}
