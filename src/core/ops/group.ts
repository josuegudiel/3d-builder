import { Model, Definition } from '../model/model';
import { Geometry } from '../model/geometry';
import { Id, Loop } from '../model/types';
import { Vec3 } from '../math/vec';
import { Mat4, IDENTITY, transformPoint, transformNormal } from '../math/mat';
import { planeFromPointNormal } from '../math/plane';
import { Selection, selectedEdgeSet, clearSelection } from '../selection';
import { insertSegment } from '../topology/insert';
import { collectCandidatePlanes, rebuildFaces } from '../topology/rebuild';
import { orientFacesConsistently } from '../topology/orient';

export interface GroupResult {
  definitionId: Id;
  instanceId: Id;
}

/**
 * Agrupa la selección en un grupo o componente nuevo.
 *
 * La geometría se COPIA dentro de la definición y se retira del contenedor:
 * las aristas que además pertenecen a caras no seleccionadas se conservan
 * fuera, de modo que el resto del modelo no se rompe (mismo criterio que
 * SketchUp al agrupar geometría pegada a otra).
 */
export function makeGroup(
  model: Model,
  geo: Geometry,
  selection: Selection,
  kind: 'group' | 'component' = 'group',
  name = kind === 'group' ? 'Grupo' : 'Componente',
): GroupResult | null {
  const faces = new Set<Id>(selection.faces);
  const edges = selectedEdgeSet(selection, geo);
  const instances = new Set<Id>(selection.instances);
  if (faces.size === 0 && edges.size === 0 && instances.size === 0) return null;

  const def = model.createDefinition(kind, name);
  const target = def.geometry;

  // --- Copiar vértices ------------------------------------------------------
  const vertexMap = new Map<Id, Id>();
  const mapVertex = (v: Id): Id => {
    let nv = vertexMap.get(v);
    if (nv === undefined) {
      nv = target.addVertex(geo.vertexPos(v));
      vertexMap.set(v, nv);
    }
    return nv;
  };

  // --- Copiar aristas -------------------------------------------------------
  const edgeMap = new Map<Id, Id>();
  for (const eid of edges) {
    const e = geo.edges.get(eid);
    if (!e) continue;
    const ne = target.addEdgeByVertices(mapVertex(e.a), mapVertex(e.b));
    if (ne === null) continue;
    const copy = target.edges.get(ne)!;
    copy.soft = e.soft;
    copy.smooth = e.smooth;
    copy.hidden = e.hidden;
    edgeMap.set(eid, ne);
  }

  // --- Copiar caras ---------------------------------------------------------
  for (const fid of faces) {
    const f = geo.faces.get(fid);
    if (!f) continue;
    const loops: Loop[] = [];
    let ok = true;
    for (const loop of f.loops) {
      const mapped: Loop = { edges: [], dirs: [], vertices: [] };
      for (let i = 0; i < loop.edges.length; i++) {
        const ne = edgeMap.get(loop.edges[i]);
        const nv = vertexMap.get(loop.vertices[i]);
        if (ne === undefined || nv === undefined) {
          ok = false;
          break;
        }
        const edge = target.edges.get(ne)!;
        mapped.edges.push(ne);
        mapped.vertices.push(nv);
        mapped.dirs.push(edge.a === nv);
      }
      if (!ok) break;
      loops.push(mapped);
    }
    if (!ok || loops.length === 0) continue;
    target.addFace(loops, f.plane, f.frontMaterial, f.backMaterial);
  }

  // --- Mover instancias anidadas -------------------------------------------
  for (const instId of instances) {
    const inst = geo.instances.get(instId);
    if (!inst) continue;
    target.addInstance({
      definitionId: inst.definitionId,
      transform: [...inst.transform],
      name: inst.name,
      materialId: inst.materialId,
      hidden: inst.hidden,
      locked: inst.locked,
    });
    geo.removeInstance(instId);
  }

  // --- Retirar del contenedor ----------------------------------------------
  for (const fid of faces) geo.removeFace(fid);
  for (const eid of edges) {
    const users = geo.edgeFaces.get(eid);
    if (!users || users.size === 0) geo.removeEdge(eid);
  }

  const instanceId = geo.addInstance({
    definitionId: def.id,
    transform: IDENTITY,
    name: '',
    materialId: null,
    hidden: false,
    locked: false,
  });

  model.recountInstances();
  clearSelection(selection);
  selection.instances.add(instanceId);

  return { definitionId: def.id, instanceId };
}

