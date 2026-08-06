import { Geometry } from '../model/geometry';
import { Id } from '../model/types';
import { Vec2 } from '../math/vec';
import { Plane, PlaneBasis, planeBasis, planeCanonical, to2D } from '../math/plane';
import { AREA_EPS } from '../math/tolerance';
import { pointInPolygon2, pointOnPolygonBoundary2 } from '../math/geom';

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

/** Estructura union-find para calcular componentes conexas. */
class DSU {
  private parent = new Map<Id, Id>();

  find(x: Id): Id {
    let p = this.parent.get(x);
    if (p === undefined) {
      this.parent.set(x, x);
      return x;
    }
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }

  union(a: Id, b: Id): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
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

  const polys = new Map<Cycle, Vec2[]>();
  for (const c of positives) polys.set(c, cyclePolygon(c, points));

  const regions: Region[] = positives.map((c) => ({ outer: c, holes: [] }));
  const regionOf = new Map<Cycle, Region>();
  for (const r of regions) regionOf.set(r.outer, r);

  for (const neg of negatives) {
    const host = findHostRegion(neg, positives, polys, points);
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

/**
 * Determina de qué región es agujero el ciclo negativo `neg`.
 *
 * Un ciclo negativo delimita el exterior de su componente conexa, de modo que
 * sólo puede ser agujero de una cara perteneciente a OTRA componente. Se elige
 * la cara de menor área que lo contiene, que es la que lo rodea inmediatamente.
 */
function findHostRegion(
  neg: Cycle,
  positives: Cycle[],
  polys: Map<Cycle, Vec2[]>,
  points: Map<Id, Vec2>,
): Cycle | null {
  const candidates = positives.filter((p) => p.comp !== neg.comp);
  if (candidates.length === 0) return null;

  // Se prueban varios vértices del ciclo por robustez numérica.
  const probes: Vec2[] = [];
  for (const h of neg.halves) {
    const p = points.get(h.from);
    if (p) probes.push(p);
    if (probes.length >= 8) break;
  }

  let best: Cycle | null = null;
  let bestArea = Infinity;
  for (const cand of candidates) {
    const poly = polys.get(cand)!;
    let inside: boolean | null = null;
    for (const probe of probes) {
      if (pointOnPolygonBoundary2(poly, probe, 1e-9)) continue;
      inside = pointInPolygon2(poly, probe);
      break;
    }
    if (inside !== true) continue;
    if (cand.area < bestArea) {
      bestArea = cand.area;
      best = cand;
    }
  }
  return best;
}

/**
 * Clave estable de una región, usada para recordar caras borradas a mano.
 * Se construye con las posiciones cuantizadas de los vértices del contorno
 * exterior, ordenadas, de modo que no dependa del punto de inicio ni del
 * sentido del recorrido.
 */
export function regionKey(geo: Geometry, region: Region): string {
  const q = (n: number) => (Math.round(n * 1e6) / 1e6).toFixed(6);
  const parts: string[] = [];
  for (const h of region.outer.halves) {
    const p = geo.vertices.get(h.from);
    if (!p) continue;
    parts.push(`${q(p.p.x)},${q(p.p.y)},${q(p.p.z)}`);
  }
  parts.sort();
  return parts.join(';');
}
