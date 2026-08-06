import { Geometry } from '../model/geometry';
import { Id, Loop } from '../model/types';
import { Vec3, v3, add, sub, mul, normalize, distance } from '../math/vec';
import { planeFromPolygon } from '../math/plane';
import { EPS } from '../math/tolerance';
import { orientFacesConsistently } from '../topology/orient';

/**
 * Sólidos paramétricos.
 *
 * Se construyen directamente sobre una geometría vacía: como se conoce de
 * antemano toda la topología, no hace falta pasar por el partidor de aristas ni
 * por la subdivisión planar, y el resultado es exacto e inmediato incluso con
 * cientos de caras.
 *
 * Todas las caras que se crean son planas por construcción: las superficies
 * curvas (esfera, cono) se resuelven con triángulos, y las diagonales añadidas
 * se marcan como suaves para que no se dibujen.
 */

/** Crea una cara a partir de sus puntos, creando vértices y aristas. */
export function addPolygonFace(
  geo: Geometry,
  outer: readonly Vec3[],
  holes: readonly (readonly Vec3[])[] = [],
): Id | null {
  const buildLoop = (points: readonly Vec3[]): Loop | null => {
    const verts: Id[] = [];
    for (const p of points) {
      const v = geo.addVertex(p);
      if (verts.length === 0 || verts[verts.length - 1] !== v) verts.push(v);
    }
    if (verts.length > 1 && verts[0] === verts[verts.length - 1]) verts.pop();
    if (verts.length < 3) return null;

    const edges: Id[] = [];
    const dirs: boolean[] = [];
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      const e = geo.addEdgeByVertices(a, b);
      if (e === null) return null;
      edges.push(e);
      dirs.push(geo.edges.get(e)!.a === a);
    }
    return { edges, dirs, vertices: verts };
  };

  const outerLoop = buildLoop(outer);
  if (!outerLoop) return null;

  const loops: Loop[] = [outerLoop];
  for (const hole of holes) {
    const l = buildLoop(hole);
    if (l) loops.push(l);
  }

  const plane = planeFromPolygon(outerLoop.vertices.map((v) => geo.vertexPos(v)));
  if (!plane) return null;
  return geo.addFace(loops, plane);
}

/** Marca una arista como suave (no se dibuja pero separa caras). */
function soften(geo: Geometry, a: Vec3, b: Vec3): void {
  const va = geo.findVertexAt(a);
  const vb = geo.findVertexAt(b);
  if (va === null || vb === null) return;
  const e = geo.findEdge(va, vb);
  if (e === null) return;
  const edge = geo.edges.get(e)!;
  edge.soft = true;
  edge.smooth = true;
}

/** Anillo de puntos en el plano Z = z. */
function ring(radius: number, segments: number, z: number, phase = 0): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i < segments; i++) {
    const a = phase + (i / segments) * Math.PI * 2;
    pts.push(v3(Math.cos(a) * radius, Math.sin(a) * radius, z));
  }
  return pts;
}

export interface SolidResult {
  faces: Id[];
}

function finish(geo: Geometry, faces: Id[]): SolidResult {
  orientFacesConsistently(geo, faces);
  return { faces: faces.filter((f) => geo.faces.has(f)) };
}

/**
 * Caja recta apoyada en el origen: ocupa [0,width] × [0,depth] × [0,height].
 */
export function makeBox(geo: Geometry, width: number, depth: number, height: number): SolidResult {
  if (width <= EPS || depth <= EPS || height <= EPS) return { faces: [] };
  const w = width;
  const d = depth;
  const h = height;
  const c = [
    v3(0, 0, 0), v3(w, 0, 0), v3(w, d, 0), v3(0, d, 0),
    v3(0, 0, h), v3(w, 0, h), v3(w, d, h), v3(0, d, h),
  ];
  const faces: Id[] = [];
  const quads: number[][] = [
    [0, 3, 2, 1], // base (mirando hacia abajo)
    [4, 5, 6, 7], // tapa
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ];
  for (const q of quads) {
    const f = addPolygonFace(geo, q.map((i) => c[i]));
    if (f !== null) faces.push(f);
  }
  return finish(geo, faces);
}

