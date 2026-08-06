import { Geometry } from '../model/geometry';
import { Id } from '../model/types';
import { Vec2 } from '../math/vec';
import { Plane, PlaneBasis, planeBasis, planeCanonical, to2D } from '../math/plane';
import { AREA_EPS } from '../math/tolerance';
import { pointInPolygon2, pointOnPolygonBoundary2 } from '../math/geom';
import { regionKeyOf } from './keys';

/**
 * Semiarista dirigida del grafo planar.
 * `dir` indica si recorre la arista del modelo de `a`→`b` (true) o al revés.
 */
export interface HalfEdge {
  edgeId: Id;
  dir: boolean;
  from: Id;
  to: Id;
}

/** Ciclo cerrado de semiaristas. */
export interface Cycle {
  halves: HalfEdge[];
  /** Área con signo en el plano 2D: positiva = antihorario. */
  area: number;
  /** Componente conexa a la que pertenece. */
  comp: number;
}

/** Región del arreglo planar: contorno exterior + agujeros. */
export interface Region {
  outer: Cycle;
  holes: Cycle[];
}

export interface ArrangementResult {
  /** Base ortonormal canónica usada para proyectar a 2D. */
  basis: PlaneBasis;
  /** Plano canónico (normal con primer componente significativo positivo). */
  plane: Plane;
  /** Todos los ciclos hallados. */
  cycles: Cycle[];
  /** Regiones acotadas con sus agujeros. */
  regions: Region[];
  /** Proyección 2D de cada vértice participante. */
  points: Map<Id, Vec2>;
}

/**
 * Estructura union-find para calcular componentes conexas.
 *
 * `find` es ITERATIVO a propósito: con la versión recursiva, una polilínea de
 * unos 20 000 vértices coplanares desbordaba la pila y abortaba la
 * reconstrucción de caras del plano entero. La unión por tamaño mantiene los
 * árboles planos incluso sin compresión.
 */
class DSU {
  private parent = new Map<Id, Id>();
  private size = new Map<Id, number>();

  find(x: Id): Id {
    let root = x;
    for (;;) {
      const p = this.parent.get(root);
      if (p === undefined) {
        this.parent.set(root, root);
        this.size.set(root, 1);
        break;
      }
      if (p === root) break;
      root = p;
    }
    // Compresión de camino, también iterativa.
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur) ?? root;
      this.parent.set(cur, root);
      if (next === cur) break;
      cur = next;
    }
    return root;
  }

  union(a: Id, b: Id): void {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return;
    if ((this.size.get(ra) ?? 1) < (this.size.get(rb) ?? 1)) {
      const t = ra;
      ra = rb;
      rb = t;
    }
    this.parent.set(rb, ra);
    this.size.set(ra, (this.size.get(ra) ?? 1) + (this.size.get(rb) ?? 1));
  }
}

/**
 * Calcula el arreglo planar (subdivisión del plano) formado por las aristas
 * indicadas, que deben estar todas contenidas en `plane`.
 *
 * El algoritmo es el clásico de "recorrido de caras por semiaristas":
 *  1. Se proyectan los vértices al plano 2D.
 *  2. En cada vértice se ordenan las semiaristas salientes por ángulo.
 *  3. `next(h)` = la semiaristas inmediatamente anterior (en sentido
 *     antihorario) a la gemela de `h` en el vértice destino. Recorrer con esta
 *     regla produce ciclos que rodean cada cara en sentido antihorario.
 *  4. Los ciclos de área positiva son caras acotadas; los de área negativa son
 *     el contorno exterior de una componente conexa y pueden ser agujeros de
 *     otra cara.
 *
 * El resultado es determinista: la base del plano y el orden de las aristas se
 * canonizan antes de empezar.
 */
