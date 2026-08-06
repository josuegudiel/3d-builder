/**
 * Serialización del modelo completo a JSON y vuelta.
 *
 * El formato es un volcado *literal* de la topología: no se recalcula nada al
 * cargar (ni caras, ni planos, ni soldadura de vértices). Así garantizamos que
 * `deserializar(serializar(m))` reproduce el modelo bit a bit, incluidos los
 * identificadores, y que un segundo ciclo produce exactamente el mismo texto.
 *
 * Unidades: el modelo guarda SIEMPRE metros, así que aquí no hay conversión.
 */

import { Model, Definition } from '../model/model';
import { Geometry } from '../model/geometry';
import {
  Id,
  Edge,
  Face,
  Loop,
  Instance,
  Material,
  DefinitionKind,
  PlaneData,
  planeToData,
  planeFromData,
} from '../model/types';
import { v3 } from '../math/vec';
import { Mat4 } from '../math/mat';
import { UnitSettings, DEFAULT_UNITS } from '../units';

/** Versión del formato de archivo. Se incrementa ante cambios incompatibles. */
export const FILE_VERSION = 1;

/** Marca que identifica los archivos de Form3D. */
export const FILE_FORMAT = 'form3d';

// ---------------------------------------------------------------------------
// Estructuras serializables (JSON plano, sin Map ni Set)
// ---------------------------------------------------------------------------

export interface VertexData {
  id: Id;
  /** Posición en metros, en el espacio local de su definición. */
  p: [number, number, number];
}

export interface EdgeData {
  id: Id;
  a: Id;
  b: Id;
  soft: boolean;
  smooth: boolean;
  hidden: boolean;
}

export interface LoopData {
  edges: Id[];
  dirs: boolean[];
  vertices: Id[];
}

export interface FaceData {
  id: Id;
  loops: LoopData[];
  plane: PlaneData;
  frontMaterial: string | null;
  backMaterial: string | null;
  hidden: boolean;
}

export interface InstanceData {
  id: Id;
  definitionId: Id;
  /** Matriz 4x4 column-major (16 números). */
  transform: number[];
  name: string;
  materialId: string | null;
  hidden: boolean;
  locked: boolean;
}

export interface GeometryData {
  vertices: VertexData[];
  edges: EdgeData[];
  faces: FaceData[];
  instances: InstanceData[];
  /** Claves de regiones cuya cara borró el usuario (Geometry.suppressedRegions). */
  suppressedRegions: string[];
}

export interface DefinitionData {
  id: Id;
  name: string;
  kind: DefinitionKind;
  description: string;
  geometry: GeometryData;
}

export interface DimensionData {
  id: Id;
  a: [number, number, number];
  b: [number, number, number];
  offset: [number, number, number];
  text: string;
}

export interface GuideData {
  id: Id;
  kind: 'line' | 'point';
  a: [number, number, number];
  b: [number, number, number];
}

export interface ModelFile {
  /** Siempre "form3d". */
  format: string;
  version: number;
  /** Nombre visible del modelo. */
  name: string;
  units: UnitSettings;
  /** Id de la definición raíz dentro de `definitions`. */
  rootId: Id;
  /** Siguiente id libre del asignador en el momento de guardar. */
  nextId: number;
  materials: Material[];
  definitions: DefinitionData[];
  /** Cotas del modelo (opcional en archivos antiguos). */
  dimensions: DimensionData[];
  /** Guías de construcción (opcional en archivos antiguos). */
  guides: GuideData[];
}

// ---------------------------------------------------------------------------
// Serialización
// ---------------------------------------------------------------------------

function serializeLoop(l: Loop): LoopData {
  return { edges: [...l.edges], dirs: [...l.dirs], vertices: [...l.vertices] };
}

function serializeGeometry(geo: Geometry): GeometryData {
  const vertices: VertexData[] = [];
  for (const v of geo.vertices.values()) {
    vertices.push({ id: v.id, p: [v.p.x, v.p.y, v.p.z] });
  }

  const edges: EdgeData[] = [];
  for (const e of geo.edges.values()) {
    edges.push({ id: e.id, a: e.a, b: e.b, soft: e.soft, smooth: e.smooth, hidden: e.hidden });
  }

  const faces: FaceData[] = [];
  for (const f of geo.faces.values()) {
    faces.push({
      id: f.id,
      loops: f.loops.map(serializeLoop),
      plane: planeToData(f.plane),
      frontMaterial: f.frontMaterial,
      backMaterial: f.backMaterial,
      hidden: f.hidden,
    });
  }

  const instances: InstanceData[] = [];
  for (const i of geo.instances.values()) {
    instances.push({
      id: i.id,
      definitionId: i.definitionId,
      transform: [...i.transform],
      name: i.name,
      materialId: i.materialId,
      hidden: i.hidden,
      locked: i.locked,
    });
  }

  return { vertices, edges, faces, instances, suppressedRegions: [...geo.suppressedRegions] };
}