/** Prisma recto de base regular. `segments` lados, radio a los vértices. */
export function makeCylinder(
  geo: Geometry,
  radius: number,
  height: number,
  segments = 24,
): SolidResult {
  if (radius <= EPS || height <= EPS || segments < 3) return { faces: [] };
  const n = Math.min(512, Math.floor(segments));
  const bottom = ring(radius, n, 0);
  const top = ring(radius, n, height);
  const faces: Id[] = [];

  const base = addPolygonFace(geo, [...bottom].reverse());
  if (base !== null) faces.push(base);
  const cap = addPolygonFace(geo, top);
  if (cap !== null) faces.push(cap);

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const f = addPolygonFace(geo, [bottom[i], bottom[j], top[j], top[i]]);
    if (f !== null) faces.push(f);
  }
  // Las aristas verticales se suavizan para que la superficie parezca curva.
  for (let i = 0; i < n; i++) soften(geo, bottom[i], top[i]);
  return finish(geo, faces);
}

/** Cono recto con base regular. */
export function makeCone(
  geo: Geometry,
  radius: number,
  height: number,
  segments = 24,
): SolidResult {
  if (radius <= EPS || height <= EPS || segments < 3) return { faces: [] };
  const n = Math.min(512, Math.floor(segments));
  const base = ring(radius, n, 0);
  const apex = v3(0, 0, height);
  const faces: Id[] = [];

  const cap = addPolygonFace(geo, [...base].reverse());
  if (cap !== null) faces.push(cap);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const f = addPolygonFace(geo, [base[i], base[j], apex]);
    if (f !== null) faces.push(f);
  }
  for (let i = 0; i < n; i++) soften(geo, base[i], apex);
  return finish(geo, faces);
}

/** Pirámide de base regular (igual que el cono pero sin suavizar las aristas). */
export function makePyramid(
  geo: Geometry,
  radius: number,
  height: number,
  sides = 4,
): SolidResult {
  if (radius <= EPS || height <= EPS || sides < 3) return { faces: [] };
  const n = Math.min(64, Math.floor(sides));
  const base = ring(radius, n, 0, Math.PI / n);
  const apex = v3(0, 0, height);
  const faces: Id[] = [];
  const cap = addPolygonFace(geo, [...base].reverse());
  if (cap !== null) faces.push(cap);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const f = addPolygonFace(geo, [base[i], base[j], apex]);
    if (f !== null) faces.push(f);
  }
  return finish(geo, faces);
}

/**
 * Esfera centrada en (0, 0, radius), es decir, apoyada en el suelo.
 *
 * Los cuadriláteros de una esfera no son planos, así que se divide cada uno en
 * dos triángulos y las diagonales se marcan como suaves.
 */