export function computeArrangement(
  geo: Geometry,
  planeIn: Plane,
  edgeIds: readonly Id[],
): ArrangementResult {
  const plane = planeCanonical(planeIn);
  const basis = planeBasis(plane);

  // --- Filtrar aristas válidas y proyectar vértices -------------------------
  const edges: Id[] = [];
  const points = new Map<Id, Vec2>();
  for (const eid of edgeIds) {
    const e = geo.edges.get(eid);
    if (!e) continue;
    const va = geo.vertices.get(e.a);
    const vb = geo.vertices.get(e.b);
    if (!va || !vb) continue;
    edges.push(eid);
    if (!points.has(e.a)) points.set(e.a, to2D(basis, va.p));
    if (!points.has(e.b)) points.set(e.b, to2D(basis, vb.p));
  }
  // Orden estable por id para reproducibilidad.
  edges.sort((a, b) => a - b);

  const empty: ArrangementResult = { basis, plane, cycles: [], regions: [], points };
  if (edges.length === 0) return empty;

  // --- Construir semiaristas ------------------------------------------------
  const halves: HalfEdge[] = [];
  const angles: number[] = [];
  for (const eid of edges) {
    const e = geo.edges.get(eid)!;
    const pa = points.get(e.a)!;
    const pb = points.get(e.b)!;
    // Índice par: a→b. Índice impar: b→a. La gemela de `i` es `i ^ 1`.
    halves.push({ edgeId: eid, dir: true, from: e.a, to: e.b });
    angles.push(Math.atan2(pb.y - pa.y, pb.x - pa.x));
    halves.push({ edgeId: eid, dir: false, from: e.b, to: e.a });
    angles.push(Math.atan2(pa.y - pb.y, pa.x - pb.x));
  }

  // --- Semiaristas salientes por vértice, ordenadas por ángulo -------------
  const outgoing = new Map<Id, number[]>();
  for (let i = 0; i < halves.length; i++) {
    const v = halves[i].from;
    let list = outgoing.get(v);
    if (!list) {
      list = [];
      outgoing.set(v, list);
    }
    list.push(i);
  }
  for (const list of outgoing.values()) {
    list.sort((i, j) => {
      const d = angles[i] - angles[j];
      if (Math.abs(d) > 1e-12) return d;
      // Desempate determinista para aristas superpuestas (no debería ocurrir
      // tras la inserción con partición, pero evita ciclos infinitos).
      return halves[i].edgeId - halves[j].edgeId || i - j;
    });
  }
  const posInVertex = new Int32Array(halves.length);
  for (const list of outgoing.values()) {
    for (let k = 0; k < list.length; k++) posInVertex[list[k]] = k;
  }

  // --- Componentes conexas --------------------------------------------------
  const dsu = new DSU();
  for (const eid of edges) {
    const e = geo.edges.get(eid)!;
    dsu.union(e.a, e.b);
  }
  const compIndex = new Map<Id, number>();
  let compCount = 0;
  for (const v of points.keys()) {
    const root = dsu.find(v);
    if (!compIndex.has(root)) compIndex.set(root, compCount++);
  }
  const compOf = (v: Id): number => compIndex.get(dsu.find(v))!;

  // --- Recorrido de ciclos --------------------------------------------------
  const nextOf = (h: number): number => {
    const twin = h ^ 1;
    const v = halves[h].to;
    const list = outgoing.get(v)!;
    const pos = posInVertex[twin];
    return list[(pos - 1 + list.length) % list.length];
  };

  const visited = new Uint8Array(halves.length);
  const cycles: Cycle[] = [];
  const maxSteps = halves.length + 1;

  for (let start = 0; start < halves.length; start++) {
    if (visited[start]) continue;
    const chain: number[] = [];
    let h = start;
    let steps = 0;
    while (!visited[h] && steps <= maxSteps) {
      visited[h] = 1;
      chain.push(h);
      h = nextOf(h);
      steps++;
    }
    if (chain.length === 0) continue;
    // Si el recorrido no volvió al inicio hay una inconsistencia; se descarta.
    if (h !== start) continue;

    const cycleHalves = chain.map((i) => halves[i]);
    const area = signedAreaOfCycle(cycleHalves, points);
    cycles.push({ halves: cycleHalves, area, comp: compOf(cycleHalves[0].from) });
  }

  // --- Clasificación en regiones -------------------------------------------
  const positives = cycles.filter((c) => c.area > AREA_EPS);
  const negatives = cycles.filter((c) => c.area < -AREA_EPS);

  // Los candidatos a albergar un agujero se preparan una sola vez: polígono,
  // caja envolvente y orden por área ascendente. Sin esto, cada ciclo negativo
  // se probaba contra TODOS los positivos con punto-en-polígono completo, lo
  // que hacía el arreglo cuadrático en el número de caras del plano.
  const candidates: HostCandidate[] = positives.map((cycle) => {
    const poly = cyclePolygon(cycle, points);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { cycle, poly, minX, minY, maxX, maxY };
  });
  // Ascendente por área: el primero que contenga el punto es ya el más pequeño.
  candidates.sort((a, b) => a.cycle.area - b.cycle.area);

  const regions: Region[] = positives.map((c) => ({ outer: c, holes: [] }));
  const regionOf = new Map<Cycle, Region>();
  for (const r of regions) regionOf.set(r.outer, r);

  for (const neg of negatives) {
    const host = findHostRegion(neg, candidates, points);
    if (host) regionOf.get(host)!.holes.push(neg);
  }

  // Orden determinista de regiones: por área descendente y luego por id mínimo.
  regions.sort((a, b) => {
    const d = b.outer.area - a.outer.area;
    if (Math.abs(d) > 1e-15) return d;
    return minEdgeId(a.outer) - minEdgeId(b.outer);
  });

  return { basis, plane, cycles, regions, points };
}

