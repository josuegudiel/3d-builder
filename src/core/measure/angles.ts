import {
  Vec3, sub, mul, dot, cross, normalize, length, lengthSq, angleBetween, signedAngle,
} from '../math/vec';
import { Plane } from '../math/plane';
import { Geometry } from '../model/geometry';
import { Id } from '../model/types';
import { isOrientedShell, faceComponent } from '../topology/orient';

/**
 * Sistema de ángulos.
 *
 * Todo se mide en RADIANES y se convierte a grados sólo al escribir texto, igual
 * que las longitudes se guardan en metros y se formatean al final. Las funciones
 * de este archivo no tocan la topología: reciben vectores o entidades y
 * devuelven números, de modo que se pueden comprobar una por una.
 *
 * Convenios:
 *
 *  - `angleBetween` (en math/vec) da el ángulo entre dos VECTORES: 0…180°, y
 *    distingue el sentido, de forma que ⟨1,0,0⟩ y ⟨−1,0,0⟩ forman 180°.
 *  - `lineAngle` da el ángulo entre dos RECTAS: 0…90°, porque una recta no
 *    tiene sentido y 170° y 10° describen la misma pareja de rectas.
 *  - El diedro de una arista se mide POR DENTRO del material: 90° en el canto
 *    de una caja, 270° en un rincón entrante, 180° si las dos caras siguen.
 */

export const RAD_TO_DEG = 180 / Math.PI;
export const DEG_TO_RAD = Math.PI / 180;

export function toDegrees(radians: number): number {
  return radians * RAD_TO_DEG;
}

export function toRadians(degrees: number): number {
  return degrees * DEG_TO_RAD;
}

/** Ángulo agudo entre dos rectas, 0…π/2. El sentido de los vectores da igual. */
export function lineAngle(a: Vec3, b: Vec3): number {
  const ang = angleBetween(a, b);
  return ang > Math.PI / 2 ? Math.PI - ang : ang;
}

/**
 * Ángulo entre una recta y un plano, 0…π/2.
 * Es el complementario del ángulo que forma la recta con la normal.
 */
export function linePlaneAngle(dir: Vec3, planeNormal: Vec3): number {
  return Math.PI / 2 - lineAngle(dir, planeNormal);
}

/** Ángulo agudo entre dos planos, 0…π/2 (el que forman sus normales). */
export function planeAngle(a: Plane, b: Plane): number {
  return lineAngle(a.n, b.n);
}

/**
 * Ángulo entre dos caras medido con signo alrededor de una arista común: es el
 * mismo valor que `dihedralAngle`, pero expuesto para vectores sueltos.
 *
 * `n1` y `n2` son las normales EXTERIORES y `d1` el sentido en que la primera
 * cara recorre la arista. El resultado está en (0, 2π).
 */
export function dihedralFromNormals(n1: Vec3, n2: Vec3, d1: Vec3): number {
  const raw = Math.PI - signedAngle(n1, n2, d1);
  return wrapTurn(raw);
}

/** Lleva un ángulo al intervalo [0, 2π). */
export function wrapTurn(a: number): number {
  const twoPi = Math.PI * 2;
  let x = a % twoPi;
  if (x < 0) x += twoPi;
  return x;
}

/** Sentido real (vector 3D) con el que una cara recorre una de sus aristas. */
export function faceEdgeDirection(geo: Geometry, faceId: Id, edgeId: Id): Vec3 | null {
  const f = geo.faces.get(faceId);
  const e = geo.edges.get(edgeId);
  if (!f || !e) return null;
  for (const loop of f.loops) {
    for (let i = 0; i < loop.edges.length; i++) {
      if (loop.edges[i] !== edgeId) continue;
      const from = loop.dirs[i] ? e.a : e.b;
      const to = loop.dirs[i] ? e.b : e.a;
      const d = sub(geo.vertexPos(to), geo.vertexPos(from));
      return lengthSq(d) > 0 ? normalize(d) : null;
    }
  }
  return null;
}

export interface DihedralResult {
  /** Ángulo en radianes. Interior (0…360°) si hay material; si no, 0…180°. */
  angle: number;
  /** Las dos caras que comparten la arista. */
  faces: [Id, Id];
  /** false si las dos caras recorren la arista en el mismo sentido. */
  consistent: boolean;
  /**
   * true si las caras pertenecen a una cáscara cerrada y bien orientada, que
   * es cuando existe un "dentro" y el ángulo puede pasar de 180°.
   */
  solid: boolean;
}

