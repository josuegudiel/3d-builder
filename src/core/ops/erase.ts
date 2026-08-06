import { Geometry } from '../model/geometry';
import { Id } from '../model/types';
import { Plane } from '../math/plane';
import {
  collectCandidatePlanes, collectPlanesFromFaces, rebuildFaces, deleteFaceKeepingEdges,
} from '../topology/rebuild';

export interface EraseResult {
  removedEdges: Id[];
  removedFaces: Id[];
  createdFaces: Id[];
}

/**
 * Borra aristas replicando la semántica de SketchUp:
 *  - Las caras que usan una arista borrada desaparecen.
 *  - Si la arista sólo separaba dos caras coplanares, éstas se funden en una.
 *  - Los vértices que quedan sueltos se eliminan.
 */
export function eraseEdges(geo: Geometry, edgeIds: Iterable<Id>): EraseResult {
  const ids = [...new Set(edgeIds)].filter((id) => geo.edges.has(id));
  if (ids.length === 0) return { removedEdges: [], removedFaces: [], createdFaces: [] };

  // Los planos deben recogerse ANTES de destruir la topología.
  const planes: Plane[] = [...collectCandidatePlanes(geo, ids)];
  const facesTouched = new Set<Id>();
  for (const id of ids) {
    for (const f of geo.edgeFaces.get(id) ?? []) facesTouched.add(f);
  }
  planes.push(...collectPlanesFromFaces(geo, facesTouched));

  const facesBefore = new Set(geo.faces.keys());
  for (const id of ids) geo.removeEdge(id);

  const rebuild = rebuildFaces(geo, planes);

  const removedFaces: Id[] = [];
  for (const f of facesBefore) {
    if (!geo.faces.has(f)) removedFaces.push(f);
  }

  return { removedEdges: ids, removedFaces, createdFaces: rebuild.created };
}

/**
 * Borra caras conservando sus aristas (equivale a seleccionar sólo la cara y
 * pulsar Suprimir en SketchUp). La región queda marcada para que el
 * reconstructor no la regenere hasta que se vuelva a trazar alguna arista.
 */
export function eraseFaces(geo: Geometry, faceIds: Iterable<Id>): EraseResult {
  const ids = [...new Set(faceIds)].filter((id) => geo.faces.has(id));
  for (const id of ids) deleteFaceKeepingEdges(geo, id);
  return { removedEdges: [], removedFaces: ids, createdFaces: [] };
}

/**
 * Borra caras junto con las aristas que sólo ellas usaban. Es lo que se espera
 * al borrar una "pared" completa.
 */
export function eraseFacesWithEdges(geo: Geometry, faceIds: Iterable<Id>): EraseResult {
  const ids = [...new Set(faceIds)].filter((id) => geo.faces.has(id));
  const edgesToRemove = new Set<Id>();
  for (const fid of ids) {
    for (const e of geo.faceEdges(fid)) {
      const users = geo.edgeFaces.get(e);
      if (!users) continue;
      let onlyOurs = true;
      for (const f of users) {
        if (!ids.includes(f)) {
          onlyOurs = false;
          break;
        }
      }
      if (onlyOurs) edgesToRemove.add(e);
    }
  }
  const res = eraseEdges(geo, edgesToRemove);
  // Las caras que sobrevivan por no haber perdido aristas se borran también.
  for (const fid of ids) {
    if (geo.faces.has(fid)) deleteFaceKeepingEdges(geo, fid);
  }
  return { ...res, removedFaces: [...new Set([...res.removedFaces, ...ids])] };
}

/** Borra vértices sueltos y las aristas que inciden en ellos. */
export function eraseVertices(geo: Geometry, vertexIds: Iterable<Id>): EraseResult {
  const edges = new Set<Id>();
  for (const v of vertexIds) {
    for (const e of geo.vertexEdges.get(v) ?? []) edges.add(e);
  }
  const res = eraseEdges(geo, edges);
  for (const v of vertexIds) geo.removeVertexIfIsolated(v);
  return res;
}

/** Borra instancias (grupos/componentes). */
export function eraseInstances(geo: Geometry, instanceIds: Iterable<Id>): void {
  for (const id of instanceIds) geo.removeInstance(id);
}
