import { Id, Vertex, Edge, Face, Loop, Instance } from './types';
import { Vec3, v3, distanceSq, samePoint } from '../math/vec';
import { Plane, planeContains } from '../math/plane';
import { EPS, EPS2, WELD_GRID } from '../math/tolerance';
import { Box3, emptyBox, expandBox } from '../math/geom';

/** Asignador de identificadores monótono, compartido por todo el modelo. */
export class IdAllocator {
  private next: number;

  constructor(start = 1) {
    this.next = start;
  }

  alloc(): Id {
    return this.next++;
  }

  /** Garantiza que los futuros ids sean mayores que `id`. */
  bump(id: Id): void {
    if (id >= this.next) this.next = id + 1;
  }

  peek(): number {
    return this.next;
  }

  reset(start = 1): void {
    this.next = start;
  }
}

/**
 * Índice espacial simple por celdas para localizar vértices coincidentes en
 * O(1). El tamaño de celda es la tolerancia de soldadura; se consultan las 27
 * celdas vecinas para no perder vértices al otro lado de una frontera.
 */
class VertexHash {
  private cells = new Map<string, Id[]>();

  private key(x: number, y: number, z: number): string {
    return `${x}|${y}|${z}`;
  }

  private cellOf(p: Vec3): [number, number, number] {
    return [
      Math.floor(p.x / WELD_GRID),
      Math.floor(p.y / WELD_GRID),
      Math.floor(p.z / WELD_GRID),
    ];
  }

  add(id: Id, p: Vec3): void {
    const [cx, cy, cz] = this.cellOf(p);
    const k = this.key(cx, cy, cz);
    const list = this.cells.get(k);
    if (list) list.push(id);
    else this.cells.set(k, [id]);
  }

  remove(id: Id, p: Vec3): void {
    const [cx, cy, cz] = this.cellOf(p);
    const k = this.key(cx, cy, cz);
    const list = this.cells.get(k);
    if (!list) return;
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) this.cells.delete(k);
  }

  /** Candidatos en las 27 celdas alrededor de `p`. */
  candidates(p: Vec3): Id[] {
    const [cx, cy, cz] = this.cellOf(p);
    const out: Id[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = this.cells.get(this.key(cx + dx, cy + dy, cz + dz));
          if (list) out.push(...list);
        }
      }
    }
    return out;
  }

  clear(): void {
    this.cells.clear();
  }
}

/**
 * Contenedor de geometría: la "sopa" de vértices, aristas, caras e instancias
 * que forma el modelo raíz o el contenido de un grupo/componente.
 *
 * Invariantes que se mantienen en todo momento:
 *  - No hay dos vértices a distancia menor que EPS.
 *  - No hay dos aristas con el mismo par de vértices.
 *  - No hay aristas degeneradas (a === b).
 *  - `vertexEdges` y `edgeFaces` reflejan exactamente la topología.
 */
export class Geometry {
  readonly vertices = new Map<Id, Vertex>();
  readonly edges = new Map<Id, Edge>();
  readonly faces = new Map<Id, Face>();
  readonly instances = new Map<Id, Instance>();

  /** Aristas incidentes en cada vértice. */
  readonly vertexEdges = new Map<Id, Set<Id>>();
  /** Caras que usan cada arista (0, 1, 2 o más en geometría no-manifold). */
  readonly edgeFaces = new Map<Id, Set<Id>>();

  /**
   * Regiones cuya cara fue borrada explícitamente por el usuario. Impide que el
   * reconstructor de caras las vuelva a crear, replicando el comportamiento de
   * SketchUp al borrar una cara dejando sus aristas.
   */
  readonly suppressedRegions = new Set<string>();

  private hash = new VertexHash();

  constructor(readonly ids: IdAllocator) {}

  // -------------------------------------------------------------------------
  // Vértices
  // -------------------------------------------------------------------------