function minEdgeId(c: Cycle): number {
  let m = Infinity;
  for (const h of c.halves) if (h.edgeId < m) m = h.edgeId;
  return m;
}

/** Polígono 2D recorrido por el ciclo (vértices de origen de cada semiarista). */
export function cyclePolygon(c: Cycle, points: Map<Id, Vec2>): Vec2[] {
  return c.halves.map((h) => points.get(h.from)!);
}

function signedAreaOfCycle(halves: HalfEdge[], points: Map<Id, Vec2>): number {
  let a = 0;
  const n = halves.length;
  for (let i = 0; i < n; i++) {
    const p = points.get(halves[i].from)!;
    const q = points.get(halves[(i + 1) % n].from)!;
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}

/** Candidato a albergar un agujero, con su polígono y su caja envolvente. */
interface HostCandidate {
  cycle: Cycle;
  poly: Vec2[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Determina de qué región es agujero el ciclo negativo `neg`.
 *
 * Un ciclo negativo delimita el exterior de su componente conexa, de modo que
 * sólo puede ser agujero de una cara perteneciente a OTRA componente. Se elige
 * la cara de menor área que lo contiene, que es la que lo rodea inmediatamente.
 *
 * `candidates` llega ordenado por área ascendente, así que basta con devolver
 * el primero que contenga el punto; la caja envolvente descarta casi todos sin
 * llegar a la prueba de punto-en-polígono.
 */
function findHostRegion(
  neg: Cycle,
  candidates: readonly HostCandidate[],
  points: Map<Id, Vec2>,
): Cycle | null {
  if (candidates.length === 0) return null;

  // Se prueban varios vértices del ciclo por robustez numérica.
  const probes: Vec2[] = [];
  for (const h of neg.halves) {
    const p = points.get(h.from);
    if (p) probes.push(p);
    if (probes.length >= 8) break;
  }
  if (probes.length === 0) return null;

  for (const cand of candidates) {
    if (cand.cycle.comp === neg.comp) continue;
    // Rechazo por caja envolvente con el primer punto de sondeo.
    const p0 = probes[0];
    if (p0.x < cand.minX || p0.x > cand.maxX || p0.y < cand.minY || p0.y > cand.maxY) continue;

    let inside: boolean | null = null;
    for (const probe of probes) {
      if (pointOnPolygonBoundary2(cand.poly, probe, 1e-9)) continue;
      inside = pointInPolygon2(cand.poly, probe);
      break;
    }
    if (inside === true) return cand.cycle;
  }
  return null;
}

/**
 * Clave estable de una región, usada para recordar caras borradas a mano.
 *
 * Incluye los agujeros: sin ellos, borrar la cara de un anillo suprimiría
 * también el disco completo que debe aparecer al eliminar el hueco.
 */
export function regionKey(geo: Geometry, region: Region): string {
  const pointsOf = (cycle: Cycle) => {
    const pts = [];
    for (const h of cycle.halves) {
      const v = geo.vertices.get(h.from);
      if (v) pts.push(v.p);
    }
    return pts;
  };
  return regionKeyOf(pointsOf(region.outer), region.holes.map(pointsOf));
}
