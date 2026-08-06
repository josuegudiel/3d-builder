import { Geometry, IdAllocator } from './geometry';
import { Id, Instance, Material, DefinitionKind } from './types';
import { Mat4, IDENTITY, matMul, transformPoint } from '../math/mat';
import { Vec3 } from '../math/vec';
import { Box3, emptyBox, expandBox, unionBox, boxCorners, boxIsEmpty } from '../math/geom';
import { UnitSettings, DEFAULT_UNITS } from '../units';

/**
 * Cota acotada entre dos puntos del modelo. Se guarda en el espacio del modelo
 * raíz; `offset` separa la línea de cota del segmento medido.
 */
export interface Dimension {
  readonly id: Id;
  a: Vec3;
  b: Vec3;
  offset: Vec3;
  /** Texto propio; si está vacío se muestra la longitud medida. */
  text: string;
}

/** Línea o punto de guía (construcción), como los del Metro de SketchUp. */
export interface Guide {
  readonly id: Id;
  kind: 'line' | 'point';
  a: Vec3;
  /** Segundo extremo para las guías de línea. */
  b: Vec3;
}

export interface Definition {
  readonly id: Id;
  name: string;
  kind: DefinitionKind;
  geometry: Geometry;
  /** Descripción del componente (sólo para 'component'). */
  description: string;
  /**
   * Un grupo es una definición usada por una sola instancia. Los componentes
   * pueden tener muchas y los cambios se propagan a todas.
   */
  instanceCount: number;
}

/** Modelo completo: geometría raíz, definiciones, materiales y ajustes. */
export class Model {
  readonly ids = new IdAllocator(1);
  readonly definitions = new Map<Id, Definition>();
  readonly materials = new Map<string, Material>();
  /** Cotas del modelo, en el espacio raíz. */
  readonly dimensions = new Map<Id, Dimension>();
  /** Guías de construcción, en el espacio raíz. */
  readonly guides = new Map<Id, Guide>();

  /** Id de la definición raíz (el "espacio del modelo"). */
  readonly rootId: Id;

  units: UnitSettings = { ...DEFAULT_UNITS };

  /** Nombre del archivo/modelo, para la interfaz. */
  name = 'Sin título';

  constructor() {
    this.rootId = this.ids.alloc();
    this.definitions.set(this.rootId, {
      id: this.rootId,
      name: 'Modelo',
      kind: 'group',
      geometry: new Geometry(this.ids),
      description: '',
      instanceCount: 1,
    });
    for (const m of DEFAULT_MATERIALS) this.materials.set(m.id, { ...m });
  }

  get root(): Definition {
    return this.definitions.get(this.rootId)!;
  }

  get rootGeometry(): Geometry {
    return this.root.geometry;
  }

  definition(id: Id): Definition | undefined {
    return this.definitions.get(id);
  }

  /** Crea una definición vacía. */
  createDefinition(kind: DefinitionKind, name: string): Definition {
    const id = this.ids.alloc();
    const def: Definition = {
      id,
      name,
      kind,
      geometry: new Geometry(this.ids),
      description: '',
      instanceCount: 0,
    };
    this.definitions.set(id, def);
    return def;
  }

  /** Elimina definiciones sin instancias (excepto la raíz). */
  purgeUnusedDefinitions(): number {
    const used = new Set<Id>([this.rootId]);
    const walk = (g: Geometry) => {
      for (const inst of g.instances.values()) {
        if (used.has(inst.definitionId)) continue;
        used.add(inst.definitionId);
        const d = this.definitions.get(inst.definitionId);
        if (d) walk(d.geometry);
      }
    };
    walk(this.rootGeometry);
    let removed = 0;
    for (const id of [...this.definitions.keys()]) {
      if (!used.has(id)) {
        this.definitions.delete(id);
        removed++;
      }
    }
    this.recountInstances();
    return removed;
  }

  /** Recalcula `instanceCount` de todas las definiciones. */
  recountInstances(): void {
    for (const d of this.definitions.values()) d.instanceCount = 0;
    const root = this.definitions.get(this.rootId);
    if (root) root.instanceCount = 1;
    const walk = (g: Geometry) => {
      for (const inst of g.instances.values()) {
        const d = this.definitions.get(inst.definitionId);
        if (!d) continue;
        d.instanceCount++;
        walk(d.geometry);
      }
    };
    walk(this.rootGeometry);
  }

  /** Añade una cota y devuelve su identificador. */
  addDimension(a: Vec3, b: Vec3, offset: Vec3, text = ''): Id {
    const id = this.ids.alloc();
    this.dimensions.set(id, { id, a, b, offset, text });
    return id;
  }

  /** Añade una guía de construcción. */
  addGuide(kind: 'line' | 'point', a: Vec3, b: Vec3 = a): Id {
    const id = this.ids.alloc();
    this.guides.set(id, { id, kind, a, b });
    return id;
  }

  /** Borra todas las guías (equivale a "Eliminar guías"). */
  clearGuides(): void {
    this.guides.clear();
  }

  materialOrDefault(id: string | null): Material | null {
    if (!id) return null;
    return this.materials.get(id) ?? null;
  }

  addMaterial(m: Material): void {
    this.materials.set(m.id, m);
  }

  /** Caja envolvente global de todo el modelo. */
  bounds(): Box3 {
    return this.definitionBounds(this.rootId, IDENTITY, new Set());
  }

