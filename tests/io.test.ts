import { describe, it, expect } from 'vitest';
import { Model } from '../src/core/model/model';
import { Geometry } from '../src/core/model/geometry';
import { drawRect, expectValid, faceAreas, closeTo } from './helpers';
import { matTranslation, matRotation } from '../src/core/math/mat';
import { v3, AXIS_Z } from '../src/core/math/vec';
import { triangulateFace } from '../src/core/topology/triangulate';
import {
  FILE_VERSION,
  serializeModel,
  serializeToJSON,
  deserializeModel,
} from '../src/core/io/serialize';
import { exportOBJ, collectTriangles } from '../src/core/io/obj';
import { exportSTLAscii, exportSTLBinary } from '../src/core/io/stl';

// ---------------------------------------------------------------------------
// Modelo de prueba: un rectángulo en la raíz + un grupo con geometría propia.
// ---------------------------------------------------------------------------

function buildModel(): Model {
  const model = new Model();
  model.name = 'Prueba IO';

  const root = model.rootGeometry;
  drawRect(root, 0, 0, 4, 3);

  // Grupo con su propio rectángulo, instanciado dos veces.
  const grupo = model.createDefinition('group', 'Grupo');
  drawRect(grupo.geometry, 0, 0, 1, 2);
  grupo.description = 'grupo de prueba';

  root.addInstance({
    definitionId: grupo.id,
    transform: matTranslation(v3(10, 0, 0)),
    name: 'Grupo 1',
    materialId: 'madera',
    hidden: false,
    locked: false,
  });
  root.addInstance({
    definitionId: grupo.id,
    transform: matRotation(AXIS_Z, Math.PI / 3, v3(0, 0, 0)),
    name: 'Grupo 2',
    materialId: null,
    hidden: false,
    locked: true,
  });

  // Atributos variados para comprobar que se preservan.
  const firstEdge = [...root.edges.values()][0];
  firstEdge.soft = true;
  firstEdge.smooth = true;
  const firstFace = [...root.faces.values()][0];
  firstFace.frontMaterial = 'azul';
  firstFace.backMaterial = 'gris';
  root.suppressedRegions.add('region-de-prueba');

  model.recountInstances();
  return model;
}

/** Áreas de todas las caras de todas las definiciones, ordenadas. */
function allFaceAreas(model: Model): number[] {
  const out: number[] = [];
  for (const d of model.definitions.values()) out.push(...faceAreas(d.geometry));
  return out.sort((a, b) => b - a);
}

/** Número total de triángulos visibles del modelo (sin transformar). */
function totalTriangles(model: Model): number {
  let n = 0;
  const visit = (geo: Geometry, visiting: Set<number>) => {
    for (const f of geo.faces.values()) {
      if (f.hidden) continue;
      const t = triangulateFace(geo, f.id);
      if (t) n += t.indices.length / 3;
    }
    for (const inst of geo.instances.values()) {
      if (inst.hidden) continue;
      if (visiting.has(inst.definitionId)) continue;
      const d = model.definitions.get(inst.definitionId);
      if (!d) continue;
      visiting.add(inst.definitionId);
      visit(d.geometry, visiting);
      visiting.delete(inst.definitionId);
    }
  };
  visit(model.rootGeometry, new Set([model.rootId]));
  return n;
}