/**
 * Deshace un grupo o componente: su contenido se inserta en el contenedor
 * aplicando la transformación de la instancia.
 */
export function explodeInstance(model: Model, geo: Geometry, instanceId: Id): boolean {
  const inst = geo.instances.get(instanceId);
  if (!inst) return false;
  const def = model.definitions.get(inst.definitionId);
  if (!def) return false;

  const m: Mat4 = inst.transform;
  const affected: Id[] = [];

  for (const e of def.geometry.edges.values()) {
    const a = transformPoint(m, def.geometry.vertexPos(e.a));
    const b = transformPoint(m, def.geometry.vertexPos(e.b));
    const r = insertSegment(geo, a, b);
    // Los atributos de la arista deben viajar con ella: sin esto, un cilindro
    // explotado perdía el suavizado y aparecía facetado.
    for (const id of r.affectedEdges) {
      const copy = geo.edges.get(id);
      if (!copy) continue;
      copy.soft = copy.soft || e.soft;
      copy.smooth = copy.smooth || e.smooth;
      copy.hidden = copy.hidden || e.hidden;
    }
    affected.push(...r.affectedEdges);
  }

  // Instancias anidadas: se conservan componiendo la transformación.
  for (const child of def.geometry.instances.values()) {
    geo.addInstance({
      definitionId: child.definitionId,
      transform: multiply(m, child.transform),
      name: child.name,
      materialId: child.materialId,
      hidden: child.hidden,
      locked: child.locked,
    });
  }

  geo.removeInstance(instanceId);

  const rb = rebuildFaces(geo, collectCandidatePlanes(geo, affected), {
    newEdges: new Set(affected),
  });

  // Recuperar los materiales de las caras originales por su centro.
  for (const oldFace of def.geometry.faces.values()) {
    if (!oldFace.frontMaterial && !oldFace.backMaterial) continue;
    const pts = oldFace.loops[0].vertices.map((v) => transformPoint(m, def.geometry.vertexPos(v)));
    const centre = average(pts);
    const normal = transformNormal(m, oldFace.plane.n);
    const plane = planeFromPointNormal(centre, normal);
    let best: Id | null = null;
    let bestD = 1e-4;
    for (const fid of rb.created) {
      const f = geo.faces.get(fid);
      if (!f) continue;
      const c = average(f.loops[0].vertices.map((v) => geo.vertexPos(v)));
      const d = Math.hypot(c.x - centre.x, c.y - centre.y, c.z - centre.z);
      if (d < bestD && Math.abs(Math.abs(dotV(f.plane.n, plane.n)) - 1) < 1e-6) {
        bestD = d;
        best = fid;
      }
    }
    if (best !== null) {
      const f = geo.faces.get(best)!;
      f.frontMaterial = oldFace.frontMaterial;
      f.backMaterial = oldFace.backMaterial;
    }
  }

  orientFacesConsistently(geo, rb.created);
  model.recountInstances();
  return true;
}

/** Convierte un grupo en componente reutilizable. */
export function groupToComponent(model: Model, geo: Geometry, instanceId: Id, name: string): boolean {
  const inst = geo.instances.get(instanceId);
  if (!inst) return false;
  const def = model.definitions.get(inst.definitionId);
  if (!def) return false;
  def.kind = 'component';
  def.name = name;
  return true;
}

/** Duplica una definición para que la instancia deje de compartirla. */
export function makeUnique(model: Model, geo: Geometry, instanceId: Id): Definition | null {
  const inst = geo.instances.get(instanceId);
  if (!inst) return null;
  const source = model.definitions.get(inst.definitionId);
  if (!source) return null;
  const copy = model.createDefinition(source.kind, `${source.name} (único)`);
  const cloned = source.geometry.clone(model.ids);
  (copy as { geometry: Geometry }).geometry = cloned;
  inst.definitionId = copy.id;
  model.recountInstances();
  return copy;
}

function average(pts: readonly Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  const n = Math.max(1, pts.length);
  return { x: x / n, y: y / n, z: z / n };
}

function dotV(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4];
    const b1 = b[c * 4 + 1];
    const b2 = b[c * 4 + 2];
    const b3 = b[c * 4 + 3];
    out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}