  /** Caja envolvente de una definición transformada. */
  definitionBounds(defId: Id, transform: Mat4, visiting: Set<Id>): Box3 {
    const def = this.definitions.get(defId);
    if (!def || visiting.has(defId)) return emptyBox();
    visiting.add(defId);
    let box = emptyBox();
    for (const v of def.geometry.vertices.values()) {
      expandBox(box, transformPoint(transform, v.p));
    }
    for (const inst of def.geometry.instances.values()) {
      const sub = this.definitionBounds(inst.definitionId, matMul(transform, inst.transform), visiting);
      if (!boxIsEmpty(sub)) box = unionBox(box, sub);
    }
    visiting.delete(defId);
    return box;
  }

  /** Caja envolvente de una instancia concreta, en el espacio dado. */
  instanceBounds(inst: Instance, parentTransform: Mat4 = IDENTITY): Box3 {
    return this.definitionBounds(inst.definitionId, matMul(parentTransform, inst.transform), new Set());
  }

  /**
   * Caja envolvente de una instancia expresada en el espacio de su contenedor,
   * alineada a los ejes locales de la definición (útil para la herramienta
   * escalar).
   */
  instanceLocalBounds(inst: Instance): Box3 {
    return this.definitionBounds(inst.definitionId, IDENTITY, new Set());
  }

  /** Vértices del volumen envolvente transformado (para dibujar cajas). */
  instanceBoxCorners(inst: Instance): ReturnType<typeof boxCorners> {
    const b = this.instanceLocalBounds(inst);
    return boxCorners(b).map((c) => transformPoint(inst.transform, c));
  }

  /**
   * Geometría realmente presente en la escena: recorre el árbol desde la raíz,
   * de modo que una definición usada dos veces cuenta dos veces y una
   * definición huérfana no cuenta nada. Es lo que debe ver el usuario en el
   * panel de información.
   */
  visibleStats(): { vertices: number; edges: number; faces: number; instances: number } {
    let vertices = 0;
    let edges = 0;
    let faces = 0;
    let instances = 0;

    const walk = (defId: Id, depth: number) => {
      if (depth > 32) return;
      const def = this.definitions.get(defId);
      if (!def) return;
      const s = def.geometry.stats();
      vertices += s.vertices;
      edges += s.edges;
      faces += s.faces;
      for (const inst of def.geometry.instances.values()) {
        if (inst.hidden) continue;
        instances++;
        walk(inst.definitionId, depth + 1);
      }
    };
    walk(this.rootId, 0);
    return { vertices, edges, faces, instances };
  }

  /** Estadísticas de todo lo almacenado, incluidas las definiciones sin uso. */
  stats(): { vertices: number; edges: number; faces: number; instances: number; definitions: number } {
    let vertices = 0;
    let edges = 0;
    let faces = 0;
    let instances = 0;
    for (const d of this.definitions.values()) {
      const s = d.geometry.stats();
      vertices += s.vertices;
      edges += s.edges;
      faces += s.faces;
      instances += s.instances;
    }
    return { vertices, edges, faces, instances, definitions: this.definitions.size };
  }
}

export const DEFAULT_MATERIALS: Material[] = [
  { id: 'blanco', name: 'Blanco', color: '#f2f2f2', opacity: 1 },
  { id: 'gris', name: 'Gris', color: '#9aa0a6', opacity: 1 },
  { id: 'madera', name: 'Madera', color: '#c68b59', opacity: 1 },
  { id: 'ladrillo', name: 'Ladrillo', color: '#a4543a', opacity: 1 },
  { id: 'hormigon', name: 'Hormigón', color: '#b9b9b4', opacity: 1 },
  { id: 'metal', name: 'Metal', color: '#8d949c', opacity: 1 },
  { id: 'cesped', name: 'Césped', color: '#6f9c48', opacity: 1 },
  { id: 'agua', name: 'Agua', color: '#4a90d9', opacity: 0.55 },
  { id: 'vidrio', name: 'Vidrio', color: '#bcd8e6', opacity: 0.3 },
  { id: 'rojo', name: 'Rojo', color: '#d1462f', opacity: 1 },
  { id: 'azul', name: 'Azul', color: '#3b6ea5', opacity: 1 },
  { id: 'negro', name: 'Negro', color: '#2b2b2b', opacity: 1 },
];

/**
 * Ruta de edición: lista de ids de instancia desde la raíz hasta el contexto
 * activo. Una ruta vacía significa que se está editando el modelo raíz.
 */
export type ContextPath = readonly Id[];

export interface ResolvedContext {
  /** Geometría que se está editando. */
  geometry: Geometry;
  /** Definición correspondiente. */
  definition: Definition;
  /** Transformación acumulada del contexto al espacio global. */
  transform: Mat4;
  /** Ruta usada. */
  path: ContextPath;
}

/** Resuelve una ruta de contexto a su geometría y transformación acumulada. */
export function resolveContext(model: Model, path: ContextPath): ResolvedContext {
  let def = model.root;
  let transform: Mat4 = IDENTITY;
  const valid: Id[] = [];
  for (const instId of path) {
    const inst = def.geometry.instances.get(instId);
    if (!inst) break;
    const nextDef = model.definitions.get(inst.definitionId);
    if (!nextDef) break;
    transform = matMul(transform, inst.transform);
    def = nextDef;
    valid.push(instId);
  }
  return { geometry: def.geometry, definition: def, transform, path: valid };
}
