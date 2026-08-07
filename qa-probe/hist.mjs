import { open, reset, summary } from './lib.mjs';

const { browser, page, errs, box, check, results, frame } = await open();
const W = (p) => page.evaluate((q) => window.form3d.viewport.worldToScreen(q), p);
const dblAt = async (p) => { const s = await W(p); await page.mouse.dblclick(box.x + s.x, box.y + s.y); await page.waitForTimeout(250); };
const ctx = () => page.evaluate(() => window.form3d.editor.contextPath.length);

// ------------------------------------------------ doble clic en grupos anidados
console.log('\n### DOBLE CLIC EN GRUPOS ANIDADOS (con dblclick real)\n');
await reset(page);
await page.evaluate(() => {
  const api = window.form3d.api;
  api.rectangle(0, 0, 1, 1);
  api.pushPull(api.faces()[0].id, 1);
  api.selectAll();
  const inner = api.group('Interior');
  api.select({ instances: [inner] });
  api.group('Exterior');
});
await page.waitForTimeout(300);
await page.keyboard.press('v'); await page.waitForTimeout(120);
await frame();
await dblAt({ x: 0.5, y: 0.5, z: 0.5 });
check('doble clic entra en el grupo Exterior', await ctx() === 1, 'profundidad=' + await ctx());
await page.waitForTimeout(700); await frame();
await dblAt({ x: 0.5, y: 0.5, z: 0.5 });
check('doble clic entra en el grupo Interior (2º nivel)', await ctx() === 2, 'profundidad=' + await ctx()
  + ' migas=' + await page.evaluate(() => document.querySelector('.breadcrumb').textContent));
await page.waitForTimeout(700); await frame();
await dblAt({ x: 0.5, y: 0.5, z: 0.5 });
check('dentro del interior, doble clic sobre una cara no cambia de contexto', await ctx() === 2, 'profundidad=' + await ctx());

// -------------------------------------- estado de herramienta tras Archivo ▸ Nuevo
console.log('\n### ESTADO DE HERRAMIENTA TRAS "ARCHIVO ▸ NUEVO"\n');
await reset(page);
await page.keyboard.press('r'); await page.waitForTimeout(100);
let s0 = await W({ x: 0, y: 0, z: 0 });
await page.mouse.move(box.x + s0.x, box.y + s0.y); await page.waitForTimeout(70); await frame();
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(150);
let pts = await page.evaluate(() => window.form3d.editor.tool.points.length);
check('el rectángulo tiene su primera esquina puesta', pts === 1, 'puntos=' + pts);
// Archivo ▸ Nuevo desde el menú
await page.locator('.menu > button', { hasText: 'Archivo' }).click(); await page.waitForTimeout(200);
await page.locator('.menu-item', { hasText: 'Nuevo' }).first().click(); await page.waitForTimeout(400);
pts = await page.evaluate(() => window.form3d.editor.tool.points.length);
check('Archivo ▸ Nuevo cancela el rectángulo a medias', pts === 0, 'puntos=' + pts);
let s1 = await W({ x: 2, y: 2, z: 0 });
await page.mouse.move(box.x + s1.x, box.y + s1.y); await page.waitForTimeout(70); await frame();
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(250);
let st = await page.evaluate(() => window.form3d.editor.model.stats());
check('el primer clic tras "Nuevo" no dibuja un rectángulo fantasma', st.faces === 0, JSON.stringify(st));

