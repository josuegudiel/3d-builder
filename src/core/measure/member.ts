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
import { CutAngles, cutAngles, lineAngle, miterPlaneNormal } from './angles';
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
}

/** Puntos y normales de un conjunto de caras de una geometría. */
export function shapeOfFaces(geo: Geometry, faces: Iterable<Id>): Shape {
  const points: Vec3[] = [];
  const normals: Array<{ n: Vec3; area: number }> = [];
  const seen = new Set<Id>();
  for (const fid of faces) {
    const f = geo.faces.get(fid);
    if (!f) continue;
    normals.push({ n: f.plane.n, area: faceArea(geo, fid) });
    for (const v of geo.faceVertices(fid)) {
      if (seen.has(v)) continue;
      seen.add(v);
      points.push(geo.vertexPos(v));
    }
  }
  return { points, normals };
}

/** Puntos y normales de una instancia, ya transformados al espacio contenedor. */
export function shapeOfInstance(model: Model, geo: Geometry, instanceId: Id): Shape | null {
  const inst = geo.instances.get(instanceId);
  if (!inst) return null;
  const out: Shape = { points: [], normals: [] };
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
 * Caja envolvente orientada de una nube de puntos, probando los marcos que
 * definen las propias normales de las caras y quedándose con el de menor
 * volumen. Para un prisma recto el mínimo es exacto: sus caras ya dan las tres
 * direcciones. Para una pieza redonda (un poste torneado) da una caja ajustada,
 * que es lo mejor que se puede decir sin más información.
 */
function orientedBox(shape: Shape): { frame: Frame; min: Vec3; max: Vec3 } | null {
  if (shape.points.length < 2) return null;

  // Direcciones candidatas: normales distintas, las de mayor área primero.
  const dirs: Vec3[] = [];
  const ordered = [...shape.normals].sort((a, b) => b.area - a.area);
  for (const { n } of ordered) {
    if (lengthSq(n) <= 0) continue;
    let dup = false;
    for (const d of dirs) {
      if (Math.abs(dot(d, n)) > 1 - 1e-9) {
        dup = true;
        break;
      }
    }
    if (!dup) dirs.push(normalize(n));
    if (dirs.length >= 16) break;
  }
  // Siempre se prueban también los ejes globales: si la pieza no tiene caras
  // (sólo aristas) o es redonda, este marco sigue dando un resultado útil.
  dirs.push(v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1));

  let best: { frame: Frame; min: Vec3; max: Vec3; vol: number } | null = null;
  for (let i = 0; i < dirs.length; i++) {
    for (let j = 0; j < dirs.length; j++) {
      if (i === j) continue;
      if (Math.abs(dot(dirs[i], dirs[j])) > 1e-6) continue;
      const u = dirs[i];
      const v = normalize(sub(dirs[j], mul(u, dot(dirs[j], u))));
      if (lengthSq(v) <= 0) continue;
      const w = cross(u, v);
      const frame: Frame = { u, v, w };
      const ext = extents(shape.points, frame);
      const vol = (ext.max.x - ext.min.x) * (ext.max.y - ext.min.y) * (ext.max.z - ext.min.z);
      if (!best || vol < best.vol - 1e-15) best = { frame, min: ext.min, max: ext.max, vol };
    }
  }
  if (best) return { frame: best.frame, min: best.min, max: best.max };

  // Ningún par perpendicular: caja alineada con los ejes globales.
  const frame: Frame = { u: v3(1, 0, 0), v: v3(0, 1, 0), w: v3(0, 0, 1) };
  const ext = extents(shape.points, frame);
  return { frame, min: ext.min, max: ext.max };
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

export interface MemberCut extends CutAngles {
  /** Dirección de la pieza saliendo del nudo, unitaria. */
  outward: Vec3;
  /** Testa que se corta, o null si el nudo no cae en un extremo. */
  end: Vec3 | null;
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
  /** true si las dos piezas apoyan en el mismo plano (inglete sin bisel). */
  sameFacePlane: boolean;
  /** true si los ejes son paralelos. */
  parallel: boolean;
  kind: JointKind;
  /** Corte de cada pieza, en el mismo orden en que se pasaron. */
  cuts: [MemberCut, MemberCut];
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
  const parallel = near.parallel || lineAngle(a.axis, b.axis) <= 1e-6;

  const outA = outwardFrom(a, point);
  const outB = outwardFrom(b, point);

  const angle = angleBetween(outA.dir, outB.dir);
  const axisAngle = lineAngle(a.axis, b.axis);

  const kind: JointKind = parallel
    ? (outA.atEnd && outB.atEnd ? 'prolongación' : 'suelto')
    : outA.atEnd && outB.atEnd ? 'esquina'
      : outA.atEnd || outB.atEnd ? 'te'
        : 'cruce';

  const sameFacePlane = Math.abs(dot(a.faceNormal, b.faceNormal)) > 1 - 1e-6;

  // Plano de inglete: bisectriz de las dos direcciones salientes. Si las piezas
  // están alineadas no hay bisectriz posible y el corte es a escuadra.
  const m = miterPlaneNormal(outA.dir, outB.dir) ?? outA.dir;

  const cutA: MemberCut = {
    ...cutAngles(m, { axis: outA.dir, faceNormal: a.faceNormal }),
    outward: outA.dir,
    end: outA.atEnd ? outA.end : null,
  };
  const cutB: MemberCut = {
    ...cutAngles(m, { axis: outB.dir, faceNormal: b.faceNormal }),
    outward: outB.dir,
    end: outB.atEnd ? outB.end : null,
  };

  return {
    angle,
    supplement: Math.PI - angle,
    axisAngle,
    point,
    gap: near.dist,
    sameFacePlane,
    parallel,
    kind,
    cuts: [cutA, cutB],
  };
}

/**
 * Dirección en la que la pieza se aleja del nudo, y si el nudo cae en una de
 * sus testas. La tolerancia es la propia sección de la pieza: un nudo a menos
 * de media escuadría del extremo es un remate, no un cruce.
 */
function outwardFrom(m: Member, joint: Vec3): { dir: Vec3; atEnd: boolean; end: Vec3 } {
  const d0 = distance(joint, m.ends[0]);
  const d1 = distance(joint, m.ends[1]);
  const nearest = d0 <= d1 ? 0 : 1;
  const tolerance = 0.5 * Math.hypot(m.width, m.thickness) + m.length * 0.02;
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
