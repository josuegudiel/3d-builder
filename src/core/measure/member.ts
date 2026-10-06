import {
  Vec3, v3, add, sub, mul, dot, cross, normalize, lengthSq, distance,
  addScaled, angleBetween,
} from '../math/vec';
import { closestPointsSegmentSegment } from '../math/geom';
import { Mat4, matMul, transformPoint, transformNormal } from '../math/mat';
import { Geometry } from '../model/geometry';
import { Model } from '../model/model';
import { Id } from '../model/types';
import { faceArea, triangulateFace } from '../topology/triangulate';
import { CutAngles, cutAngles, lineAngle, miterPlaneNormal, commonPlaneNormal } from './angles';
import { METERS_PER } from '../units';

/**
 * Reconocimiento de PIEZAS y análisis de sus uniones.
 *
 * Una pieza (un 2×4, un montante, un travesaño) es un prisma alargado. Lo que
 * hace falta saber de ella para hablar de ángulos es su marco propio: el eje
 * largo, el ancho y el grueso. Se obtiene con una caja envolvente ORIENTADA
 * construida a partir de las normales de sus propias caras, que para una pieza
 * recta reproduce exactamente sus tres direcciones.
 */

export interface Member {
  /** Caras que forman la pieza (vacío si se midió desde una instancia). */
  faces: Id[];
  /** Centro de la caja envolvente. */
  centre: Vec3;
  /** Eje largo, unitario. */
  axis: Vec3;
  /** Dirección del ancho, unitaria y perpendicular al eje. */
  widthDir: Vec3;
  /** Normal de la cara ancha (dirección del grueso), unitaria. */
  faceNormal: Vec3;
  /** Medidas de la caja envolvente, de mayor a menor. */
  length: number;
  width: number;
  thickness: number;
  /** Centros de las dos testas. */
  ends: [Vec3, Vec3];
  /** Volumen de la caja envolvente. */
  boxVolume: number;
}

interface Shape {
  points: Vec3[];
  /** Normales de cara con su área, para elegir las direcciones candidatas. */
  normals: Array<{ n: Vec3; area: number }>;
  /**
   * Direcciones de arista con su longitud. Una pieza sin caras —un grupo hecho
   * sólo de líneas— no tiene normales, pero sus aristas siguen apuntando en
   * las direcciones de la pieza.
   */
  edges?: Array<{ d: Vec3; length: number }>;
}

/** Puntos y normales de un conjunto de caras de una geometría. */
export function shapeOfFaces(geo: Geometry, faces: Iterable<Id>): Shape {
  const points: Vec3[] = [];
  const normals: Array<{ n: Vec3; area: number }> = [];
  const edges: Array<{ d: Vec3; length: number }> = [];
  const seen = new Set<Id>();
  const seenEdges = new Set<Id>();
  for (const fid of faces) {
    const f = geo.faces.get(fid);
    if (!f) continue;
    normals.push({ n: f.plane.n, area: faceArea(geo, fid) });
    for (const v of geo.faceVertices(fid)) {
      if (seen.has(v)) continue;
      seen.add(v);
      points.push(geo.vertexPos(v));
    }
    for (const eid of geo.faceEdges(fid)) {
      if (seenEdges.has(eid)) continue;
      seenEdges.add(eid);
      const [p, q] = geo.edgeEndpoints(eid);
      const d = sub(q, p);
      if (lengthSq(d) > 0) edges.push({ d: normalize(d), length: Math.sqrt(lengthSq(d)) });
    }
  }
  return { points, normals, edges };
}

/** Puntos y normales de una instancia, ya transformados al espacio contenedor. */
export function shapeOfInstance(model: Model, geo: Geometry, instanceId: Id): Shape | null {
  const inst = geo.instances.get(instanceId);
  if (!inst) return null;
  const out: Shape = { points: [], normals: [], edges: [] };
  walkDefinition(model, inst.definitionId, inst.transform, out, new Set());
  return out.points.length > 0 ? out : null;
}

