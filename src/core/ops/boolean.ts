import { Geometry } from '../model/geometry';
import { Model, Definition } from '../model/model';
import { Id, Loop } from '../model/types';
import {
  Vec3, v3, sub, cross, dot, normalize, lengthSq, addScaled,
} from '../math/vec';
import { Mat4, IDENTITY, matMul, transformPoint } from '../math/mat';
import {
  Plane, planeFromPolygon, planeTransform, planeKey, planeCanonical, planeEquals,
} from '../math/plane';
import { Box3, emptyBox, expandBox, boxDiagonal, boxIsEmpty } from '../math/geom';
import { EPS } from '../math/tolerance';
import { triangulateFace } from '../topology/triangulate';
import { rebuildFaces } from '../topology/rebuild';
import { orientFacesConsistently, flipFace, isSolid } from '../topology/orient';
import { intersectFaceSets, planesOfFaces } from './intersect';
import { Member, measureInstance, analyseJoint, JointReport } from '../measure/member';

/**
 * Operaciones booleanas entre sólidos: unir, restar e intersecar.
 *
 * El método es el clásico de "partir y clasificar", que es el único que da
 * resultados correctos sin casos especiales:
 *
 *  1. Se insertan las aristas de intersección, de modo que ninguna cara queda
 *     partida por la mitad por la otra pieza.
 *  2. Se reconstruyen las caras de todos los planos implicados.
 *  3. Cada trozo de superficie resultante se clasifica MIRANDO SUS DOS LADOS:
 *     se toma un punto interior y se mira si el material está dentro o fuera
 *     del resultado un pelo por encima y un pelo por debajo. Un trozo pertenece
 *     a la superficie del resultado si, y sólo si, sus dos lados son distintos.
 *     Además, ese mismo dato dice hacia dónde debe mirar la cara: siempre hacia
 *     el lado que queda fuera.
 *
 * Esa regla vale igual para las tres operaciones y resuelve sola los casos que
 * suelen dar problemas: caras que se apoyan una contra otra, piezas que sólo se
 * tocan por un canto y trozos de superficie que quedan encerrados.
 */

export type BooleanOp = 'union' | 'subtract' | 'intersect';

export const BOOLEAN_LABEL: Record<BooleanOp, string> = {
  union: 'Unir',
  subtract: 'Restar',
  intersect: 'Intersecar',
};

interface Tri {
  a: Vec3;
  b: Vec3;
  c: Vec3;
}

/**
 * Direcciones de disparo para la prueba de pertenencia. Ninguna es paralela a
 * un eje ni a una diagonal evidente, para que un rayo no recorra una cara
 * entera ni pase justo por una arista de la caja.
 */
const RAY_DIRECTIONS: Vec3[] = [
  normalize(v3(0.5773502692, 0.5773502692, 0.5773502692)),
  normalize(v3(-0.3517, 0.8241, 0.4437)),
  normalize(v3(0.7913, -0.2701, 0.5487)),
  normalize(v3(0.2129, 0.4517, -0.8663)),
  normalize(v3(-0.6301, -0.5119, 0.5839)),
  normalize(v3(0.9137, 0.3271, -0.2437)),
  normalize(v3(-0.4691, 0.1873, -0.8629)),
];

/**
 * ¿Está un punto dentro de un sólido? Se responde disparando un rayo y contando
 * cuántas veces atraviesa la cáscara: impar = dentro. Si un rayo pasa demasiado
 * cerca de una arista o de un vértice el recuento no es de fiar, así que esa
 * dirección se descarta y se prueba otra; el resultado se decide por mayoría
 * entre las direcciones limpias.
 */
export class SolidMembership {
  private readonly tris: Tri[] = [];
  private readonly box: Box3 = emptyBox();
  /** true si los triángulos forman una cáscara cerrada y bien orientada. */
  readonly closed: boolean;