/**
 * Ángulo diedro de una arista compartida por exactamente dos caras.
 *
 * Cuando las caras forman parte de un SÓLIDO cerrado se mide a través del
 * material y la lectura llega hasta 360°: el canto de una caja da 90°, dos
 * caras que continúan dan 180° y un rincón entrante da 270°.
 *
 * Cuando son caras sueltas no hay "dentro" que medir: 90° y 270° describirían
 * el mismo pliegue, y cuál de los dos sale dependería sólo del sentido en que
 * se dibujó cada polígono. En ese caso se devuelve el ángulo que no pasa de
 * 180°, que es el único dato que la geometría respalda.
 *
 * Devuelve null si la arista no tiene exactamente dos caras.
 */
export function dihedralAngle(geo: Geometry, edgeId: Id): DihedralResult | null {
  const users = [...(geo.edgeFaces.get(edgeId) ?? [])];
  if (users.length !== 2) return null;
  const [f1, f2] = users;
  const a = geo.faces.get(f1);
  const b = geo.faces.get(f2);
  if (!a || !b) return null;

  const d1 = faceEdgeDirection(geo, f1, edgeId);
  const d2 = faceEdgeDirection(geo, f2, edgeId);
  if (!d1 || !d2) return null;

  // Dos caras coherentes recorren la arista en sentidos opuestos. Si no lo son,
  // se calcula como si la segunda estuviera invertida.
  const consistent = dot(d1, d2) < 0;
  const n2 = consistent ? b.plane.n : mul(b.plane.n, -1);

  let angle = dihedralFromNormals(a.plane.n, n2, d1);
  const solid = isOrientedShell(geo, faceComponent(geo, f1));
  if (!solid) angle = Math.min(angle, Math.PI * 2 - angle);

  return { angle, faces: [f1, f2], consistent, solid };
}

export interface VertexAngle {
  /** Ángulo entre las dos aristas, 0…π. */
  angle: number;
  /** Vértice común. */
  vertex: Id;
  /** Direcciones salientes desde el vértice. */
  dirs: [Vec3, Vec3];
}

/** Ángulo entre dos aristas que comparten un vértice. */
export function angleBetweenEdges(geo: Geometry, edgeA: Id, edgeB: Id): VertexAngle | null {
  const a = geo.edges.get(edgeA);
  const b = geo.edges.get(edgeB);
  if (!a || !b || edgeA === edgeB) return null;

  let shared: Id | null = null;
  for (const v of [a.a, a.b]) {
    if (v === b.a || v === b.b) shared = v;
  }
  if (shared === null) return null;

  const pv = geo.vertexPos(shared);
  const da = sub(geo.vertexPos(a.a === shared ? a.b : a.a), pv);
  const db = sub(geo.vertexPos(b.a === shared ? b.b : b.a), pv);
  if (lengthSq(da) <= 0 || lengthSq(db) <= 0) return null;

  return {
    angle: angleBetween(da, db),
    vertex: shared,
    dirs: [normalize(da), normalize(db)],
  };
}

/**
 * Ángulo entre dos aristas cualesquiera, compartan vértice o no. Si no se
 * cortan se mide entre sus direcciones, que es lo que interesa para saber si
 * dos piezas son paralelas o a escuadra.
 */
export function edgeDirectionAngle(geo: Geometry, edgeA: Id, edgeB: Id): number | null {
  const a = geo.edges.get(edgeA);
  const b = geo.edges.get(edgeB);
  if (!a || !b) return null;
  const da = sub(geo.vertexPos(a.b), geo.vertexPos(a.a));
  const db = sub(geo.vertexPos(b.b), geo.vertexPos(b.a));
  if (lengthSq(da) <= 0 || lengthSq(db) <= 0) return null;
  return lineAngle(da, db);
}

// ---------------------------------------------------------------------------
// Cortes: inglete y bisel
// ---------------------------------------------------------------------------

/**
 * Marco local de una pieza para expresar un corte.
 *
 *  - `axis`: dirección larga de la pieza.
 *  - `faceNormal`: normal de la cara de referencia (la que apoya en la mesa de
 *    la sierra). No hace falta que sea exactamente perpendicular al eje: se
 *    ortonormaliza.
 */
export interface CutFrame {
  axis: Vec3;
  faceNormal: Vec3;
}

export interface CutAngles {
  /**
   * Inglete: giro de la hoja alrededor de la normal de la cara. 0 = corte a
   * escuadra. Con signo: indica hacia qué lado gira.
   */
  miter: number;
  /**
   * Bisel: inclinación de la hoja. 0 = corte perpendicular a la cara ancha.
   * Con signo, por el mismo motivo que el inglete.
   */
  bevel: number;
  /**
   * Ángulo entre el plano de corte y el eje de la pieza, 0…π/2. Es el que se
   * lee con una falsa escuadra apoyada en el canto: 90° en un corte a escuadra.
   */
  toAxis: number;
  /** true si el corte es compuesto (inglete y bisel a la vez). */
  compound: boolean;
}

