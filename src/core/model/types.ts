import { Vec3 } from '../math/vec';
import { Plane } from '../math/plane';
import { Mat4 } from '../math/mat';

/** Identificador único de entidad dentro de un modelo. */
export type Id = number;

export type EntityKind = 'vertex' | 'edge' | 'face' | 'instance';

export interface Vertex {
  readonly id: Id;
  /** Posición en el espacio local de su contenedor (metros). */
  p: Vec3;
}

export interface Edge {
  readonly id: Id;
  /** Vértice inicial. */
  a: Id;
  /** Vértice final. */
  b: Id;
  /**
   * Arista "suave": no se dibuja, pero sigue separando caras.
   * Equivale a "Soften" en SketchUp.
   */
  soft: boolean;
  /** Suaviza el sombreado entre las caras adyacentes ("Smooth"). */
  smooth: boolean;
  /** Oculta manualmente. */
  hidden: boolean;
}

/**
 * Bucle de contorno de una cara.
 *
 * `edges[i]` va de `vertices[i]` a `vertices[(i+1) % n]`.
 * `dirs[i]` indica si la arista se recorre de `a`→`b` (true) o `b`→`a` (false).
 * El bucle exterior se almacena en sentido antihorario visto desde el lado
 * frontal de la cara; los bucles interiores (agujeros), en sentido horario.
 */
export interface Loop {
  edges: Id[];
  dirs: boolean[];
  vertices: Id[];
}

export interface Face {
  readonly id: Id;
  /** loops[0] es el contorno exterior; el resto son agujeros. */
  loops: Loop[];
  /** Plano orientado: la normal apunta hacia la cara frontal. */
  plane: Plane;
  frontMaterial: string | null;
  backMaterial: string | null;
  hidden: boolean;
}

export type DefinitionKind = 'group' | 'component';

/** Instancia de un grupo o componente dentro de una geometría. */
export interface Instance {
  readonly id: Id;
  definitionId: Id;
  /** Transformación del espacio de la definición al espacio del contenedor. */
  transform: Mat4;
  /** Nombre visible en el organizador (puede estar vacío). */
  name: string;
  /** Material heredado por las caras sin material propio. */
  materialId: string | null;
  hidden: boolean;
  locked: boolean;
}

export interface Material {
  id: string;
  name: string;
  /** Color en formato "#rrggbb". */
  color: string;
  /** 0 = transparente, 1 = opaco. */
  opacity: number;
}

/** Referencia a una entidad dentro de un contexto de edición. */
export interface EntityRef {
  kind: EntityKind;
  id: Id;
}

export function refKey(r: EntityRef): string {
  return `${r.kind}:${r.id}`;
}

export function isSameRef(a: EntityRef, b: EntityRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** Datos serializables de un plano (para guardar/cargar). */
export interface PlaneData {
  n: [number, number, number];
  d: number;
}

export function planeToData(p: Plane): PlaneData {
  return { n: [p.n.x, p.n.y, p.n.z], d: p.d };
}

export function planeFromData(p: PlaneData): Plane {
  return { n: { x: p.n[0], y: p.n[1], z: p.n[2] }, d: p.d };
}

export function vecToData(v: Vec3): [number, number, number] {
  return [v.x, v.y, v.z];
}

export function vecFromData(v: readonly number[]): Vec3 {
  return { x: v[0], y: v[1], z: v[2] };
}