  constructor(geo: Geometry, faces: Iterable<Id>) {
    for (const fid of faces) {
      const t = triangulateFace(geo, fid);
      if (!t) continue;
      for (let i = 0; i < t.indices.length; i += 3) {
        const a = t.positions[t.indices[i]];
        const b = t.positions[t.indices[i + 1]];
        const c = t.positions[t.indices[i + 2]];
        this.tris.push({ a, b, c });
        expandBox(this.box, a);
        expandBox(this.box, b);
        expandBox(this.box, c);
      }
    }
    this.closed = this.checkClosed();
  }

  get triangleCount(): number {
    return this.tris.length;
  }

  /**
   * Una malla cerrada y orientada recorre cada arista exactamente dos veces, una
   * en cada sentido. Comprobarlo sobre los triángulos, y no sobre las caras, es
   * independiente de que las dos piezas compartan aristas al juntarlas.
   */
  private checkClosed(): boolean {
    if (this.tris.length < 4) return false;
    const count = new Map<string, number>();
    const key = (p: Vec3, q: Vec3) => `${p.x},${p.y},${p.z}>${q.x},${q.y},${q.z}`;
    for (const t of this.tris) {
      for (const [p, q] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as Array<[Vec3, Vec3]>) {
        count.set(key(p, q), (count.get(key(p, q)) ?? 0) + 1);
      }
    }
    for (const [k, n] of count) {
      if (n !== 1) return false;
      const [from, to] = k.split('>');
      if ((count.get(`${to}>${from}`) ?? 0) !== 1) return false;
    }
    return true;
  }

  contains(p: Vec3): boolean {
    if (boxIsEmpty(this.box)) return false;
    if (p.x < this.box.min.x || p.x > this.box.max.x) return false;
    if (p.y < this.box.min.y || p.y > this.box.max.y) return false;
    if (p.z < this.box.min.z || p.z > this.box.max.z) return false;

    let yes = 0;
    let total = 0;
    for (const dir of RAY_DIRECTIONS) {
      const r = this.parity(p, dir);
      if (r === null) continue;
      total++;
      if (r) yes++;
      if (total >= 3) break;
    }
    if (total === 0) return this.parity(p, RAY_DIRECTIONS[0], true) ?? false;
    return yes * 2 > total;
  }

  /**
   * Paridad de los cortes del rayo con la cáscara, o null si alguna
   * intersección cae tan cerca del borde de un triángulo que no se puede
   * decidir de qué lado pasa.
   */
  private parity(origin: Vec3, dir: Vec3, force = false): boolean | null {
    let count = 0;
    for (const t of this.tris) {
      const h = rayTriangle(origin, dir, t);
      if (!h) continue;
      if (h.t <= 1e-12) continue;
      if (!force) {
        const w = 1 - h.u - h.v;
        if (h.u < 1e-9 || h.v < 1e-9 || w < 1e-9) return null;
      }
      count++;
    }
    return (count & 1) === 1;
  }
}

/** Möller–Trumbore con coordenadas baricéntricas, para medir la degeneración. */
function rayTriangle(
  origin: Vec3, dir: Vec3, t: Tri,
): { t: number; u: number; v: number } | null {
  const e1 = sub(t.b, t.a);
  const e2 = sub(t.c, t.a);
  const pv = cross(dir, e2);
  const det = dot(e1, pv);
  if (Math.abs(det) <= 1e-18) return null;
  const inv = 1 / det;
  const tv = sub(origin, t.a);
  const u = dot(tv, pv) * inv;
  if (u < 0 || u > 1) return null;
  const qv = cross(tv, e1);
  const v = dot(dir, qv) * inv;
  if (v < 0 || u + v > 1) return null;
  return { t: dot(e2, qv) * inv, u, v };
}

function memberOf(op: BooleanOp, a: boolean, b: boolean): boolean {
  switch (op) {
    case 'union': return a || b;
    case 'intersect': return a && b;
    case 'subtract': return a && !b;
  }
}