function serializeDefinition(def: Definition): DefinitionData {
  return {
    id: def.id,
    name: def.name,
    kind: def.kind,
    description: def.description,
    geometry: serializeGeometry(def.geometry),
  };
}

/**
 * Vuelca el modelo a una estructura JSON pura.
 *
 * El orden de definiciones, vértices, aristas, caras e instancias es el orden
 * de inserción de los `Map` correspondientes; al cargar se respeta ese mismo
 * orden, de modo que serializar de nuevo devuelve un texto idéntico.
 */
export function serializeModel(model: Model): ModelFile {
  const definitions: DefinitionData[] = [];
  for (const def of model.definitions.values()) definitions.push(serializeDefinition(def));

  const materials: Material[] = [];
  for (const m of model.materials.values()) {
    materials.push({ id: m.id, name: m.name, color: m.color, opacity: m.opacity });
  }

  return {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    name: model.name,
    units: { ...model.units },
    rootId: model.rootId,
    nextId: model.ids.peek(),
    materials,
    definitions,
    dimensions: [...model.dimensions.values()].map((d) => ({
      id: d.id,
      a: vecToTuple(d.a),
      b: vecToTuple(d.b),
      offset: vecToTuple(d.offset),
      text: d.text,
    })),
    guides: [...model.guides.values()].map((g) => ({
      id: g.id,
      kind: g.kind,
      a: vecToTuple(g.a),
      b: vecToTuple(g.b),
    })),
  };
}

function vecToTuple(v: { x: number; y: number; z: number }): [number, number, number] {
  return [v.x, v.y, v.z];
}

/** Serializa el modelo a texto JSON. `indent` 0 = compacto. */
export function serializeToJSON(model: Model, indent = 0): string {
  return JSON.stringify(serializeModel(model), null, indent);
}

// ---------------------------------------------------------------------------
// Validación de la entrada
// ---------------------------------------------------------------------------

function fail(msg: string): never {
  throw new Error(`Archivo Form3D no válido: ${msg}`);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function reqArray(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) fail(`"${what}" debe ser una lista`);
  return v as unknown[];
}

function reqObject(v: unknown, what: string): Record<string, unknown> {
  if (!isObject(v)) fail(`"${what}" debe ser un objeto`);
  return v;
}

function reqInt(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) {
    fail(`"${what}" debe ser un número entero`);
  }
  return v;
}

function reqNumber(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`"${what}" debe ser un número finito`);
  return v;
}

function reqString(v: unknown, what: string): string {
  if (typeof v !== 'string') fail(`"${what}" debe ser texto`);
  return v;
}

function optString(v: unknown, what: string, def: string): string {
  if (v === undefined || v === null) return def;
  return reqString(v, what);
}

function reqBool(v: unknown, what: string): boolean {
  if (typeof v !== 'boolean') fail(`"${what}" debe ser booleano`);
  return v;
}

function optBool(v: unknown, def: boolean): boolean {
  return typeof v === 'boolean' ? v : def;
}

function nullableString(v: unknown, what: string): string | null {
  if (v === null || v === undefined) return null;
  return reqString(v, what);
}

function reqVec3(v: unknown, what: string): [number, number, number] {
  const a = reqArray(v, what);
  if (a.length !== 3) fail(`"${what}" debe tener 3 componentes`);
  return [reqNumber(a[0], what), reqNumber(a[1], what), reqNumber(a[2], what)];
}

function reqIdList(v: unknown, what: string): Id[] {
  return reqArray(v, what).map((x) => reqInt(x, what));
}

function reqBoolList(v: unknown, what: string): boolean[] {
  return reqArray(v, what).map((x) => reqBool(x, what));
}

function reqMat4(v: unknown, what: string): Mat4 {
  const a = reqArray(v, what);
  if (a.length !== 16) fail(`"${what}" debe tener 16 números`);
  return a.map((x) => reqNumber(x, what));
}

