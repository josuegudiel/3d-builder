import { Loop } from '../model/types';

/**
 * Invierte el sentido de recorrido de un bucle manteniendo el invariante
 * `vertices[i]` = vértice inicial de `edges[i]`.
 */
export function reverseLoop(loop: Loop): Loop {
  const n = loop.edges.length;
  const edges: Loop['edges'] = [];
  const dirs: boolean[] = [];
  const vertices: Loop['vertices'] = [];
  for (let i = n - 1; i >= 0; i--) {
    edges.push(loop.edges[i]);
    dirs.push(!loop.dirs[i]);
    vertices.push(loop.vertices[(i + 1) % n]);
  }
  return { edges, dirs, vertices };
}

/** Copia profunda de un bucle. */
export function cloneLoop(loop: Loop): Loop {
  return { edges: [...loop.edges], dirs: [...loop.dirs], vertices: [...loop.vertices] };
}