describe('serialize: ida y vuelta', () => {
  it('el modelo de prueba tiene el contenido esperado', () => {
    const model = buildModel();
    expect(model.rootGeometry.faces.size).toBe(1);
    expect(model.rootGeometry.instances.size).toBe(2);
    expect(model.definitions.size).toBe(2);
    expectValid(model.rootGeometry);
  });

  it('preserva estadísticas, áreas e invariantes', () => {
    const model = buildModel();
    const antes = model.stats();
    const areasAntes = allFaceAreas(model);

    const copia = deserializeModel(serializeToJSON(model));

    expect(copia.stats()).toEqual(antes);
    const areasDespues = allFaceAreas(copia);
    expect(areasDespues.length).toBe(areasAntes.length);
    for (let i = 0; i < areasAntes.length; i++) closeTo(areasDespues[i], areasAntes[i], 1e-12);

    for (const d of copia.definitions.values()) expectValid(d.geometry);
  });

  it('preserva ids, nombre, unidades, materiales y atributos', () => {
    const model = buildModel();
    model.units = { ...model.units, unit: 'cm', precision: 3, showUnit: false };
    const copia = deserializeModel(serializeModel(model));

    expect(copia.name).toBe('Prueba IO');
    expect(copia.rootId).toBe(model.rootId);
    expect(copia.units).toEqual(model.units);
    expect([...copia.materials.keys()]).toEqual([...model.materials.keys()]);
    expect([...copia.definitions.keys()]).toEqual([...model.definitions.keys()]);

    const origEdges = [...model.rootGeometry.edges.values()];
    const copyEdges = [...copia.rootGeometry.edges.values()];
    expect(copyEdges.map((e) => [e.id, e.a, e.b, e.soft, e.smooth, e.hidden])).toEqual(
      origEdges.map((e) => [e.id, e.a, e.b, e.soft, e.smooth, e.hidden]),
    );

    const f0 = [...copia.rootGeometry.faces.values()][0];
    expect(f0.frontMaterial).toBe('azul');
    expect(f0.backMaterial).toBe('gris');
    expect([...copia.rootGeometry.suppressedRegions]).toEqual(['region-de-prueba']);

    const insts = [...copia.rootGeometry.instances.values()];
    const orig = [...model.rootGeometry.instances.values()];
    expect(insts.length).toBe(2);
    for (let i = 0; i < insts.length; i++) {
      expect(insts[i].id).toBe(orig[i].id);
      expect(insts[i].definitionId).toBe(orig[i].definitionId);
      expect(insts[i].name).toBe(orig[i].name);
      expect(insts[i].materialId).toBe(orig[i].materialId);
      expect(insts[i].locked).toBe(orig[i].locked);
      expect([...insts[i].transform]).toEqual([...orig[i].transform]);
    }

    const grupo = [...copia.definitions.values()].find((d) => d.id !== copia.rootId)!;
    expect(grupo.name).toBe('Grupo');
    expect(grupo.kind).toBe('group');
    expect(grupo.description).toBe('grupo de prueba');
    expect(grupo.instanceCount).toBe(2);
  });

  it('deja el asignador de ids por encima del mayor id usado', () => {
    const model = buildModel();
    const copia = deserializeModel(serializeToJSON(model));

    let maxId = 0;
    for (const d of copia.definitions.values()) {
      maxId = Math.max(maxId, d.id);
      for (const v of d.geometry.vertices.keys()) maxId = Math.max(maxId, v);
      for (const e of d.geometry.edges.keys()) maxId = Math.max(maxId, e);
      for (const f of d.geometry.faces.keys()) maxId = Math.max(maxId, f);
      for (const i of d.geometry.instances.keys()) maxId = Math.max(maxId, i);
    }
    expect(copia.ids.peek()).toBeGreaterThan(maxId);
    expect(copia.ids.peek()).toBe(model.ids.peek());

    // Un id nuevo no colisiona con nada existente.
    const nuevo = copia.ids.alloc();
    expect(nuevo).toBeGreaterThan(maxId);
  });

  it('un segundo ciclo produce EXACTAMENTE el mismo JSON', () => {
    const model = buildModel();
    const json1 = serializeToJSON(model);
    const copia1 = deserializeModel(json1);
    const json2 = serializeToJSON(copia1);
    expect(json2).toBe(json1);

    const copia2 = deserializeModel(json2);
    expect(serializeToJSON(copia2)).toBe(json1);
  });

  it('la cabecera del archivo es la esperada', () => {
    const file = serializeModel(buildModel());
    expect(file.format).toBe('form3d');
    expect(file.version).toBe(FILE_VERSION);
    expect(file.definitions.length).toBe(2);
    expect(file.definitions[0].id).toBe(file.rootId);
  });

  it('un modelo vacío se serializa y deserializa sin errores', () => {
    const model = new Model();
    const json = serializeToJSON(model);
    const copia = deserializeModel(json);

    expect(copia.stats()).toEqual(model.stats());
    expect(copia.rootId).toBe(model.rootId);
    expect(copia.rootGeometry.isEmpty()).toBe(true);
    expectValid(copia.rootGeometry);
    expect(serializeToJSON(copia)).toBe(json);
  });

  it('rechaza entradas no válidas con mensajes en español', () => {
    expect(() => deserializeModel('{no es json}')).toThrow(/no válido/i);
    expect(() => deserializeModel('[]')).toThrow(/no válido/i);
    expect(() => deserializeModel({ format: 'otro' } as never)).toThrow(/formato desconocido/i);
    expect(() =>
      deserializeModel({ format: 'form3d', version: 999, rootId: 1, definitions: [] } as never),
    ).toThrow(/versión/i);
    expect(() =>
      deserializeModel({ format: 'form3d', version: 1, rootId: 7, definitions: [] } as never),
    ).toThrow(/definición/i);

    // Referencia rota: una cara que apunta a una arista inexistente.
    const file = serializeModel(buildModel());
    file.definitions[0].geometry.faces[0].loops[0].edges[0] = 99999;
    expect(() => deserializeModel(file)).toThrow(/arista inexistente/i);
  });
});