function reqPlane(v: unknown, what: string): PlaneData {
  const o = reqObject(v, what);
  return { n: reqVec3(o.n, `${what}.n`), d: reqNumber(o.d, `${what}.d`) };
}

function readUnits(v: unknown): UnitSettings {
  if (!isObject(v)) return { ...DEFAULT_UNITS };
  const u = { ...DEFAULT_UNITS } as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_UNITS) as (keyof UnitSettings)[]) {
    if (v[k] !== undefined) u[k] = v[k];
  }
  return u as unknown as UnitSettings;
}

// ---------------------------------------------------------------------------
// Deserialización
// ---------------------------------------------------------------------------

function readGeometryData(raw: unknown, where: string): GeometryData {
  const o = reqObject(raw, where);

  const vertices: VertexData[] = reqArray(o.vertices, `${where}.vertices`).map((rv, k) => {
    const v = reqObject(rv, `${where}.vertices[${k}]`);
    return { id: reqInt(v.id, `${where}.vertices[${k}].id`), p: reqVec3(v.p, `${where}.vertices[${k}].p`) };
  });

  const edges: EdgeData[] = reqArray(o.edges, `${where}.edges`).map((re, k) => {
    const e = reqObject(re, `${where}.edges[${k}]`);
    return {
      id: reqInt(e.id, `${where}.edges[${k}].id`),
      a: reqInt(e.a, `${where}.edges[${k}].a`),
      b: reqInt(e.b, `${where}.edges[${k}].b`),
      soft: optBool(e.soft, false),
      smooth: optBool(e.smooth, false),
      hidden: optBool(e.hidden, false),
    };
  });

  const faces: FaceData[] = reqArray(o.faces, `${where}.faces`).map((rf, k) => {
    const f = reqObject(rf, `${where}.faces[${k}]`);
    const tag = `${where}.faces[${k}]`;
    const loops: LoopData[] = reqArray(f.loops, `${tag}.loops`).map((rl, li) => {
      const l = reqObject(rl, `${tag}.loops[${li}]`);
      const edgeIds = reqIdList(l.edges, `${tag}.loops[${li}].edges`);
      const dirs = reqBoolList(l.dirs, `${tag}.loops[${li}].dirs`);
      const verts = reqIdList(l.vertices, `${tag}.loops[${li}].vertices`);
      if (edgeIds.length !== dirs.length || edgeIds.length !== verts.length) {
        fail(`${tag}.loops[${li}]: edges, dirs y vertices deben tener la misma longitud`);
      }
      return { edges: edgeIds, dirs, vertices: verts };
    });
    return {
      id: reqInt(f.id, `${tag}.id`),
      loops,
      plane: reqPlane(f.plane, `${tag}.plane`),
      frontMaterial: nullableString(f.frontMaterial, `${tag}.frontMaterial`),
      backMaterial: nullableString(f.backMaterial, `${tag}.backMaterial`),
      hidden: optBool(f.hidden, false),
    };
  });

  const instances: InstanceData[] = reqArray(o.instances, `${where}.instances`).map((ri, k) => {
    const i = reqObject(ri, `${where}.instances[${k}]`);
    const tag = `${where}.instances[${k}]`;
    return {
      id: reqInt(i.id, `${tag}.id`),
      definitionId: reqInt(i.definitionId, `${tag}.definitionId`),
      transform: [...reqMat4(i.transform, `${tag}.transform`)],
      name: optString(i.name, `${tag}.name`, ''),
      materialId: nullableString(i.materialId, `${tag}.materialId`),
      hidden: optBool(i.hidden, false),
      locked: optBool(i.locked, false),
    };
  });

  const suppressed = o.suppressedRegions === undefined
    ? []
    : reqArray(o.suppressedRegions, `${where}.suppressedRegions`).map((s) =>
        reqString(s, `${where}.suppressedRegions`),
      );

  return { vertices, edges, faces, instances, suppressedRegions: suppressed };
}