export function makeSphere(
  geo: Geometry,
  radius: number,
  segments = 24,
  rings = 12,
): SolidResult {
  if (radius <= EPS || segments < 3 || rings < 2) return { faces: [] };
  const n = Math.min(128, Math.floor(segments));
  const m = Math.min(64, Math.floor(rings));
  const cz = radius;

  // Puntos por paralelo: índice 0 = polo sur, m = polo norte.
  const rows: Vec3[][] = [];
  for (let j = 0; j <= m; j++) {
    const phi = -Math.PI / 2 + (j / m) * Math.PI;
    const z = cz + Math.sin(phi) * radius;
    const r = Math.cos(phi) * radius;
    if (j === 0 || j === m) {
      rows.push([v3(0, 0, z)]);
    } else {
      rows.push(ring(r, n, z));
    }
  }

  const faces: Id[] = [];
  const softEdges: Array<[Vec3, Vec3]> = [];

  for (let j = 0; j < m; j++) {
    const lower = rows[j];
    const upper = rows[j + 1];
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      if (lower.length === 1) {
        const f = addPolygonFace(geo, [lower[0], upper[i], upper[i2]]);
        if (f !== null) faces.push(f);
      } else if (upper.length === 1) {
        const f = addPolygonFace(geo, [lower[i], lower[i2], upper[0]]);
        if (f !== null) faces.push(f);
      } else {
        const f1 = addPolygonFace(geo, [lower[i], lower[i2], upper[i2]]);
        const f2 = addPolygonFace(geo, [lower[i], upper[i2], upper[i]]);
        if (f1 !== null) faces.push(f1);
        if (f2 !== null) faces.push(f2);
        softEdges.push([lower[i], upper[i2]]);
      }
    }
  }

  // Toda la superficie es curva: se suavizan también los paralelos y meridianos.
  for (let j = 1; j < m; j++) {
    const row = rows[j];
    for (let i = 0; i < row.length; i++) {
      softEdges.push([row[i], row[(i + 1) % row.length]]);
    }
  }
  for (let j = 0; j < m; j++) {
    const lower = rows[j];
    const upper = rows[j + 1];
    const count = Math.max(lower.length, upper.length);
    for (let i = 0; i < count; i++) {
      softEdges.push([lower[i % lower.length], upper[i % upper.length]]);
    }
  }
  for (const [a, b] of softEdges) soften(geo, a, b);

  return finish(geo, faces);
}

/** Tubo: prisma hueco con pared de grosor constante. */
export function makeTube(
  geo: Geometry,
  outerRadius: number,
  innerRadius: number,
  height: number,
  segments = 24,
): SolidResult {
  if (outerRadius <= EPS || height <= EPS || segments < 3) return { faces: [] };
  const inner = Math.max(0, Math.min(innerRadius, outerRadius - EPS));
  if (inner <= EPS) return makeCylinder(geo, outerRadius, height, segments);

  const n = Math.min(512, Math.floor(segments));
  const ob = ring(outerRadius, n, 0);
  const ot = ring(outerRadius, n, height);
  const ib = ring(inner, n, 0);
  const it = ring(inner, n, height);
  const faces: Id[] = [];

  // Coronas de base y tapa (cara con agujero).
  const base = addPolygonFace(geo, [...ob].reverse(), [ib]);
  if (base !== null) faces.push(base);
  const cap = addPolygonFace(geo, ot, [[...it].reverse()]);
  if (cap !== null) faces.push(cap);

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const fo = addPolygonFace(geo, [ob[i], ob[j], ot[j], ot[i]]);
    if (fo !== null) faces.push(fo);
    const fi = addPolygonFace(geo, [ib[j], ib[i], it[i], it[j]]);
    if (fi !== null) faces.push(fi);
  }
  for (let i = 0; i < n; i++) {
    soften(geo, ob[i], ot[i]);
    soften(geo, ib[i], it[i]);
  }
  return finish(geo, faces);
}

/** Rampa/cuña: caja con la cara superior inclinada. */
export function makeWedge(geo: Geometry, width: number, depth: number, height: number): SolidResult {
  if (width <= EPS || depth <= EPS || height <= EPS) return { faces: [] };
  const c = [
    v3(0, 0, 0), v3(width, 0, 0), v3(width, depth, 0), v3(0, depth, 0),
    v3(0, 0, height), v3(width, 0, height),
  ];
  const faces: Id[] = [];
  const polys: number[][] = [
    [0, 3, 2, 1],
    [0, 1, 5, 4],
    [4, 5, 2, 3],
    [1, 2, 5],
    [0, 4, 3],
  ];
  for (const p of polys) {
    const f = addPolygonFace(geo, p.map((i) => c[i]));
    if (f !== null) faces.push(f);
  }
  return finish(geo, faces);
}