function walkDefinition(
  model: Model,
  defId: Id,
  m: Mat4,
  out: Shape,
  visiting: Set<Id>,
): void {
  if (visiting.has(defId)) return;
  const def = model.definitions.get(defId);
  if (!def) return;
  visiting.add(defId);
  const g = def.geometry;
  for (const v of g.vertices.values()) out.points.push(transformPoint(m, v.p));
  for (const fid of g.faces.keys()) {
    const f = g.faces.get(fid)!;
    out.normals.push({ n: normalize(transformNormal(m, f.plane.n)), area: faceArea(g, fid) });
  }
  for (const e of g.edges.values()) {
    const p = transformPoint(m, g.vertexPos(e.a));
    const q = transformPoint(m, g.vertexPos(e.b));
    const d = sub(q, p);
    if (lengthSq(d) > 0) {
      (out.edges ??= []).push({ d: normalize(d), length: Math.sqrt(lengthSq(d)) });
    }
  }
  for (const child of g.instances.values()) {
    walkDefinition(model, child.definitionId, matMul(m, child.transform), out, visiting);
  }
  visiting.delete(defId);
}

/** Marco de una caja envolvente orientada. */
interface Frame {
  u: Vec3;
  v: Vec3;
  w: Vec3;
}

/**
 * Caja envolvente orientada de una nube de puntos.
 *
 * Se prueban los marcos que definen las propias normales de las caras, más el
 * que dan los ejes principales de la nube y los ejes globales, y se elige el
 * mejor. Para un prisma recto el resultado es exacto: sus caras ya dan las tres
 * direcciones.
 *
 * "El mejor" no puede ser sólo el de menor volumen: en una nube plana —una
 * tabla dibujada como una sola cara, un grupo hecho de aristas— todos los
 * marcos tienen volumen cero y ganaría el primero que se probara. La
 * comparación es por tanto en cascada: volumen, después área y por último
 * longitud, de modo que una tabla plana devuelve su largo y su ancho de verdad
 * y una nube alineada en una recta devuelve su longitud.
 */
function orientedBox(shape: Shape): { frame: Frame; min: Vec3; max: Vec3 } | null {
  if (shape.points.length < 2) return null;

  // Direcciones candidatas: normales distintas, las de mayor área primero.
  const dirs: Vec3[] = [];
  const addDir = (n: Vec3) => {
    if (lengthSq(n) <= 0) return;
    const u = normalize(n);
    for (const d of dirs) {
      if (Math.abs(dot(d, u)) > 1 - 1e-9) return;
    }
    dirs.push(u);
  };

  const ordered = [...shape.normals].sort((a, b) => b.area - a.area);
  for (const { n } of ordered) {
    addDir(n);
    if (dirs.length >= 16) break;
  }
  // Direcciones de arista, las más largas primero: son las que dan el marco
  // exacto de una pieza dibujada sólo con líneas, donde no hay normales.
  const byLength = [...(shape.edges ?? [])].sort((a, b) => b.length - a.length);
  for (const { d } of byLength) {
    addDir(d);
    if (dirs.length >= 24) break;
  }
  // Ejes principales de la nube: es lo único que da un marco correcto cuando no
  // hay caras de las que sacar normales (un grupo de sólo aristas, una pieza
  // torneada) o cuando la pieza es plana.
  for (const axis of principalAxes(shape.points)) addDir(axis);
  // Y los ejes globales, como último recurso siempre disponible.
  addDir(v3(1, 0, 0));
  addDir(v3(0, 1, 0));
  addDir(v3(0, 0, 1));

  // Escala de la nube, para que las tolerancias de comparación sean relativas.
  const world = extents(shape.points, { u: v3(1, 0, 0), v: v3(0, 1, 0), w: v3(0, 0, 1) });
  const scale = Math.max(
    world.max.x - world.min.x, world.max.y - world.min.y, world.max.z - world.min.z, 1e-12,
  );

  interface Candidate { frame: Frame; min: Vec3; max: Vec3; vol: number; area: number; len: number }
  let best: Candidate | null = null;

  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 1; j < dirs.length; j++) {
      if (Math.abs(dot(dirs[i], dirs[j])) > 1e-6) continue;
      const u = dirs[i];
      const v = normalize(sub(dirs[j], mul(u, dot(dirs[j], u))));
      if (lengthSq(v) <= 0) continue;
      const frame: Frame = { u, v, w: cross(u, v) };
      const ext = extents(shape.points, frame);
      const sides = [ext.max.x - ext.min.x, ext.max.y - ext.min.y, ext.max.z - ext.min.z]
        .sort((a, b) => b - a);
      const cand: Candidate = {
        frame, min: ext.min, max: ext.max,
        vol: sides[0] * sides[1] * sides[2],
        area: sides[0] * sides[1],
        len: sides[0],
      };
      if (!best || betterBox(cand, best, scale)) best = cand;
    }
  }
  if (best) return { frame: best.frame, min: best.min, max: best.max };

  // Ningún par perpendicular: caja alineada con los ejes globales.
  const frame: Frame = { u: v3(1, 0, 0), v: v3(0, 1, 0), w: v3(0, 0, 1) };
  const ext = extents(shape.points, frame);
  return { frame, min: ext.min, max: ext.max };
}