/** Normaliza y valida el objeto de entrada (acepta texto JSON o el objeto). */
function readModelFile(data: ModelFile | string): ModelFile {
  let raw: unknown = data;
  if (typeof data === 'string') {
    try {
      raw = JSON.parse(data);
    } catch (err) {
      fail(`el texto no es JSON válido (${(err as Error).message})`);
    }
  }
  const o = reqObject(raw, 'archivo');

  if (o.format !== undefined && o.format !== FILE_FORMAT) {
    fail(`formato desconocido "${String(o.format)}" (se esperaba "${FILE_FORMAT}")`);
  }
  const version = o.version === undefined ? FILE_VERSION : reqInt(o.version, 'version');
  if (version > FILE_VERSION) {
    fail(`versión ${version} más reciente que la soportada (${FILE_VERSION})`);
  }
  if (version < 1) fail(`versión ${version} no soportada`);

  const rootId = reqInt(o.rootId, 'rootId');
  const definitions = reqArray(o.definitions, 'definitions').map((rd, k) => {
    const d = reqObject(rd, `definitions[${k}]`);
    const kind = reqString(d.kind, `definitions[${k}].kind`);
    if (kind !== 'group' && kind !== 'component') {
      fail(`definitions[${k}].kind debe ser "group" o "component"`);
    }
    return {
      id: reqInt(d.id, `definitions[${k}].id`),
      name: optString(d.name, `definitions[${k}].name`, ''),
      kind: kind as DefinitionKind,
      description: optString(d.description, `definitions[${k}].description`, ''),
      geometry: readGeometryData(d.geometry, `definitions[${k}].geometry`),
    };
  });

  if (definitions.length === 0) fail('no hay ninguna definición');
  const seen = new Set<Id>();
  for (const d of definitions) {
    if (seen.has(d.id)) fail(`definición duplicada con id ${d.id}`);
    seen.add(d.id);
  }
  if (!seen.has(rootId)) fail(`la definición raíz ${rootId} no existe en "definitions"`);

  const materials: Material[] = reqArray(o.materials ?? [], 'materials').map((rm, k) => {
    const m = reqObject(rm, `materials[${k}]`);
    return {
      id: reqString(m.id, `materials[${k}].id`),
      name: optString(m.name, `materials[${k}].name`, ''),
      color: optString(m.color, `materials[${k}].color`, '#cccccc'),
      opacity: m.opacity === undefined ? 1 : reqNumber(m.opacity, `materials[${k}].opacity`),
    };
  });

  const nextId = o.nextId === undefined ? 1 : reqInt(o.nextId, 'nextId');

  return {
    format: FILE_FORMAT,
    version,
    name: optString(o.name, 'name', 'Sin título'),
    units: readUnits(o.units),
    rootId,
    nextId,
    materials,
    definitions,
    dimensions: reqArray(o.dimensions ?? [], 'dimensions').map((rd, k) => {
      const d = reqObject(rd, `dimensions[${k}]`);
      return {
        id: reqInt(d.id, `dimensions[${k}].id`),
        a: readVec(d.a, `dimensions[${k}].a`),
        b: readVec(d.b, `dimensions[${k}].b`),
        offset: readVec(d.offset, `dimensions[${k}].offset`),
        text: optString(d.text, `dimensions[${k}].text`, ''),
      };
    }),
    guides: reqArray(o.guides ?? [], 'guides').map((rg, k) => {
      const g = reqObject(rg, `guides[${k}]`);
      const kind = optString(g.kind, `guides[${k}].kind`, 'line');
      return {
        id: reqInt(g.id, `guides[${k}].id`),
        kind: kind === 'point' ? ('point' as const) : ('line' as const),
        a: readVec(g.a, `guides[${k}].a`),
        b: readVec(g.b, `guides[${k}].b`),
      };
    }),
  };
}

/** Lee una terna numérica validando su forma. */
function readVec(value: unknown, tag: string): [number, number, number] {
  const arr = reqArray(value, tag);
  if (arr.length < 3) throw new Error(`Archivo Form3D no válido: ${tag} debe tener 3 componentes`);
  return [reqNumber(arr[0], `${tag}[0]`), reqNumber(arr[1], `${tag}[1]`), reqNumber(arr[2], `${tag}[2]`)];
}

/**
 * Reconstruye un `Model` a partir del archivo.
 *
 * Sobre los ids de las definiciones: `new Model()` ya crea una definición raíz
 * con un id recién asignado (normalmente 1). Para respetar EXACTAMENTE los ids
 * guardados hacemos lo siguiente:
 *   1. Se vacía el mapa `definitions` y se reinicia el asignador a 1.
 *   2. Se crean de nuevo TODAS las definiciones del archivo con su id original,
 *      en el mismo orden, y se llama a `ids.bump(id)` con cada una.
 *   3. Se reescribe `rootId` (declarado `readonly`, es decir, sólo inmutable
 *      para TypeScript) con el id raíz del archivo.
 *   4. Al terminar, el asignador se coloca por encima del mayor id usado y, si
 *      el archivo traía `nextId`, también por encima de él; así el siguiente id
 *      nunca colisiona y el ciclo guardar→cargar→guardar es idempotente.
 */
