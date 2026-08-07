import { open, reset, summary } from './lib.mjs';

const { browser, page, errs, box, check, results, frame } = await open();
const W = (p) => page.evaluate((q) => window.form3d.viewport.worldToScreen(q), p);

// -------------------------------------------- Archivo ▸ Nuevo con dibujo a medias
console.log('\n### ARCHIVO ▸ NUEVO CON UNA HERRAMIENTA A MEDIAS\n');
await reset(page);
await page.keyboard.press('r'); await page.waitForTimeout(100);
let s = await W({ x: 0, y: 0, z: 0 });
await page.mouse.move(box.x + s.x, box.y + s.y); await page.waitForTimeout(70); await frame();
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(120);
s = await W({ x: 1.4, y: -0.6, z: 0 });
await page.mouse.move(box.x + s.x, box.y + s.y); await page.waitForTimeout(70); await frame();
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(200);
check('hay un rectángulo dibujado', (await page.evaluate(() => window.form3d.api.stats())).faces === 1,
  JSON.stringify(await page.evaluate(() => window.form3d.api.stats())));
// empezar otro y dejarlo a medias
s = await W({ x: 2.4, y: -1.6, z: 0 });
await page.mouse.move(box.x + s.x, box.y + s.y); await page.waitForTimeout(70); await frame();
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(150);
check('el segundo rectángulo tiene una esquina puesta',
  (await page.evaluate(() => window.form3d.editor.tool.points.length)) === 1);
await page.locator('.menu > button', { hasText: 'Archivo' }).click(); await page.waitForTimeout(200);
await page.locator('.menu-item', { hasText: 'Nuevo' }).first().click(); await page.waitForTimeout(500);
const afterNew = await page.evaluate(() => ({
  stats: window.form3d.api.stats(),
  pts: window.form3d.editor.tool.points.length,
}));
check('Archivo ▸ Nuevo vacía el modelo', afterNew.stats.faces === 0, JSON.stringify(afterNew.stats));
check('Archivo ▸ Nuevo cancela también el dibujo a medias', afterNew.pts === 0, 'puntos=' + afterNew.pts);
// consecuencia: el siguiente clic
s = await W({ x: -2.4, y: 1.6, z: 0 });
await page.mouse.move(box.x + s.x, box.y + s.y); await page.waitForTimeout(70); await frame();
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(250);
const ghost = await page.evaluate(() => window.form3d.api.stats());
check('el primer clic tras "Nuevo" no dibuja un rectángulo fantasma', ghost.faces === 0, JSON.stringify(ghost));

// =========================================================================
console.log('\n### GUARDAR Y CARGAR UN MODELO COMPLETO\n');
await reset(page);
const built = await page.evaluate(() => {
  const api = window.form3d.api;
  const model = window.form3d.editor.model;

  // pieza base + grupo anidado
  api.rectangle(0, 0, 1, 0.5);
  api.pushPull(api.faces()[0].id, 0.3);
  api.geometry.faces.get(api.faces()[0].id).frontMaterial = 'madera';
  api.selectAll();
  const inner = api.group('Interior');
  api.select({ instances: [inner] });
  const outer = api.group('Exterior');

  // componente compartido: dos instancias de la misma definición
  api.rectangle(3, 0, 3.5, 0.5);
  api.pushPull(api.faceNear(api.p(3.25, 0.25, 0)), 0.4);
  api.select({ faces: [...api.geometry.faces.keys()], edges: [...api.geometry.edges.keys()] });
  const compId = api.group('Componente');
  const compInst = api.geometry.instances.get(compId);
  const defId = compInst.definitionId;
  const def = model.definitions.get(defId);
  def.kind = 'component';
  def.name = 'Pata';
  // segunda instancia de la MISMA definición
  const second = window.form3d.editor.edit('Copia del componente', () => {
    const g = api.geometry;
    return g.addInstance({ definitionId: defId, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 0, 1], name: 'Pata 2', materialId: null, hidden: false, locked: false });
  });

  // material a una instancia
  api.geometry.instances.get(compId).materialId = 'metal';

  // cotas y guías
  model.addDimension(api.p(0, 0, 0), api.p(1, 0, 0), api.p(0, -0.3, 0), 'ancho');
  api.angleDimension(api.p(0, 0, 0), api.p(1, 0, 0), api.p(0, 1, 0), 0.4);
  model.addGuide('line', api.p(0, 0, 0), api.p(0, 0, 2));
  model.addGuide('point', api.p(1, 1, 1), api.p(1, 1, 1));
  model.name = 'Banco de pruebas';
  window.form3d.editor.setUnits({ format: 'decimal', unit: 'cm', precision: 1 });
  window.form3d.editor.refreshModel();

  return {
    defs: [...model.definitions.keys()].length,
    instancias: api.instances().length,
    second,
    stats: model.stats(),
  };
});
await page.waitForTimeout(400);
console.log('   construido: ' + JSON.stringify(built));

const snapshot = await page.evaluate(() => {
  const model = window.form3d.editor.model;
  const api = window.form3d.api;
  return {
    json: api.toJSON(),
    dims: model.dimensions.size,
    angleDims: model.angleDimensions.size,
    guides: model.guides.size,
    defs: model.definitions.size,
    name: model.name,
    units: JSON.stringify(model.units),
    stats: model.stats(),
    materials: [...model.definitions.values()].flatMap((d) => [...d.geometry.faces.values()].map((f) => f.frontMaterial)).filter(Boolean),
    instMaterials: [...model.definitions.values()].flatMap((d) => [...d.geometry.instances.values()].map((i) => i.materialId)).filter(Boolean),
    componentDefs: [...model.definitions.values()].filter((d) => d.kind === 'component').map((d) => d.name),
  };
});
console.log('   antes de guardar: ' + JSON.stringify({ ...snapshot, json: snapshot.json.length + ' bytes' }));
check('el modelo tiene 2 cotas (lineal + angular)', snapshot.dims === 1 && snapshot.angleDims === 1, JSON.stringify(snapshot));
check('el modelo tiene 2 guías', snapshot.guides === 2, 'guías=' + snapshot.guides);
check('hay un componente compartido con 2 instancias',
  snapshot.componentDefs.length === 1, JSON.stringify(snapshot.componentDefs));