/** Comparación en cascada: volumen, área y longitud, con tolerancia relativa. */
function betterBox(
  a: { vol: number; area: number; len: number },
  b: { vol: number; area: number; len: number },
  scale: number,
): boolean {
  const ev = scale ** 3 * 1e-12;
  if (a.vol < b.vol - ev) return true;
  if (a.vol > b.vol + ev) return false;
  const ea = scale ** 2 * 1e-12;
  if (a.area < b.area - ea) return true;
  if (a.area > b.area + ea) return false;
  // A igualdad de volumen y área, gana la caja MÁS LARGA: es la que sigue la
  // dirección real de la pieza (una recta mide su longitud, no su diagonal).
  return a.len > b.len + scale * 1e-12;
}

/**
 * Ejes principales de una nube de puntos (matriz de covarianza diagonalizada
 * por rotaciones de Jacobi). Para una caja girada devuelve sus tres
 * direcciones aunque no haya ni una sola cara de la que sacarlas.
 */
function principalAxes(points: readonly Vec3[]): Vec3[] {
  const n = points.length;
  if (n < 2) return [];
  let cx = 0, cy = 0, cz = 0;
  for (const p of points) { cx += p.x; cy += p.y; cz += p.z; }
  cx /= n; cy /= n; cz /= n;

  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const p of points) {
    const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
    xx += dx * dx; xy += dx * dy; xz += dx * dz;
    yy += dy * dy; yz += dy * dz; zz += dz * dz;
  }

  let m = [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]];
  let v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const pairs: Array<[number, number]> = [[0, 1], [0, 2], [1, 2]];

  for (let sweep = 0; sweep < 24; sweep++) {
    const off = Math.abs(m[0][1]) + Math.abs(m[0][2]) + Math.abs(m[1][2]);
    const scale = Math.abs(m[0][0]) + Math.abs(m[1][1]) + Math.abs(m[2][2]);
    // El corte tiene que estar POR ENCIMA de la precisión de un double: con un
    // umbral menor, Jacobi no termina nunca y sigue girando sobre el ruido de
    // redondeo, que es justo lo que estropeaba las nubes de sección cuadrada.
    if (off <= scale * 1e-15 || off === 0) break;
    for (const [p, q] of pairs) {
      if (Math.abs(m[p][q]) <= 1e-300) continue;
      const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
      const sign = theta >= 0 ? 1 : -1;
      const t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      const j = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      j[p][p] = c; j[q][q] = c; j[p][q] = s; j[q][p] = -s;
      m = mat3mul(mat3mul(transpose3(j), m), j);
      v = mat3mul(v, j);
    }
  }

  return [
    normalize(v3(v[0][0], v[1][0], v[2][0])),
    normalize(v3(v[0][1], v[1][1], v[2][1])),
    normalize(v3(v[0][2], v[1][2], v[2][2])),
  ].filter((a) => lengthSq(a) > 0.5);
}