/** Descripción de los sólidos disponibles, para construir el menú. */
export interface SolidParam {
  key: string;
  label: string;
  /** 'length' se interpreta con las unidades del modelo; 'count' es un entero. */
  kind: 'length' | 'count';
  defaultValue: number;
  min?: number;
}

export interface SolidDefinition {
  id: string;
  label: string;
  params: SolidParam[];
  build: (geo: Geometry, values: Record<string, number>) => SolidResult;
}

export const SOLIDS: SolidDefinition[] = [
  {
    id: 'box',
    label: 'Caja',
    params: [
      { key: 'width', label: 'Ancho', kind: 'length', defaultValue: 1 },
      { key: 'depth', label: 'Fondo', kind: 'length', defaultValue: 1 },
      { key: 'height', label: 'Alto', kind: 'length', defaultValue: 1 },
    ],
    build: (geo, v) => makeBox(geo, v.width, v.depth, v.height),
  },
  {
    id: 'cylinder',
    label: 'Cilindro',
    params: [
      { key: 'radius', label: 'Radio', kind: 'length', defaultValue: 0.5 },
      { key: 'height', label: 'Alto', kind: 'length', defaultValue: 1 },
      { key: 'segments', label: 'Segmentos', kind: 'count', defaultValue: 24, min: 3 },
    ],
    build: (geo, v) => makeCylinder(geo, v.radius, v.height, v.segments),
  },
  {
    id: 'cone',
    label: 'Cono',
    params: [
      { key: 'radius', label: 'Radio', kind: 'length', defaultValue: 0.5 },
      { key: 'height', label: 'Alto', kind: 'length', defaultValue: 1 },
      { key: 'segments', label: 'Segmentos', kind: 'count', defaultValue: 24, min: 3 },
    ],
    build: (geo, v) => makeCone(geo, v.radius, v.height, v.segments),
  },
  {
    id: 'sphere',
    label: 'Esfera',
    params: [
      { key: 'radius', label: 'Radio', kind: 'length', defaultValue: 0.5 },
      { key: 'segments', label: 'Meridianos', kind: 'count', defaultValue: 24, min: 3 },
      { key: 'rings', label: 'Paralelos', kind: 'count', defaultValue: 12, min: 2 },
    ],
    build: (geo, v) => makeSphere(geo, v.radius, v.segments, v.rings),
  },
  {
    id: 'pyramid',
    label: 'Pirámide',
    params: [
      { key: 'radius', label: 'Radio de la base', kind: 'length', defaultValue: 0.6 },
      { key: 'height', label: 'Alto', kind: 'length', defaultValue: 1 },
      { key: 'sides', label: 'Lados', kind: 'count', defaultValue: 4, min: 3 },
    ],
    build: (geo, v) => makePyramid(geo, v.radius, v.height, v.sides),
  },
  {
    id: 'tube',
    label: 'Tubo',
    params: [
      { key: 'outerRadius', label: 'Radio exterior', kind: 'length', defaultValue: 0.5 },
      { key: 'innerRadius', label: 'Radio interior', kind: 'length', defaultValue: 0.35 },
      { key: 'height', label: 'Alto', kind: 'length', defaultValue: 1 },
      { key: 'segments', label: 'Segmentos', kind: 'count', defaultValue: 24, min: 3 },
    ],
    build: (geo, v) => makeTube(geo, v.outerRadius, v.innerRadius, v.height, v.segments),
  },
  {
    id: 'wedge',
    label: 'Cuña',
    params: [
      { key: 'width', label: 'Ancho', kind: 'length', defaultValue: 1 },
      { key: 'depth', label: 'Fondo', kind: 'length', defaultValue: 1 },
      { key: 'height', label: 'Alto', kind: 'length', defaultValue: 0.6 },
    ],
    build: (geo, v) => makeWedge(geo, v.width, v.depth, v.height),
  },
];

/** Utilidades reexportadas para las pruebas. */
export { distance, normalize, add, sub, mul };