describe('exportación OBJ', () => {
  it('genera v/vn/f coherentes con la triangulación', () => {
    const model = buildModel();
    const { obj, mtl } = exportOBJ(model);
    const lines = obj.split('\n');

    const vLines = lines.filter((l) => l.startsWith('v '));
    const vnLines = lines.filter((l) => l.startsWith('vn '));
    const fLines = lines.filter((l) => l.startsWith('f '));

    const nTri = totalTriangles(model);
    expect(nTri).toBeGreaterThan(0);
    expect(fLines.length).toBe(nTri);
    expect(collectTriangles(model).length).toBe(nTri);

    // Cada triángulo aporta como mucho 3 vértices y al menos 3 en total.
    expect(vLines.length).toBeGreaterThanOrEqual(3);
    expect(vLines.length).toBeLessThanOrEqual(nTri * 3);
    expect(vnLines.length).toBeGreaterThanOrEqual(1);
    expect(vnLines.length).toBeLessThanOrEqual(nTri);

    // Todos los índices están dentro de rango (1-based).
    for (const f of fLines) {
      const refs = f.slice(2).trim().split(/\s+/);
      expect(refs.length).toBe(3);
      for (const r of refs) {
        const [vs, , ns] = r.split('/');
        const vi = Number(vs);
        const ni = Number(ns);
        expect(Number.isInteger(vi)).toBe(true);
        expect(vi).toBeGreaterThanOrEqual(1);
        expect(vi).toBeLessThanOrEqual(vLines.length);
        expect(Number.isInteger(ni)).toBe(true);
        expect(ni).toBeGreaterThanOrEqual(1);
        expect(ni).toBeLessThanOrEqual(vnLines.length);
      }
    }

    expect(obj).toContain('mtllib form3d.mtl');
    expect(lines.some((l) => l.startsWith('usemtl '))).toBe(true);

    // El .mtl declara todos los materiales referenciados por usemtl.
    const usados = new Set(
      lines.filter((l) => l.startsWith('usemtl ')).map((l) => l.slice(7).trim()),
    );
    const declarados = new Set(
      mtl.split('\n').filter((l) => l.startsWith('newmtl ')).map((l) => l.slice(7).trim()),
    );
    for (const u of usados) expect(declarados.has(u)).toBe(true);
  });

  it('el .mtl traduce color hex a Kd y opacidad a d', () => {
    const model = new Model();
    drawRect(model.rootGeometry, 0, 0, 1, 1);
    const face = [...model.rootGeometry.faces.values()][0];
    face.frontMaterial = 'vidrio'; // #bcd8e6, opacidad 0.3

    const { mtl } = exportOBJ(model);
    expect(mtl).toContain('newmtl Vidrio');
    expect(mtl).toContain('d 0.300000');
    const kd = mtl.split('\n').find((l) => l.startsWith('Kd '))!;
    const [, r, g, b] = kd.split(/\s+/).map((s, i) => (i === 0 ? 0 : Number(s)));
    closeTo(r, 0xbc / 255, 1e-5);
    closeTo(g, 0xd8 / 255, 1e-5);
    closeTo(b, 0xe6 / 255, 1e-5);
  });

  it('aplica la escala y el nombre del .mtl indicados', () => {
    const model = new Model();
    drawRect(model.rootGeometry, 0, 0, 2, 1);
    const { obj } = exportOBJ(model, { scale: 1000, mtlFileName: 'otro.mtl' });
    expect(obj).toContain('mtllib otro.mtl');
    const vs = obj.split('\n').filter((l) => l.startsWith('v '));
    const xs = vs.map((l) => Number(l.split(/\s+/)[1]));
    expect(Math.max(...xs)).toBeCloseTo(2000, 6);
  });

  it('las instancias aplican la transformación del padre', () => {
    const model = new Model();
    const grupo = model.createDefinition('group', 'G');
    drawRect(grupo.geometry, 0, 0, 1, 1);
    model.rootGeometry.addInstance({
      definitionId: grupo.id,
      transform: matTranslation(v3(5, 7, 9)),
      name: '',
      materialId: null,
      hidden: false,
      locked: false,
    });
    const tris = collectTriangles(model);
    expect(tris.length).toBeGreaterThan(0);
    for (const t of tris) {
      for (const p of [t.a, t.b, t.c]) {
        expect(p.x).toBeGreaterThanOrEqual(5 - 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(7 - 1e-9);
        closeTo(p.z, 9, 1e-9);
      }
    }
  });

  it('un modelo vacío produce un OBJ sin caras', () => {
    const { obj, mtl } = exportOBJ(new Model());
    expect(obj.split('\n').filter((l) => l.startsWith('f ')).length).toBe(0);
    expect(obj.split('\n').filter((l) => l.startsWith('v ')).length).toBe(0);
    expect(mtl).toContain('Form3D');
  });
});

describe('exportación STL', () => {
  it('ASCII: un "facet normal" por triángulo', () => {
    const model = buildModel();
    const n = totalTriangles(model);
    const stl = exportSTLAscii(model);
    const lines = stl.split('\n');

    expect(lines.filter((l) => l.trim().startsWith('facet normal')).length).toBe(n);
    expect(lines.filter((l) => l.trim() === 'endfacet').length).toBe(n);
    expect(lines.filter((l) => l.trim().startsWith('vertex ')).length).toBe(n * 3);
    expect(lines[0].startsWith('solid ')).toBe(true);
    expect(lines.some((l) => l.startsWith('endsolid '))).toBe(true);
  });

  it('ASCII: escala 1000 por defecto (metros → milímetros)', () => {
    const model = new Model();
    drawRect(model.rootGeometry, 0, 0, 2, 1);
    const mm = exportSTLAscii(model);
    const xs = mm
      .split('\n')
      .filter((l) => l.trim().startsWith('vertex '))
      .map((l) => Number(l.trim().split(/\s+/)[1]));
    expect(Math.max(...xs)).toBeCloseTo(2000, 6);

    const m = exportSTLAscii(model, { scale: 1, name: 'en metros' });
    const xs2 = m
      .split('\n')
      .filter((l) => l.trim().startsWith('vertex '))
      .map((l) => Number(l.trim().split(/\s+/)[1]));
    expect(Math.max(...xs2)).toBeCloseTo(2, 9);
    expect(m.startsWith('solid en_metros')).toBe(true);
  });

  it('ASCII: las normales son unitarias y coherentes con el triángulo', () => {
    const model = buildModel();
    for (const t of collectTriangles(model)) {
      closeTo(Math.hypot(t.n.x, t.n.y, t.n.z), 1, 1e-9);
      // La normal es perpendicular a los dos lados del triángulo.
      const ab = { x: t.b.x - t.a.x, y: t.b.y - t.a.y, z: t.b.z - t.a.z };
      const ac = { x: t.c.x - t.a.x, y: t.c.y - t.a.y, z: t.c.z - t.a.z };
      closeTo(t.n.x * ab.x + t.n.y * ab.y + t.n.z * ab.z, 0, 1e-9);
      closeTo(t.n.x * ac.x + t.n.y * ac.y + t.n.z * ac.z, 0, 1e-9);
    }
  });

  it('binario: 80 + 4 + 50*n bytes y la cuenta correcta en la cabecera', () => {
    const model = buildModel();
    const n = totalTriangles(model);
    const buf = exportSTLBinary(model);

    expect(buf.byteLength).toBe(80 + 4 + 50 * n);
    const view = new DataView(buf);
    expect(view.getUint32(80, true)).toBe(n);

    // La cabecera no debe empezar por "solid".
    const head = new TextDecoder().decode(new Uint8Array(buf, 0, 5));
    expect(head.startsWith('solid')).toBe(false);

    // El primer triángulo del binario coincide con el ASCII.
    const tris = collectTriangles(model, 1000);
    expect(view.getFloat32(84, true)).toBeCloseTo(tris[0].n.x, 4);
    expect(view.getFloat32(96, true)).toBeCloseTo(tris[0].a.x, 2);
  });

  it('binario: modelo vacío = 84 bytes y cero triángulos', () => {
    const buf = exportSTLBinary(new Model());
    expect(buf.byteLength).toBe(84);
    expect(new DataView(buf).getUint32(80, true)).toBe(0);
  });
});