function mat3mul(a: number[][], b: number[][]): number[][] {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 3; k++) {
      const aik = a[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < 3; j++) out[i][j] += aik * b[k][j];
    }
  }
  return out;
}

function transpose3(a: number[][]): number[][] {
  return [
    [a[0][0], a[1][0], a[2][0]],
    [a[0][1], a[1][1], a[2][1]],
    [a[0][2], a[1][2], a[2][2]],
  ];
}

function extents(points: readonly Vec3[], f: Frame): { min: Vec3; max: Vec3 } {
  let minU = Infinity, minV = Infinity, minW = Infinity;
  let maxU = -Infinity, maxV = -Infinity, maxW = -Infinity;
  for (const p of points) {
    const a = dot(p, f.u);
    const b = dot(p, f.v);
    const c = dot(p, f.w);
    if (a < minU) minU = a;
    if (a > maxU) maxU = a;
    if (b < minV) minV = b;
    if (b > maxV) maxV = b;
    if (c < minW) minW = c;
    if (c > maxW) maxW = c;
  }
  return { min: v3(minU, minV, minW), max: v3(maxU, maxV, maxW) };
}

/** Construye la pieza a partir de su nube de puntos. */
export function measureShape(shape: Shape, faces: Id[] = []): Member | null {
  const box = orientedBox(shape);
  if (!box) return null;
  const { frame, min, max } = box;

  const sizes: Array<{ size: number; dir: Vec3 }> = [
    { size: max.x - min.x, dir: frame.u },
    { size: max.y - min.y, dir: frame.v },
    { size: max.z - min.z, dir: frame.w },
  ];
  sizes.sort((a, b) => b.size - a.size);

  const centreLocal = v3((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
  const centre = add(
    add(mul(frame.u, centreLocal.x), mul(frame.v, centreLocal.y)),
    mul(frame.w, centreLocal.z),
  );

  const axis = sizes[0].dir;
  const widthDir = sizes[1].dir;
  // El grueso es la medida menor; su dirección es la normal de la cara ancha.
  const faceNormal = sizes[2].dir;
  const half = sizes[0].size / 2;

  return {
    faces,
    centre,
    axis,
    widthDir,
    faceNormal,
    length: sizes[0].size,
    width: sizes[1].size,
    thickness: sizes[2].size,
    ends: [addScaled(centre, axis, -half), addScaled(centre, axis, half)],
    boxVolume: sizes[0].size * sizes[1].size * sizes[2].size,
  };
}

/** Pieza formada por un conjunto de caras. */
export function measureMember(geo: Geometry, faces: Iterable<Id>): Member | null {
  const list = [...faces];
  if (list.length === 0) return null;
  return measureShape(shapeOfFaces(geo, list), list);
}

/** Pieza formada por un grupo o componente. */
export function measureInstance(model: Model, geo: Geometry, instanceId: Id): Member | null {
  const shape = shapeOfInstance(model, geo, instanceId);
  return shape ? measureShape(shape) : null;
}

// ---------------------------------------------------------------------------
// Escuadrías nominales
// ---------------------------------------------------------------------------

/**
 * Escuadrías comerciales de madera: medida real en pulgadas → nominal.
 * Un "2×4" mide de verdad 1½″ × 3½″, y llamarlo por su nombre es lo que
 * espera quien está montando una estructura.
 */
const NOMINAL_INCHES: Array<[actual: number, nominal: number]> = [
  [0.75, 1], [1.5, 2], [2.5, 3], [3.5, 4], [4.5, 5],
  [5.5, 6], [7.25, 8], [9.25, 10], [11.25, 12],
];

function nominalOf(inches: number): number | null {
  for (const [actual, nominal] of NOMINAL_INCHES) {
    if (Math.abs(inches - actual) <= 1 / 32) return nominal;
  }
  return null;
}

/**
 * Nombre comercial de la sección de una pieza, o null si no corresponde a
 * ninguna escuadría conocida. `thickness` y `width` van en metros.
 */
export function nominalSection(thickness: number, width: number): string | null {
  const t = nominalOf(thickness / METERS_PER.in);
  const w = nominalOf(width / METERS_PER.in);
  if (t === null || w === null) return null;
  const a = Math.min(t, w);
  const b = Math.max(t, w);
  return `${a}×${b}`;
}

// ---------------------------------------------------------------------------
// Uniones
// ---------------------------------------------------------------------------

export type JointKind = 'esquina' | 'te' | 'cruce' | 'prolongación' | 'suelto';

/** Dos piezas por debajo de este ángulo se consideran paralelas (0,1°). */
const PARALLEL_LIMIT = (0.1 * Math.PI) / 180;

export interface MemberCut extends CutAngles {
  /** Dirección de la pieza saliendo del nudo, unitaria. */
  outward: Vec3;
  /** Testa que se corta. */
  end: Vec3;
  /**
   * Cómo se obtiene el corte:
   *  - `inglete`: las dos piezas se cortan por la bisectriz;
   *  - `tope`: esta pieza se corta contra la cara de la otra;
   *  - `escuadra`: corte perpendicular al eje.
   */
  style: 'inglete' | 'tope' | 'escuadra';
}

export interface JointReport {
  /** Ángulo de la unión: el que forman las dos piezas por dentro del nudo. */
  angle: number;
  /** Su suplementario, que es como se lee la unión por fuera. */
  supplement: number;
  /** Ángulo agudo entre los ejes, sin depender del sentido. */
  axisAngle: number;
  /** Nudo: punto donde se cruzan (o más se acercan) los dos ejes. */
  point: Vec3;
  /** Separación entre los ejes en el nudo: 0 si se cortan de verdad. */
  gap: number;
  /** true si las caras anchas de las dos piezas están en el mismo plano. */
  sameFacePlane: boolean;
  /** true si los ejes son paralelos. */
  parallel: boolean;
  kind: JointKind;
  /**
   * Corte de cada pieza, o null si esa pieza no se corta: la que pasa de largo
   * en una unión en te, y las dos en un cruce. Publicar un inglete donde no hay
   * corte sería inventar un número.
   */
  cuts: [MemberCut | null, MemberCut | null];
  /** Direcciones con las que se ha medido el ángulo. */
  directions: [Vec3, Vec3];
}

/**
 * Analiza la unión entre dos piezas: dónde se encuentran, con qué ángulo y con
 * qué corte hay que rematar cada una.
 *
 * El nudo es el punto en que más se acercan los dos ejes. Desde él, cada pieza
 * "sale" hacia su propio cuerpo; el ángulo de la unión es el que forman esas
 * dos direcciones salientes y el plano de inglete es su bisectriz.
 */
export function analyseJoint(a: Member, b: Member): JointReport {
  const near = closestPointsSegmentSegment(a.ends[0], a.ends[1], b.ends[0], b.ends[1]);
  const point = mul(add(near.p1, near.p2), 0.5);
  const axisAngle = lineAngle(a.axis, b.axis);
  const parallel = near.parallel || axisAngle <= PARALLEL_LIMIT;

  const outA = outwardFrom(a, point);
  const outB = outwardFrom(b, point);

  // Direcciones con las que se mide el ángulo.
  //
  // Cuando las dos piezas terminan en el nudo, sus direcciones salientes son
  // las buenas y no hay ambigüedad. Pero una pieza que PASA de largo se aleja
  // del nudo por sus dos lados, y tomar "el lado del extremo más cercano"
  // hacía que el ángulo saltara de 60° a 120° según en qué mitad cayera el
  // nudo. Para esos casos se elige el sentido que da el ángulo agudo, que es
  // una definición estable; el suplementario va aparte, como siempre.
  let dirA = outA.dir;
  let dirB = outB.dir;
  if (!outA.atEnd && !outB.atEnd) {
    dirA = a.axis;
    dirB = towards(b.axis, dirA);
  } else if (!outA.atEnd) {
    dirA = towards(a.axis, dirB);
  } else if (!outB.atEnd) {
    dirB = towards(b.axis, dirA);
  }
  const angle = angleBetween(dirA, dirB);

  const reach = 0.25 * (Math.hypot(a.width, a.thickness) + Math.hypot(b.width, b.thickness));
  const kind: JointKind = parallel
    ? (isSplice(a, b, near.dist, reach) ? 'prolongación' : 'suelto')
    : outA.atEnd && outB.atEnd ? 'esquina'
      : outA.atEnd || outB.atEnd ? 'te'
        : 'cruce';

  // Normal de referencia de cada pieza. En una sección cuadrada —un 4×4— cuál
  // es "la cara ancha" es arbitrario, así que se elige la que mejor describe el
  // plano de la unión; si no, el inglete y el bisel salen intercambiados.
  const jointNormal = commonPlaneNormal(dirA, dirB);
  const nA = referenceNormal(a, jointNormal);
  const nB = referenceNormal(b, jointNormal);

  let cutA: MemberCut | null = null;
  let cutB: MemberCut | null = null;

  if (kind === 'esquina' || kind === 'prolongación') {
    // Las dos se cortan por la bisectriz.
    const m = miterPlaneNormal(dirA, dirB) ?? dirA;
    const style = kind === 'prolongación' ? 'escuadra' : 'inglete';
    cutA = { ...cutAngles(m, { axis: dirA, faceNormal: nA }), outward: dirA, end: outA.end, style };
    cutB = { ...cutAngles(m, { axis: dirB, faceNormal: nB }), outward: dirB, end: outB.end, style };
  } else if (kind === 'te') {
    // Sólo se corta la que termina, y se corta a tope contra la cara de la otra.
    if (outB.atEnd) cutB = buttCut(nB, dirB, outB.end, a);
    else cutA = buttCut(nA, dirA, outA.end, b);
  }

  return {
    angle,
    supplement: Math.PI - angle,
    axisAngle,
    point,
    gap: near.dist,
    sameFacePlane: facesCoplanar(a, b, nA, nB),
    parallel,
    kind,
    cuts: [cutA, cutB],
    directions: [dirA, dirB],
  };
}

/**
 * ¿Son dos piezas paralelas un EMPALME, o simplemente van juntas?
 *
 * Lo que hace un empalme no es que sus ejes estén cerca, sino que una termine
 * donde la otra empieza. Dos tablas apiladas tienen los ejes a un grueso de
 * distancia y no se empalman: se solapan de punta a punta.
 */
function isSplice(a: Member, b: Member, gap: number, reach: number): boolean {
  if (gap > reach) return false;
  const u = a.axis;
  const span = (m: Member): [number, number] => {
    const t0 = dot(m.ends[0], u);
    const t1 = dot(m.ends[1], u);
    return t0 <= t1 ? [t0, t1] : [t1, t0];
  };
  const [a0, a1] = span(a);
  const [b0, b1] = span(b);
  const overlap = Math.min(a1, b1) - Math.max(a0, b0);
  // Se tolera un pelo de solape (el que deja el dibujo), no un tramo entero.
  return overlap <= 0.05 * Math.min(a.length, b.length);
}

/** El sentido de `axis` que forma ángulo agudo con `ref`. */
function towards(axis: Vec3, ref: Vec3): Vec3 {
  return dot(axis, ref) >= 0 ? axis : mul(axis, -1);
}

/**
 * Corte a tope: la pieza que termina se recorta contra la cara de la otra por
 * la que entra, que es la dirección de la sección de esa otra pieza más
 * alineada con la llegada.
 */
function buttCut(
  branchNormal: Vec3,
  outward: Vec3,
  end: Vec3,
  through: Member,
): MemberCut {
  let best = through.faceNormal;
  let bestDot = Math.abs(dot(through.faceNormal, outward));
  const alt = Math.abs(dot(through.widthDir, outward));
  if (alt > bestDot) {
    best = through.widthDir;
    bestDot = alt;
  }
  return {
    ...cutAngles(best, { axis: outward, faceNormal: branchNormal }),
    outward,
    end,
    style: 'tope',
  };
}

/** Normal de la cara de referencia, desambiguada si la sección es cuadrada. */
function referenceNormal(m: Member, jointNormal: Vec3 | null): Vec3 {
  const biggest = Math.max(m.width, m.thickness, 1e-12);
  const square = Math.abs(m.width - m.thickness) <= biggest * 0.01;
  if (!square || !jointNormal) return m.faceNormal;
  return Math.abs(dot(m.widthDir, jointNormal)) > Math.abs(dot(m.faceNormal, jointNormal))
    ? m.widthDir
    : m.faceNormal;
}

/**
 * ¿Están las caras de referencia de las dos piezas en el MISMO plano? No basta
 * con que sus normales sean paralelas: dos tablas apiladas también lo cumplen y
 * su unión sí necesita bisel.
 */
function facesCoplanar(a: Member, b: Member, nA: Vec3, nB: Vec3): boolean {
  if (Math.abs(dot(nA, nB)) <= 1 - 1e-6) return false;
  const offset = Math.abs(dot(nA, sub(a.centre, b.centre)));
  return offset <= 0.25 * (a.thickness + b.thickness) + 1e-9;
}

/**
 * Dirección en la que la pieza se aleja del nudo, y si el nudo cae en una de
 * sus testas.
 *
 * La tolerancia es la propia sección: un nudo a menos de media escuadría del
 * extremo es un remate. No puede depender del largo —en una viga de diez
 * metros, un nudo a veinte centímetros del extremo es media luz, no un
 * remate—, pero sí se acota a un cuarto de la pieza para que en un taco muy
 * corto no sea "testa" cualquier punto.
 */
function outwardFrom(m: Member, joint: Vec3): { dir: Vec3; atEnd: boolean; end: Vec3 } {
  const d0 = distance(joint, m.ends[0]);
  const d1 = distance(joint, m.ends[1]);
  const nearest = d0 <= d1 ? 0 : 1;
  // Una escuadría completa: en una esquina donde las dos piezas se solapan, el
  // nudo de los ejes queda apartado del extremo hasta media sección de cada una.
  const tolerance = Math.min(Math.hypot(m.width, m.thickness), m.length * 0.25);
  const atEnd = Math.min(d0, d1) <= tolerance;

  // Hacia el cuerpo de la pieza: desde el extremo próximo hacia el otro.
  const toBody = sub(m.ends[1 - nearest], m.ends[nearest]);
  const s = dot(toBody, m.axis);
  const dir = s >= 0 ? m.axis : mul(m.axis, -1);
  return { dir, atEnd, end: m.ends[nearest] };
}

/**
 * Comprueba si dos piezas se tocan o se cruzan, comparando la distancia entre
 * sus ejes con las medias secciones. Es una prueba barata, pensada para decidir
 * si merece la pena intentar unirlas.
 */
export function membersTouch(a: Member, b: Member): boolean {
  const near = closestPointsSegmentSegment(a.ends[0], a.ends[1], b.ends[0], b.ends[1]);
  const reach = 0.5 * (Math.hypot(a.width, a.thickness) + Math.hypot(b.width, b.thickness));
  return near.dist <= reach;
}

/** Volumen real de un conjunto de caras cerradas (para comparar con la caja). */
export function facesVolume(geo: Geometry, faces: Iterable<Id>): number {
  let vol = 0;
  for (const fid of faces) {
    const t = triangulateFace(geo, fid);
    if (!t) continue;
    for (let i = 0; i < t.indices.length; i += 3) {
      const p = t.positions[t.indices[i]];
      const q = t.positions[t.indices[i + 1]];
      const r = t.positions[t.indices[i + 2]];
      vol += dot(p, cross(q, r)) / 6;
    }
  }
  return Math.abs(vol);
}