export function deserializeModel(data: ModelFile | string): Model {
  const file = readModelFile(data);
  const model = new Model();

  // 1) Partimos de cero: fuera la raíz automática y el asignador a 1.
  model.definitions.clear();
  model.ids.reset(1);

  // 2) Definiciones con sus ids originales (geometrías todavía vacías).
  for (const d of file.definitions) {
    model.definitions.set(d.id, {
      id: d.id,
      name: d.name,
      kind: d.kind,
      geometry: new Geometry(model.ids),
      description: d.description,
      instanceCount: 0,
    });
    model.ids.bump(d.id);
  }

  // 3) La raíz del archivo pasa a ser la raíz del modelo.
  (model as unknown as { rootId: Id }).rootId = file.rootId;

  // 4) Contenido de cada geometría, en crudo (sin soldar ni recalcular).
  let maxId = 0;
  for (const d of file.definitions) {
    const geo = model.definitions.get(d.id)!.geometry;
    const g = d.geometry;

    for (const v of g.vertices) {
      geo.addVertexRaw(v.id, v3(v.p[0], v.p[1], v.p[2]));
      if (v.id > maxId) maxId = v.id;
    }
    for (const e of g.edges) {
      if (!geo.vertices.has(e.a) || !geo.vertices.has(e.b)) {
        fail(`la arista ${e.id} de la definición ${d.id} referencia vértices inexistentes`);
      }
      const edge: Edge = { id: e.id, a: e.a, b: e.b, soft: e.soft, smooth: e.smooth, hidden: e.hidden };
      geo.addEdgeRaw(edge);
      if (e.id > maxId) maxId = e.id;
    }
    for (const f of g.faces) {
      for (const loop of f.loops) {
        for (const eid of loop.edges) {
          if (!geo.edges.has(eid)) {
            fail(`la cara ${f.id} de la definición ${d.id} referencia la arista inexistente ${eid}`);
          }
        }
      }
      const loops: Loop[] = f.loops.map((l) => ({
        edges: [...l.edges],
        dirs: [...l.dirs],
        vertices: [...l.vertices],
      }));
      const face: Face = {
        id: f.id,
        loops,
        plane: planeFromData(f.plane),
        frontMaterial: f.frontMaterial,
        backMaterial: f.backMaterial,
        hidden: f.hidden,
      };
      geo.addFaceRaw(face);
      if (f.id > maxId) maxId = f.id;
    }
    for (const i of g.instances) {
      const inst: Instance = {
        id: i.id,
        definitionId: i.definitionId,
        transform: [...i.transform],
        name: i.name,
        materialId: i.materialId,
        hidden: i.hidden,
        locked: i.locked,
      };
      geo.addInstanceRaw(inst);
      if (i.id > maxId) maxId = i.id;
    }
    for (const r of g.suppressedRegions) geo.suppressedRegions.add(r);
  }
  for (const d of file.definitions) if (d.id > maxId) maxId = d.id;

  // 5) Materiales, unidades y nombre.
  model.materials.clear();
  for (const m of file.materials) model.materials.set(m.id, { ...m });
  model.units = { ...file.units };
  model.name = file.name;

  model.dimensions.clear();
  for (const d of file.dimensions) {
    model.dimensions.set(d.id, {
      id: d.id,
      a: { x: d.a[0], y: d.a[1], z: d.a[2] },
      b: { x: d.b[0], y: d.b[1], z: d.b[2] },
      offset: { x: d.offset[0], y: d.offset[1], z: d.offset[2] },
      text: d.text,
    });
    if (d.id > maxId) maxId = d.id;
  }
  model.guides.clear();
  for (const g of file.guides) {
    model.guides.set(g.id, {
      id: g.id,
      kind: g.kind,
      a: { x: g.a[0], y: g.a[1], z: g.a[2] },
      b: { x: g.b[0], y: g.b[1], z: g.b[2] },
    });
    if (g.id > maxId) maxId = g.id;
  }

  // 6) El asignador queda por encima de todo lo usado (y de `nextId`).
  model.ids.reset(Math.max(model.ids.peek(), file.nextId, maxId + 1));

  // 7) `instanceCount` es información derivada: se recalcula, no se guarda.
  model.recountInstances();

  return model;
}

/** Atajo: carga desde texto JSON. */
export function deserializeFromJSON(json: string): Model {
  return deserializeModel(json);
}