const SQUARE_CUT: CutAngles = { miter: 0, bevel: 0, toAxis: Math.PI / 2, compound: false };

/**
 * Descompone un plano de corte en los dos ajustes de una sierra de inglete.
 *
 * Partiendo de un corte a escuadra (normal del plano = eje de la pieza), la
 * hoja gira un ángulo `miter` alrededor de la normal de la cara y se inclina
 * `bevel` alrededor del ancho de la pieza:
 *
 *     m = R_z(miter) · R_y(bevel) · x
 *
 * con x = eje, z = normal de la cara, y = z × x. Invirtiendo esa expresión se
 * obtienen los dos ajustes, que es exactamente lo que se marca en la sierra.
 */
export function cutAngles(cutNormal: Vec3, frame: CutFrame): CutAngles {
  const x = normalize(frame.axis);
  if (lengthSq(x) <= 0) return { ...SQUARE_CUT };

  // Ortonormalizar la normal de la cara respecto del eje.
  let z = sub(frame.faceNormal, mul(x, dot(frame.faceNormal, x)));
  if (lengthSq(z) <= 1e-24) {
    // La cara de referencia es perpendicular al eje: no hay marco válido, se
    // elige uno cualquiera para que el inglete siga siendo medible.
    z = normalize(cross(x, Math.abs(x.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 }));
  } else {
    z = normalize(z);
  }
  const y = cross(z, x);

  const m = normalize(cutNormal);
  if (lengthSq(m) <= 0) return { ...SQUARE_CUT };

  let mx = dot(m, x);
  let my = dot(m, y);
  let mz = dot(m, z);
  // Un plano y su opuesto son el mismo plano: se elige el sentido que mira
  // hacia el extremo de la pieza para que los ajustes queden en ±90°. Si el
  // plano es paralelo al eje (mx = 0) hay que desempatar con las otras dos
  // componentes, o el mismo plano daría ajustes opuestos según cómo se
  // escribiera su normal.
  const flip = mx < -1e-12
    || (Math.abs(mx) <= 1e-12 && (my < -1e-12 || (Math.abs(my) <= 1e-12 && mz < 0)));
  if (flip) {
    mx = -mx;
    my = -my;
    mz = -mz;
  }

  const miter = Math.atan2(my, mx);
  const bevel = Math.atan2(-mz, Math.hypot(mx, my));
  const toAxis = Math.asin(Math.min(1, Math.abs(mx)));

  return {
    miter,
    bevel,
    toAxis,
    compound: Math.abs(miter) > 1e-9 && Math.abs(bevel) > 1e-9,
  };
}

/**
 * Normal del plano de corte a inglete entre dos piezas.
 *
 * `u` y `v` son las direcciones de cada pieza SALIENDO del nudo. El plano que
 * bisecta el ángulo tiene por normal la diferencia de las dos direcciones
 * unitarias: para una esquina de 90° sale el clásico corte a 45°, y para dos
 * piezas alineadas (180°) sale un corte a escuadra.
 *
 * Devuelve null si las dos direcciones coinciden, en cuyo caso no hay unión.
 */
export function miterPlaneNormal(u: Vec3, v: Vec3): Vec3 | null {
  const a = normalize(u);
  const b = normalize(v);
  const n = sub(a, b);
  if (lengthSq(n) <= 1e-18) return null;
  return normalize(n);
}

/**
 * Ángulo de la unión: el que forman las dos piezas medido por dentro del nudo,
 * con las direcciones saliendo de él. Una esquina en escuadra da 90°.
 */
export function jointAngle(u: Vec3, v: Vec3): number {
  return angleBetween(u, v);
}

/**
 * Ajuste de inglete de una sierra para una unión simple entre piezas planas:
 * 90° − γ/2, donde γ es el ángulo de la unión. Es un caso particular de
 * `cutAngles`, y se conserva porque es la cuenta que hace un carpintero.
 */
export function miterSetting(jointRadians: number): number {
  return Math.PI / 2 - jointRadians / 2;
}

/** Normal de la cara ancha implícita de dos piezas que están en un mismo plano. */
export function commonPlaneNormal(u: Vec3, v: Vec3): Vec3 | null {
  const n = cross(u, v);
  return length(n) <= 1e-12 ? null : normalize(n);
}