// ==========================================================================
console.log('\n### DESHACER / REHACER: 20 OPERACIONES VARIADAS\n');
await reset(page);
const ops = await page.evaluate(() => {
  const api = window.form3d.api;
  const log = [];
  const run = (name, fn) => { fn(); log.push(name); };

  run('1 rectángulo', () => api.rectangle(0, 0, 2, 1));
  run('2 empujar/tirar', () => api.pushPull(api.faces()[0].id, 0.5));
  run('3 equidistancia', () => {
    const top = api.faces().sort((a, b) => b.area - a.area)[0];
    api.offset(top.id, -0.2);
  });
  run('4 empujar/tirar interior', () => {
    const f = api.faces().filter((x) => Math.abs(x.area - 1.6 * 0.6) < 0.3)[0] ?? api.faces()[0];
    api.pushPull(f.id, -0.2);
  });
  run('5 círculo', () => api.circle(api.p(4, 0, 0), 0.5, 12));
  run('6 polígono', () => api.polygon(api.p(6, 0, 0), 0.5, 6));
  run('7 línea', () => api.segment(api.p(0, 3, 0), api.p(2, 3, 0)));
  run('8 mover la línea', () => {
    api.select({ edges: [...api.geometry.edges.keys()].slice(-1) });
    api.move({ edges: [...api.geometry.edges.keys()].slice(-1) }, api.p(0, 0.5, 0));
  });
  run('9 seleccionar y agrupar el círculo', () => {
    const f = api.faceNear(api.p(4, 0, 0));
    api.select({ faces: [f] });
    api.group('Círculo');
  });
  run('10 mover el grupo', () => {
    const i = api.instances()[0];
    api.move({ instances: [i] }, api.p(0, 2, 0));
  });
  run('11 rotar el grupo', () => {
    const i = api.instances()[0];
    api.rotate({ instances: [i] }, api.p(0, 0, 1), 30, api.p(4, 2, 0));
  });
  run('12 escalar el grupo', () => {
    const i = api.instances()[0];
    api.scale({ instances: [i] }, api.p(2, 2, 1), api.p(4, 2, 0));
  });
  run('13 insertar caja', () => api.solid('box', { width: 1, depth: 1, height: 1 }));
  run('14 cota lineal', () => api.model.addDimension(api.p(0, 0, 0), api.p(2, 0, 0), api.p(0, -0.4, 0), ''));
  run('15 cota angular', () => api.angleDimension(api.p(0, 0, 0), api.p(1, 0, 0), api.p(0, 1, 0), 0.5));
  run('16 guía', () => api.model.addGuide('line', api.p(0, 0, 0), api.p(0, 0, 3)));
  run('17 pintar una cara', () => {
    const f = api.faces()[0].id;
    api.geometry.faces.get(f).frontMaterial = 'madera';
  });
  run('18 borrar una arista', () => {
    const e = [...api.geometry.edges.keys()].slice(-1);
    api.eraseEdges(e);
  });
  run('19 polígono 2', () => api.polygon(api.p(-3, 0, 0), 0.8, 5));
  run('20 explotar el grupo', () => {
    const i = api.instances()[0];
    if (i !== undefined) api.explode(i);
  });
  return log;
});
await page.waitForTimeout(400);
check('se han ejecutado 20 operaciones', ops.length === 20, JSON.stringify(ops.length));
const depth = await page.evaluate(() => window.form3d.editor.history.undoStack?.length ?? window.form3d.editor.history.past?.length ?? -1);
console.log('   profundidad del historial: ' + depth);
const before = await page.evaluate(() => window.form3d.api.toJSON());
const statsBefore = await page.evaluate(() => window.form3d.api.stats());
console.log('   modelo final: ' + JSON.stringify(statsBefore));
check('validate() vacío tras las 20 operaciones', (await page.evaluate(() => window.form3d.api.validate())).length === 0,
  JSON.stringify(await page.evaluate(() => window.form3d.api.validate())));

// deshacer 20 con Ctrl+Z real
for (let i = 0; i < 20; i++) { await page.keyboard.press('Control+z'); await page.waitForTimeout(60); }
await page.waitForTimeout(300);
const empty = await page.evaluate(() => window.form3d.api.stats());
check('20 × Ctrl+Z deja el modelo vacío', empty.edges === 0 && empty.faces === 0 && empty.instances === 0, JSON.stringify(empty));
const dimsAfterUndo = await page.evaluate(() => ({
  dims: window.form3d.editor.model.dimensions.size,
  guides: window.form3d.editor.model.guides.size,
}));
check('deshacer también quita cotas y guías', dimsAfterUndo.dims === 0 && dimsAfterUndo.guides === 0, JSON.stringify(dimsAfterUndo));

// rehacer 20 con Ctrl+Y real
for (let i = 0; i < 20; i++) { await page.keyboard.press('Control+y'); await page.waitForTimeout(60); }
await page.waitForTimeout(300);
const after = await page.evaluate(() => window.form3d.api.toJSON());
const statsAfter = await page.evaluate(() => window.form3d.api.stats());
check('20 × Ctrl+Y devuelve las mismas estadísticas', JSON.stringify(statsBefore) === JSON.stringify(statsAfter),
  JSON.stringify(statsBefore) + ' vs ' + JSON.stringify(statsAfter));
check('20 × Ctrl+Y devuelve EXACTAMENTE el mismo modelo (toJSON idéntico)', before === after,
  before === after ? '' : 'longitudes ' + before.length + ' vs ' + after.length);
if (before !== after) {
  const a = JSON.parse(before); const b = JSON.parse(after);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const sa = JSON.stringify(a[k]); const sb = JSON.stringify(b[k]);
    if (sa !== sb) {
      console.log(`   difiere "${k}":`);
      console.log('     antes:  ' + String(sa).slice(0, 400));
      console.log('     después:' + String(sb).slice(0, 400));
    }
  }
}
check('validate() vacío tras rehacerlo todo', (await page.evaluate(() => window.form3d.api.validate())).length === 0,
  JSON.stringify(await page.evaluate(() => window.form3d.api.validate())));

// Mayús+Ctrl+Z como alternativa de rehacer
for (let i = 0; i < 3; i++) { await page.keyboard.press('Control+z'); await page.waitForTimeout(60); }
const mid = await page.evaluate(() => window.form3d.api.stats());
for (let i = 0; i < 3; i++) { await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(60); }
await page.waitForTimeout(200);
const back = await page.evaluate(() => window.form3d.api.stats());
check('Ctrl+Mayús+Z rehace igual que Ctrl+Y', JSON.stringify(back) === JSON.stringify(statsAfter),
  JSON.stringify(mid) + ' → ' + JSON.stringify(back));

check('sin excepciones en deshacer/rehacer', errs.length === 0, [...new Set(errs)].slice(0, 4).join(' | '));

summary(results, errs);
await browser.close();