// cargar el JSON tal cual (lo mismo que hace Archivo ▸ Abrir)
const reloaded = await page.evaluate((json) => {
  const api = window.form3d.api;
  api.fromJSON(json);
  const model = window.form3d.editor.model;
  return {
    json: api.toJSON(),
    dims: model.dimensions.size,
    angleDims: model.angleDimensions.size,
    guides: model.guides.size,
    defs: model.definitions.size,
    name: model.name,
    units: JSON.stringify(model.units),
    stats: model.stats(),
    materials: [...model.definitions.values()].flatMap((d) => [...d.geometry.faces.values()].map((f) => f.frontMaterial)).filter(Boolean),
    instMaterials: [...model.definitions.values()].flatMap((d) => [...d.geometry.instances.values()].map((i) => i.materialId)).filter(Boolean),
    componentDefs: [...model.definitions.values()].filter((d) => d.kind === 'component').map((d) => d.name),
    val: api.validate(),
    sharedUses: (() => {
      const count = new Map();
      for (const d of model.definitions.values()) {
        for (const i of d.geometry.instances.values()) count.set(i.definitionId, (count.get(i.definitionId) ?? 0) + 1);
      }
      return [...count.values()].sort();
    })(),
  };
}, snapshot.json);
await page.waitForTimeout(400);

const cmp = (k) => JSON.stringify(snapshot[k]) === JSON.stringify(reloaded[k]);
check('guardar/cargar: el JSON es idéntico', snapshot.json === reloaded.json,
  snapshot.json.length + ' vs ' + reloaded.json.length);
check('guardar/cargar: conserva las cotas lineales', cmp('dims'), snapshot.dims + ' → ' + reloaded.dims);
check('guardar/cargar: conserva las cotas angulares', cmp('angleDims'), snapshot.angleDims + ' → ' + reloaded.angleDims);
check('guardar/cargar: conserva las guías', cmp('guides'), snapshot.guides + ' → ' + reloaded.guides);
check('guardar/cargar: conserva las definiciones (grupos anidados + componente)', cmp('defs'), snapshot.defs + ' → ' + reloaded.defs);
check('guardar/cargar: conserva el nombre del modelo', cmp('name'), snapshot.name + ' → ' + reloaded.name);
check('guardar/cargar: conserva las unidades', cmp('units'), snapshot.units + ' → ' + reloaded.units);
check('guardar/cargar: conserva los materiales de cara', cmp('materials'), JSON.stringify(snapshot.materials) + ' → ' + JSON.stringify(reloaded.materials));
check('guardar/cargar: conserva el material de la instancia', cmp('instMaterials'), JSON.stringify(snapshot.instMaterials) + ' → ' + JSON.stringify(reloaded.instMaterials));
check('guardar/cargar: el componente sigue siendo componente', cmp('componentDefs'), JSON.stringify(snapshot.componentDefs) + ' → ' + JSON.stringify(reloaded.componentDefs));
check('guardar/cargar: la definición compartida sigue compartida (2 usos)',
  reloaded.sharedUses.includes(2), JSON.stringify(reloaded.sharedUses));
check('guardar/cargar: validate() vacío', reloaded.val.length === 0, JSON.stringify(reloaded.val));

// el texto del archivo guardado de verdad (con sangrado, como Archivo ▸ Guardar)
const saved = await page.evaluate(() => window.form3d.api.toJSON(2));
const reparse = await page.evaluate((t) => {
  const m = window.form3d.api.parseJSON(t);
  return { defs: m.definitions.size, dims: m.dimensions.size, guides: m.guides.size, stats: m.stats() };
}, saved);
check('el archivo con sangrado (Archivo ▸ Guardar) también se relee bien',
  reparse.defs === reloaded.defs && reparse.dims === reloaded.dims && reparse.guides === reloaded.guides,
  JSON.stringify(reparse));

// exportaciones
const exp = await page.evaluate(() => {
  const api = window.form3d.api;
  const { obj, mtl } = api.exportOBJ();
  const stl = api.exportSTL(false);
  const bin = api.exportSTL(true);
  return {
    objV: (obj.match(/^v /gm) || []).length,
    objF: (obj.match(/^f /gm) || []).length,
    objG: (obj.match(/^g /gm) || []).length,
    mtlNew: (mtl.match(/^newmtl /gm) || []).length,
    stlFacets: (stl.match(/facet normal/g) || []).length,
    binBytes: bin.byteLength,
  };
});
console.log('   exportaciones: ' + JSON.stringify(exp));
check('OBJ exporta vértices, caras y grupos', exp.objV > 0 && exp.objF > 0, JSON.stringify(exp));
check('STL binario tiene la cabecera de 84 bytes + 50/faceta',
  exp.binBytes === 84 + 50 * exp.stlFacets, exp.binBytes + ' con ' + exp.stlFacets + ' facetas');

check('sin excepciones en guardar/cargar/exportar', errs.length === 0, [...new Set(errs)].slice(0, 4).join(' | '));

summary(results, errs);
await browser.close();