  /** Busca un vértice existente en la posición `p` (dentro de tolerancia). */
  findVertexAt(p: Vec3, eps = EPS): Id | null {
    let best: Id | null = null;
    let bestD = eps * eps;
    for (const id of this.hash.candidates(p)) {
      const v = this.vertices.get(id);
      if (!v) continue;
      const d = distanceSq(v.p, p);
      if (d <= bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  /** Todos los vértices dentro de `eps` de `p`, ordenados por cercanía. */
  findVerticesNear(p: Vec3, eps = EPS): Id[] {
    const out: Array<{ id: Id; d: number }> = [];
    for (const id of this.hash.candidates(p)) {
      const v = this.vertices.get(id);
      if (!v) continue;
      const d = distanceSq(v.p, p);
      if (d <= eps * eps) out.push({ id, d });
    }
    out.sort((a, b) => a.d - b.d);
    return out.map((o) => o.id);
  }

  /** Devuelve el vértice existente en `p` o crea uno nuevo. */
  addVertex(p: Vec3): Id {
    const existing = this.findVertexAt(p);
    if (existing !== null) return existing;
    const id = this.ids.alloc();
    this.vertices.set(id, { id, p });
    this.vertexEdges.set(id, new Set());
    this.hash.add(id, p);
    return id;
  }

  /** Crea un vértice sin buscar coincidencias (uso interno del deserializador). */
  addVertexRaw(id: Id, p: Vec3): void {
    this.vertices.set(id, { id, p });
    if (!this.vertexEdges.has(id)) this.vertexEdges.set(id, new Set());
    this.hash.add(id, p);
    this.ids.bump(id);
  }

  vertexPos(id: Id): Vec3 {
    const v = this.vertices.get(id);
    if (!v) throw new Error(`Vértice inexistente: ${id}`);
    return v.p;
  }

  /** Mueve un vértice manteniendo el índice espacial coherente. */
  moveVertex(id: Id, p: Vec3): void {
    const v = this.vertices.get(id);
    if (!v) return;
    this.hash.remove(id, v.p);
    v.p = p;
    this.hash.add(id, p);
  }

  /** Elimina un vértice que ya no tiene aristas. */
  removeVertexIfIsolated(id: Id): boolean {
    const set = this.vertexEdges.get(id);
    if (set && set.size > 0) return false;
    const v = this.vertices.get(id);
    if (!v) return false;
    this.hash.remove(id, v.p);
    this.vertices.delete(id);
    this.vertexEdges.delete(id);
    return true;
  }

  // -------------------------------------------------------------------------
  // Aristas
  // -------------------------------------------------------------------------

  /** Busca la arista que une dos vértices (en cualquier orden). */
  findEdge(a: Id, b: Id): Id | null {
    const set = this.vertexEdges.get(a);
    if (!set) return null;
    for (const e of set) {
      const edge = this.edges.get(e);
      if (!edge) continue;
      if ((edge.a === a && edge.b === b) || (edge.a === b && edge.b === a)) return e;
    }
    return null;
  }

  /**
   * Crea la arista entre dos vértices, o devuelve la existente.
   * Devuelve null si los vértices coinciden (arista degenerada).
   */
  addEdgeByVertices(a: Id, b: Id): Id | null {
    if (a === b) return null;
    const existing = this.findEdge(a, b);
    if (existing !== null) return existing;
    const id = this.ids.alloc();
    this.edges.set(id, { id, a, b, soft: false, smooth: false, hidden: false });
    this.vertexEdges.get(a)!.add(id);
    this.vertexEdges.get(b)!.add(id);
    this.edgeFaces.set(id, new Set());
    return id;
  }

  addEdgeRaw(e: Edge): void {
    this.edges.set(e.id, e);
    if (!this.vertexEdges.has(e.a)) this.vertexEdges.set(e.a, new Set());
    if (!this.vertexEdges.has(e.b)) this.vertexEdges.set(e.b, new Set());
    this.vertexEdges.get(e.a)!.add(e.id);
    this.vertexEdges.get(e.b)!.add(e.id);
    if (!this.edgeFaces.has(e.id)) this.edgeFaces.set(e.id, new Set());
    this.ids.bump(e.id);
  }

  edgeEndpoints(id: Id): [Vec3, Vec3] {
    const e = this.edges.get(id);
    if (!e) throw new Error(`Arista inexistente: ${id}`);
    return [this.vertexPos(e.a), this.vertexPos(e.b)];
  }

  edgeLength(id: Id): number {
    const [a, b] = this.edgeEndpoints(id);
    return Math.sqrt(distanceSq(a, b));
  }

  /** El otro extremo de la arista respecto de `v`. */
  edgeOther(edgeId: Id, v: Id): Id {
    const e = this.edges.get(edgeId)!;
    return e.a === v ? e.b : e.a;
  }

  /**
   * Elimina una arista y todas las caras que la usan. Los vértices que quedan
   * aislados se eliminan también.
   */
  removeEdge(id: Id): void {
    const e = this.edges.get(id);
    if (!e) return;
    for (const f of [...(this.edgeFaces.get(id) ?? [])]) {
      this.removeFace(f);
    }
    this.vertexEdges.get(e.a)?.delete(id);
    this.vertexEdges.get(e.b)?.delete(id);
    this.edges.delete(id);
    this.edgeFaces.delete(id);
    this.removeVertexIfIsolated(e.a);
    this.removeVertexIfIsolated(e.b);
  }

  // -------------------------------------------------------------------------
  // Caras
  // -------------------------------------------------------------------------

  addFace(loops: Loop[], plane: Plane, frontMaterial: string | null = null, backMaterial: string | null = null): Id {
    const id = this.ids.alloc();
    const face: Face = { id, loops, plane, frontMaterial, backMaterial, hidden: false };
    this.faces.set(id, face);
    for (const loop of loops) {
      for (const e of loop.edges) {
        let set = this.edgeFaces.get(e);
        if (!set) {
          set = new Set();
          this.edgeFaces.set(e, set);
        }
        set.add(id);
      }
    }
    return id;
  }

  addFaceRaw(face: Face): void {
    this.faces.set(face.id, face);
    for (const loop of face.loops) {
      for (const e of loop.edges) {
        let set = this.edgeFaces.get(e);
        if (!set) {
          set = new Set();
          this.edgeFaces.set(e, set);
        }
        set.add(face.id);
      }
    }
    this.ids.bump(face.id);
  }

  /** Elimina la cara pero conserva sus aristas. */
  removeFace(id: Id): void {
    const f = this.faces.get(id);
    if (!f) return;
    for (const loop of f.loops) {
      for (const e of loop.edges) {
        this.edgeFaces.get(e)?.delete(id);
      }
    }
    this.faces.delete(id);
  }

  /** Todas las aristas del contorno de una cara (exterior + agujeros). */
  faceEdges(id: Id): Id[] {
    const f = this.faces.get(id);
    if (!f) return [];
    const out: Id[] = [];
    for (const loop of f.loops) out.push(...loop.edges);
    return out;
  }

  /** Vértices únicos de una cara. */
  faceVertices(id: Id): Id[] {
    const f = this.faces.get(id);
    if (!f) return [];
    const seen = new Set<Id>();
    const out: Id[] = [];
    for (const loop of f.loops) {
      for (const v of loop.vertices) {
        if (!seen.has(v)) {
          seen.add(v);
          out.push(v);
        }
      }
    }
    return out;
  }

  /** Puntos 3D del bucle `loopIndex` de la cara. */
  loopPoints(faceId: Id, loopIndex: number): Vec3[] {
    const f = this.faces.get(faceId);
    if (!f) return [];
    const loop = f.loops[loopIndex];
    if (!loop) return [];
    return loop.vertices.map((v) => this.vertexPos(v));
  }

  /** Caras adyacentes a una cara a través de sus aristas. */
  adjacentFaces(faceId: Id): Id[] {
    const out = new Set<Id>();
    for (const e of this.faceEdges(faceId)) {
      for (const f of this.edgeFaces.get(e) ?? []) {
        if (f !== faceId) out.add(f);
      }
    }
    return [...out];
  }

  // -------------------------------------------------------------------------
  // Instancias
  // -------------------------------------------------------------------------

  addInstance(inst: Omit<Instance, 'id'>): Id {
    const id = this.ids.alloc();
    this.instances.set(id, { ...inst, id });
    return id;
  }

  addInstanceRaw(inst: Instance): void {
    this.instances.set(inst.id, inst);
    this.ids.bump(inst.id);
  }

  removeInstance(id: Id): void {
    this.instances.delete(id);
  }

  // -------------------------------------------------------------------------
  // Consultas
  // -------------------------------------------------------------------------

  isEmpty(): boolean {
    return this.vertices.size === 0 && this.instances.size === 0;
  }

  /** Aristas cuyos dos extremos están en el plano dado. */
  edgesOnPlane(plane: Plane, eps = EPS): Id[] {
    const out: Id[] = [];
    for (const e of this.edges.values()) {
      const pa = this.vertices.get(e.a);
      const pb = this.vertices.get(e.b);
      if (!pa || !pb) continue;
      if (planeContains(plane, pa.p, eps) && planeContains(plane, pb.p, eps)) {
        out.push(e.id);
      }
    }
    return out;
  }

  /** Caras contenidas en el plano dado. */
  facesOnPlane(plane: Plane, eps = EPS): Id[] {
    const out: Id[] = [];
    for (const f of this.faces.values()) {
      const same =
        Math.abs(Math.abs(f.plane.n.x * plane.n.x + f.plane.n.y * plane.n.y + f.plane.n.z * plane.n.z) - 1) < 1e-7 &&
        Math.abs(Math.abs(f.plane.d) - Math.abs(plane.d)) < eps;
      if (!same) continue;
      // Verificación robusta: todos los vértices deben pertenecer al plano.
      let ok = true;
      for (const v of this.faceVertices(f.id)) {
        if (!planeContains(plane, this.vertexPos(v), eps)) {
          ok = false;
          break;
        }
      }
      if (ok) out.push(f.id);
    }
    return out;
  }

  /** Caja envolvente de la geometría propia (sin instancias). */
  boundsLocal(): Box3 {
    const b = emptyBox();
    for (const v of this.vertices.values()) expandBox(b, v.p);
    return b;
  }

  /** Número total de entidades (para diagnósticos). */
  stats(): { vertices: number; edges: number; faces: number; instances: number } {
    return {
      vertices: this.vertices.size,
      edges: this.edges.size,
      faces: this.faces.size,
      instances: this.instances.size,
    };
  }

  /** Reconstruye el índice espacial (tras mover muchos vértices). */
  rebuildSpatialIndex(): void {
    this.hash.clear();
    for (const v of this.vertices.values()) this.hash.add(v.id, v.p);
  }

  /**
   * Comprueba los invariantes internos. Sólo se usa en pruebas: devuelve la
   * lista de problemas encontrados (vacía si todo está bien).
   */
  validate(): string[] {
    const errs: string[] = [];

    for (const e of this.edges.values()) {
      if (!this.vertices.has(e.a)) errs.push(`arista ${e.id}: vértice a=${e.a} inexistente`);
      if (!this.vertices.has(e.b)) errs.push(`arista ${e.id}: vértice b=${e.b} inexistente`);
      if (e.a === e.b) errs.push(`arista ${e.id}: degenerada`);
      if (!this.vertexEdges.get(e.a)?.has(e.id)) errs.push(`arista ${e.id}: falta en vertexEdges[${e.a}]`);
      if (!this.vertexEdges.get(e.b)?.has(e.id)) errs.push(`arista ${e.id}: falta en vertexEdges[${e.b}]`);
      const va = this.vertices.get(e.a);
      const vb = this.vertices.get(e.b);
      if (va && vb && distanceSq(va.p, vb.p) <= EPS2) {
        errs.push(`arista ${e.id}: longitud nula`);
      }
    }

    for (const [vid, set] of this.vertexEdges) {
      if (!this.vertices.has(vid)) errs.push(`vertexEdges: vértice ${vid} inexistente`);
      for (const eid of set) {
        const e = this.edges.get(eid);
        if (!e) errs.push(`vertexEdges[${vid}]: arista ${eid} inexistente`);
        else if (e.a !== vid && e.b !== vid) errs.push(`vertexEdges[${vid}]: arista ${eid} no incide`);
      }
    }

    for (const f of this.faces.values()) {
      if (f.loops.length === 0) errs.push(`cara ${f.id}: sin bucles`);
      for (let li = 0; li < f.loops.length; li++) {
        const loop = f.loops[li];
        const n = loop.edges.length;
        if (n < 3) errs.push(`cara ${f.id} bucle ${li}: menos de 3 aristas`);
        if (loop.dirs.length !== n || loop.vertices.length !== n) {
          errs.push(`cara ${f.id} bucle ${li}: longitudes inconsistentes`);
          continue;
        }
        for (let i = 0; i < n; i++) {
          const e = this.edges.get(loop.edges[i]);
          if (!e) {
            errs.push(`cara ${f.id} bucle ${li}: arista ${loop.edges[i]} inexistente`);
            continue;
          }
          const from = loop.dirs[i] ? e.a : e.b;
          const to = loop.dirs[i] ? e.b : e.a;
          if (from !== loop.vertices[i]) {
            errs.push(`cara ${f.id} bucle ${li}: vértice ${i} no coincide con la arista`);
          }
          if (to !== loop.vertices[(i + 1) % n]) {
            errs.push(`cara ${f.id} bucle ${li}: cadena rota en ${i}`);
          }
          if (!this.edgeFaces.get(e.id)?.has(f.id)) {
            errs.push(`cara ${f.id}: falta en edgeFaces[${e.id}]`);
          }
        }
      }
      // Todos los vértices deben estar en el plano de la cara.
      for (const v of this.faceVertices(f.id)) {
        if (!planeContains(f.plane, this.vertexPos(v), 1e-5)) {
          errs.push(`cara ${f.id}: vértice ${v} fuera del plano`);
        }
      }
    }

    for (const [eid, set] of this.edgeFaces) {
      if (!this.edges.has(eid)) errs.push(`edgeFaces: arista ${eid} inexistente`);
      for (const fid of set) {
        if (!this.faces.has(fid)) errs.push(`edgeFaces[${eid}]: cara ${fid} inexistente`);
      }
    }

    return errs;
  }

  /** Copia profunda de la geometría (comparte el asignador de ids). */
  clone(ids = this.ids): Geometry {
    const g = new Geometry(ids);
    for (const v of this.vertices.values()) g.addVertexRaw(v.id, v3(v.p.x, v.p.y, v.p.z));
    for (const e of this.edges.values()) g.addEdgeRaw({ ...e });
    for (const f of this.faces.values()) {
      g.addFaceRaw({
        ...f,
        loops: f.loops.map((l) => ({ edges: [...l.edges], dirs: [...l.dirs], vertices: [...l.vertices] })),
        plane: { n: v3(f.plane.n.x, f.plane.n.y, f.plane.n.z), d: f.plane.d },
      });
    }
    for (const i of this.instances.values()) g.addInstanceRaw({ ...i, transform: [...i.transform] });
    for (const r of this.suppressedRegions) g.suppressedRegions.add(r);
    return g;
  }
}

/** Utilidad: ¿coinciden dos puntos dentro de tolerancia? (reexport) */
export { samePoint };