/** Punto estrictamente interior de una cara: centro de su mayor triángulo. */
export function interiorSample(geo: Geometry, faceId: Id): Vec3 | null {
  const t = triangulateFace(geo, faceId);
  if (!t) return null;
  let best: Vec3 | null = null;
  let bestArea = 0;
  for (let i = 0; i < t.indices.length; i += 3) {
    const a = t.positions[t.indices[i]];
    const b = t.positions[t.indices[i + 1]];
    const c = t.positions[t.indices[i + 2]];
    const area = lengthSq(cross(sub(b, a), sub(c, a)));
    if (area > bestArea) {
      bestArea = area;
      best = v3((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3);
    }
  }
  return bestArea > 0 ? best : null;
}

export interface BooleanResult {
  ok: boolean;
  message: string;
  /** Caras del resultado. */
  faces: Id[];
  /** true si el resultado vuelve a ser un sólido cerrado. */
  solid: boolean;
}

/**
 * Operación booleana entre dos conjuntos de caras de una MISMA geometría.
 *
 * Las dos entradas deben ser cáscaras cerradas. Sólo se tocan las caras que
 * están en los planos implicados: el resto de la geometría del contexto se
 * queda como está.
 */
export function booleanSolids(
  geo: Geometry,
  facesA: Iterable<Id>,
  facesB: Iterable<Id>,
  op: BooleanOp,
): BooleanResult {
  const A = [...facesA].filter((f) => geo.faces.has(f));
  const B = [...facesB].filter((f) => geo.faces.has(f));
  if (A.length === 0 || B.length === 0) {
    return { ok: false, message: 'Hacen falta dos sólidos.', faces: [], solid: false };
  }

  const memA = new SolidMembership(geo, A);
  const memB = new SolidMembership(geo, B);
  if (!memA.closed) {
    return { ok: false, message: 'La primera pieza no es un sólido cerrado.', faces: [], solid: false };
  }
  if (!memB.closed) {
    return { ok: false, message: 'La segunda pieza no es un sólido cerrado.', faces: [], solid: false };
  }

  // Caja común: fija el paso de muestreo y acota la limpieza posterior.
  let box = emptyBox();
  for (const fid of [...A, ...B]) {
    for (const v of geo.faceVertices(fid)) box = expandBox(box, geo.vertexPos(v));
  }
  const step = Math.min(1e-4, Math.max(1e-9, boxDiagonal(box) * 1e-5));

  const planes: Plane[] = [...planesOfFaces(geo, A), ...planesOfFaces(geo, B)];
  const planeKeys = new Set(planes.map((p) => planeKey(planeCanonical(p))));

  const ins = intersectFaceSets(geo, A, B);
  rebuildFaces(geo, planes, { newEdges: new Set(ins.edges) });

  const classify = (): Id[] => {
    const keep: Id[] = [];
    const drop: Id[] = [];
    for (const fid of [...geo.faces.keys()]) {
      const f = geo.faces.get(fid);
      if (!f) continue;
      if (!planeKeys.has(planeKey(planeCanonical(f.plane)))) continue;

      const p = interiorSample(geo, fid);
      if (!p) {
        drop.push(fid);
        continue;
      }
      const above = addScaled(p, f.plane.n, step);
      const below = addScaled(p, f.plane.n, -step);
      const inAbove = memberOf(op, memA.contains(above), memB.contains(above));
      const inBelow = memberOf(op, memA.contains(below), memB.contains(below));

      if (inAbove === inBelow) {
        drop.push(fid);
        continue;
      }
      // La cara frontal debe mirar al exterior del resultado.
      if (inAbove) flipFace(geo, fid);
      keep.push(fid);
    }
    for (const fid of drop) geo.removeFace(fid);
    cleanDangling(geo, box, step);
    return keep;
  };

  let keep = classify();

  // --- Limpieza de aristas sobrantes ---------------------------------------
  // Dos trozos de superficie coplanares que han quedado juntos son una sola
  // cara: la arista que los separa es un resto de la operación y no debe
  // quedarse ahí. Al quitarla se reconstruye el plano y se vuelve a clasificar,
  // porque reconstruir puede resucitar regiones que la operación había
  // descartado (el fondo de un rebaje, por ejemplo).
  const merged = removeCoplanarSeams(geo, keep);
  if (merged.length > 0) {
    const fresh = new Set<Id>();
    for (const plane of merged) {
      for (const e of geo.edgesOnPlane(plane)) fresh.add(e);
    }
    rebuildFaces(geo, merged, { newEdges: fresh });
    keep = classify();
  }

  orientFacesConsistently(geo, keep);

  const alive = keep.filter((f) => geo.faces.has(f));
  return {
    ok: alive.length > 0,
    message: alive.length > 0 ? '' : 'La operación no deja ninguna cara.',
    faces: alive,
    solid: isSolid(geo, alive),
  };
}

/**
 * Quita las aristas que separan dos caras coplanares con la misma orientación:
 * son costuras dejadas por la operación, no aristas del modelo. Devuelve los
 * planos afectados para reconstruirlos.
 */
function removeCoplanarSeams(geo: Geometry, faces: Iterable<Id>): Plane[] {
  const faceSet = new Set([...faces].filter((f) => geo.faces.has(f)));
  const victims: Id[] = [];
  const planes: Plane[] = [];
  const seen = new Set<Id>();

  for (const fid of faceSet) {
    for (const eid of geo.faceEdges(fid)) {
      if (seen.has(eid)) continue;
      seen.add(eid);
      const users = [...(geo.edgeFaces.get(eid) ?? [])];
      if (users.length !== 2) continue;
      if (!faceSet.has(users[0]) || !faceSet.has(users[1])) continue;
      const f1 = geo.faces.get(users[0]);
      const f2 = geo.faces.get(users[1]);
      if (!f1 || !f2) continue;
      // Orientadas igual: si miraran a lados opuestos no serían la misma
      // superficie, sino una lámina de grosor nulo.
      if (!planeEquals(f1.plane, f2.plane, true)) continue;
      victims.push(eid);
      if (!planes.some((p) => planeEquals(p, f1.plane, false))) planes.push(f1.plane);
    }
  }

  for (const eid of victims) geo.removeEdgeKeepVertices(eid);
  return planes;
}

/** Retira aristas y vértices que se han quedado sin cara dentro de la zona. */
function cleanDangling(geo: Geometry, box: Box3, margin: number): void {
  if (boxIsEmpty(box)) return;
  const m = Math.max(margin, EPS) * 10;
  const inside = (p: Vec3) => p.x >= box.min.x - m && p.x <= box.max.x + m
    && p.y >= box.min.y - m && p.y <= box.max.y + m
    && p.z >= box.min.z - m && p.z <= box.max.z + m;

  for (const e of [...geo.edges.values()]) {
    const users = geo.edgeFaces.get(e.id);
    if (users && users.size > 0) continue;
    const a = geo.vertices.get(e.a);
    const b = geo.vertices.get(e.b);
    if (!a || !b) continue;
    if (!inside(a.p) || !inside(b.p)) continue;
    geo.removeEdge(e.id);
  }
  for (const v of [...geo.vertices.values()]) {
    if (!inside(v.p)) continue;
    geo.removeVertexIfIsolated(v.id);
  }
}

// ---------------------------------------------------------------------------
// Operar sobre grupos
// ---------------------------------------------------------------------------

export interface SolidOpResult extends BooleanResult {
  /** Instancia del grupo resultante. */
  instanceId: Id | null;
  /** Análisis de la unión entre las dos piezas, si se ha podido medir. */
  joint: JointReport | null;
  members: [Member | null, Member | null];
}

/**
 * Operación booleana entre dos grupos o componentes.
 *
 * Las dos piezas se copian a una geometría nueva aplicando sus
 * transformaciones, se opera allí y el resultado se guarda como un grupo nuevo
 * que sustituye a los dos originales. Es el mismo comportamiento que las
 * herramientas de sólidos de SketchUp.
 */
export function booleanInstances(
  model: Model,
  geo: Geometry,
  instanceA: Id,
  instanceB: Id,
  op: BooleanOp,
): SolidOpResult {
  const fail = (message: string): SolidOpResult => ({
    ok: false, message, faces: [], solid: false, instanceId: null, joint: null,
    members: [null, null],
  });

  const instA = geo.instances.get(instanceA);
  const instB = geo.instances.get(instanceB);
  if (!instA || !instB) return fail('Hacen falta dos grupos.');
  if (instanceA === instanceB) return fail('Hay que elegir dos grupos distintos.');

  // Las piezas se miden ANTES de operar: después ya no existen por separado.
  const memberA = measureInstance(model, geo, instanceA);
  const memberB = measureInstance(model, geo, instanceB);
  const joint = memberA && memberB ? analyseJoint(memberA, memberB) : null;

  const temp = new Geometry(model.ids);
  const setA = new Set<Id>();
  const setB = new Set<Id>();
  bakeInto(model, temp, instA.definitionId, instA.transform, setA, new Set());
  bakeInto(model, temp, instB.definitionId, instB.transform, setB, new Set());

  const result = booleanSolids(temp, setA, setB, op);
  if (!result.ok) return { ...result, instanceId: null, joint, members: [memberA, memberB] };

  const name = `${BOOLEAN_LABEL[op]} (${instA.name || 'grupo'} + ${instB.name || 'grupo'})`;
  const def: Definition = model.createDefinition('group', name);
  (def as { geometry: Geometry }).geometry = temp;

  geo.removeInstance(instanceA);
  geo.removeInstance(instanceB);
  const instanceId = geo.addInstance({
    definitionId: def.id,
    transform: IDENTITY,
    name: '',
    materialId: null,
    hidden: false,
    locked: false,
  });
  model.recountInstances();

  return { ...result, instanceId, joint, members: [memberA, memberB] };
}

/**
 * Copia el contenido de una definición dentro de otra geometría aplicando una
 * transformación. Los planos se recalculan a partir del contorno ya
 * transformado: con una transformación especular el sentido del bucle cambia y
 * la normal tiene que seguirlo.
 */
export function bakeInto(
  model: Model,
  target: Geometry,
  defId: Id,
  m: Mat4,
  out: Set<Id>,
  visiting: Set<Id>,
): void {
  const def = model.definitions.get(defId);
  if (!def || visiting.has(defId)) return;
  visiting.add(defId);
  const g = def.geometry;

  const vmap = new Map<Id, Id>();
  const mapV = (v: Id): Id => {
    let nv = vmap.get(v);
    if (nv === undefined) {
      nv = target.addVertex(transformPoint(m, g.vertexPos(v)));
      vmap.set(v, nv);
    }
    return nv;
  };

  const emap = new Map<Id, Id>();
  for (const e of g.edges.values()) {
    const ne = target.addEdgeByVertices(mapV(e.a), mapV(e.b));
    if (ne === null) continue;
    const copy = target.edges.get(ne)!;
    copy.soft = copy.soft || e.soft;
    copy.smooth = copy.smooth || e.smooth;
    copy.hidden = copy.hidden || e.hidden;
    emap.set(e.id, ne);
  }

  for (const f of g.faces.values()) {
    const loops: Loop[] = [];
    let ok = true;
    for (const loop of f.loops) {
      const mapped: Loop = { edges: [], dirs: [], vertices: [] };
      for (let i = 0; i < loop.edges.length; i++) {
        const ne = emap.get(loop.edges[i]);
        const nv = vmap.get(loop.vertices[i]);
        if (ne === undefined || nv === undefined) {
          ok = false;
          break;
        }
        mapped.edges.push(ne);
        mapped.vertices.push(nv);
        mapped.dirs.push(target.edges.get(ne)!.a === nv);
      }
      if (!ok) break;
      loops.push(mapped);
    }
    if (!ok || loops.length === 0) continue;
    const pts = loops[0].vertices.map((v) => target.vertexPos(v));
    const plane = planeFromPolygon(pts) ?? planeTransform(f.plane, m);
    out.add(target.addFace(loops, plane, f.frontMaterial, f.backMaterial));
  }

  for (const child of g.instances.values()) {
    bakeInto(model, target, child.definitionId, matMul(m, child.transform), out, visiting);
  }
  visiting.delete(defId);
}
