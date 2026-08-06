import { Geometry } from '../model/geometry';
import { Id } from '../model/types';
import { mul, dot, cross } from '../math/vec';
import { reverseLoop } from './loops';
import { triangulateFace } from './triangulate';

/** Invierte una cara: su normal frontal pasa a apuntar al lado contrario. */
export function flipFace(geo: Geometry, faceId: Id): void {
  const f = geo.faces.get(faceId);
  if (!f) return;
  f.loops = f.loops.map(reverseLoop);
  f.plane = { n: mul(f.plane.n, -1), d: -f.plane.d };
  const front = f.frontMaterial;
  f.frontMaterial = f.backMaterial;
  f.backMaterial = front;
}

/** Sentido con el que una cara recorre una arista concreta. */
function traversalDir(geo: Geometry, faceId: Id, edgeId: Id): boolean | null {
  const f = geo.faces.get(faceId);
  if (!f) return null;
  for (const loop of f.loops) {
    for (let i = 0; i < loop.edges.length; i++) {
      if (loop.edges[i] === edgeId) return loop.dirs[i];
    }
  }
  return null;
}

export interface OrientResult {
  /** Caras que se han invertido. */
  flipped: Id[];
  /** Componentes procesadas. */
  components: number;
  /** true si alguna componente resultó ser un sólido cerrado. */
  hadClosedShell: boolean;
}

/**
 * Orienta de forma coherente todas las caras conectadas a las caras semilla.
 *
 * Dos caras que comparten una arista son coherentes cuando la recorren en
 * sentidos OPUESTOS: es la condición clásica de orientabilidad de una
 * superficie. Se propaga con un recorrido en anchura y, si la componente
 * resulta ser una cáscara cerrada, se comprueba el volumen con signo para que
 * las caras frontales queden mirando hacia fuera.
 *
 * Las aristas compartidas por más de dos caras (geometría no-manifold) se
 * omiten en la propagación, porque no definen una orientación única.
 */
export function orientFacesConsistently(geo: Geometry, seeds: Iterable<Id>): OrientResult {
  const result: OrientResult = { flipped: [], components: 0, hadClosedShell: false };
  const globalVisited = new Set<Id>();

  for (const seed of seeds) {
    if (!geo.faces.has(seed) || globalVisited.has(seed)) continue;

    // --- Recorrido en anchura por la componente -----------------------------
    const component: Id[] = [];
    const queue: Id[] = [seed];
    globalVisited.add(seed);

    while (queue.length > 0) {
      const fid = queue.shift()!;
      component.push(fid);

      for (const eid of geo.faceEdges(fid)) {
        const users = [...(geo.edgeFaces.get(eid) ?? [])];
        if (users.length !== 2) continue; // no-manifold o borde libre
        const other = users[0] === fid ? users[1] : users[0];
        if (globalVisited.has(other)) continue;

        const dHere = traversalDir(geo, fid, eid);
        const dThere = traversalDir(geo, other, eid);
        if (dHere !== null && dThere !== null && dHere === dThere) {
          flipFace(geo, other);
          result.flipped.push(other);
        }
        globalVisited.add(other);
        queue.push(other);
      }
    }
    result.components++;

    // --- ¿Es una cáscara cerrada? ------------------------------------------
    const inComponent = new Set(component);
    let closed = component.length >= 4;
    for (const fid of component) {
      for (const eid of geo.faceEdges(fid)) {
        const users = [...(geo.edgeFaces.get(eid) ?? [])].filter((f) => inComponent.has(f));
        if (users.length !== 2) {
          closed = false;
          break;
        }
      }
      if (!closed) break;
    }
    if (!closed) continue;
    result.hadClosedShell = true;

    // Volumen con signo: si es negativo, las normales apuntan hacia dentro.
    let vol = 0;
    for (const fid of component) {
      const t = triangulateFace(geo, fid);
      if (!t) continue;
      for (let i = 0; i < t.indices.length; i += 3) {
        const a = t.positions[t.indices[i]];
        const b = t.positions[t.indices[i + 1]];
        const c = t.positions[t.indices[i + 2]];
        vol += dot(a, cross(b, c)) / 6;
      }
    }
    if (vol < 0) {
      for (const fid of component) {
        flipFace(geo, fid);
        result.flipped.push(fid);
      }
    }
  }

  return result;
}

/**
 * Volumen encerrado por un conjunto de caras. Sólo tiene sentido si forman una
 * cáscara cerrada y orientada; devuelve 0 en otro caso.
 */
export function shellVolume(geo: Geometry, faceIds: Iterable<Id>): number {
  let vol = 0;
  for (const fid of faceIds) {
    const t = triangulateFace(geo, fid);
    if (!t) continue;
    for (let i = 0; i < t.indices.length; i += 3) {
      const a = t.positions[t.indices[i]];
      const b = t.positions[t.indices[i + 1]];
      const c = t.positions[t.indices[i + 2]];
      vol += dot(a, cross(b, c)) / 6;
    }
  }
  return vol;
}

/**
 * ¿Forman las caras indicadas un sólido cerrado? (cada arista usada por
 * exactamente dos de ellas). Es la definición de "sólido" de SketchUp.
 */
export function isSolid(geo: Geometry, faceIds: Iterable<Id>): boolean {
  const set = new Set(faceIds);
  if (set.size < 4) return false;
  const edgeCount = new Map<Id, number>();
  for (const fid of set) {
    for (const eid of geo.faceEdges(fid)) {
      edgeCount.set(eid, (edgeCount.get(eid) ?? 0) + 1);
    }
  }
  for (const [, n] of edgeCount) {
    if (n !== 2) return false;
  }
  // Todas las aristas implicadas deben pertenecer sólo a estas caras.
  for (const eid of edgeCount.keys()) {
    const users = geo.edgeFaces.get(eid);
    if (!users || users.size !== 2) return false;
    for (const f of users) if (!set.has(f)) return false;
  }
  return true;
}

/** Componente conexa de caras (por aristas compartidas) que contiene `seed`. */
export function faceComponent(geo: Geometry, seed: Id): Id[] {
  if (!geo.faces.has(seed)) return [];
  const seen = new Set<Id>([seed]);
  const queue = [seed];
  const out: Id[] = [];
  while (queue.length > 0) {
    const fid = queue.shift()!;
    out.push(fid);
    for (const eid of geo.faceEdges(fid)) {
      for (const other of geo.edgeFaces.get(eid) ?? []) {
        if (!seen.has(other)) {
          seen.add(other);
          queue.push(other);
        }
      }
    }
  }
  return out;
}
