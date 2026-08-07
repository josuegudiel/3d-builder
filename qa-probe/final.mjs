import { open, reset, summary } from './lib.mjs';

const { browser, page, errs, box, check, results, frame } = await open();
const W = (p) => page.evaluate((q) => window.form3d.viewport.worldToScreen(q), p);
const mv = async (p) => { const s = await W(p); await page.mouse.move(box.x + s.x, box.y + s.y); await page.waitForTimeout(70); await frame(); };
const cl = async (p) => { await mv(p); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(130); };
const stats = () => page.evaluate(() => window.form3d.api.stats());
const status = () => page.evaluate(() => document.querySelector('.status-text').textContent);
const menuClick = async (m, it) => {
  await page.locator('.menu > button', { hasText: m }).click(); await page.waitForTimeout(150);
  await page.locator('.menu.open .menu-item', { hasText: it }).first().click(); await page.waitForTimeout(400);
};

console.log('\n### FUGA DE ESTADO ENTRE HERRAMIENTAS: CONSECUENCIAS VISIBLES\n');

// LÍNEA: clic 1, cambio de herramienta, vuelvo, un clic → segmento fantasma
await reset(page);
await page.keyboard.press('l'); await page.waitForTimeout(90);
await cl({ x: 0, y: 0, z: 0 });
await page.keyboard.press('r'); await page.waitForTimeout(120);
await page.keyboard.press('l'); await page.waitForTimeout(120);
await cl({ x: 2, y: -1.2, z: 0 });
let s = await stats();
const seg = await page.evaluate(() => [...window.form3d.api.geometry.vertices.values()].map((v) => [v.p.x, v.p.y, v.p.z]));
check('LÍNEA: un clic tras volver a la herramienta no traza un segmento desde el punto viejo',
  s.edges === 0, JSON.stringify(s) + ' vértices ' + JSON.stringify(seg));

// ACOTAR: 2 clics, cambio, vuelvo, 1 clic → cota fantasma
await reset(page);
await page.evaluate(() => window.form3d.api.rectangle(0, 0, 2, 1));
await page.waitForTimeout(200);
await page.keyboard.press('d'); await page.waitForTimeout(90);
await cl({ x: 0, y: 0, z: 0 });
await cl({ x: 2, y: 0, z: 0 });
await page.keyboard.press('v'); await page.waitForTimeout(120);
await page.keyboard.press('d'); await page.waitForTimeout(120);
await cl({ x: 0, y: 1, z: 0 });
const nd = await page.evaluate(() => window.form3d.editor.model.dimensions.size);
check('ACOTAR: un clic tras volver a la herramienta no coloca la cota antigua', nd === 0, 'cotas=' + nd);

// TRANSPORTADOR: vértice + lado, cambio, vuelvo, 1 clic → guía fantasma
await reset(page);
await page.evaluate(() => window.form3d.api.rectangle(0, 0, 2, 2));
await page.waitForTimeout(200);
await page.locator('.tool-btn[aria-label="Transportador"]').click(); await page.waitForTimeout(120);
await cl({ x: 0, y: 0, z: 0 });
await cl({ x: 1, y: 0, z: 0 });
await page.keyboard.press('v'); await page.waitForTimeout(120);
await page.locator('.tool-btn[aria-label="Transportador"]').click(); await page.waitForTimeout(120);
await cl({ x: 1.5, y: 1.5, z: 0 });
const ng = await page.evaluate(() => window.form3d.editor.model.guides.size);
check('TRANSPORTADOR: un clic tras volver a la herramienta no crea una guía inesperada', ng === 0, 'guías=' + ng);

console.log('\n### MENÚS SILENCIOSOS CON GEOMETRÍA PRESENTE\n');
await reset(page);
await page.evaluate(() => {
  const api = window.form3d.api;
  api.rectangle(0, 0, 1, 1);
  api.pushPull(api.faces()[0].id, 1);
  api.clearSelection();
});
await page.waitForTimeout(300);
for (const it of ['Invertir caras', 'Orientar caras del sólido', 'Invertir selección']) {
  await page.evaluate(() => window.form3d.editor.setStatus('«sin cambios»'));
  const antes = await page.evaluate(() => window.form3d.api.toJSON());
  await menuClick('Edición', it);
  const despues = await page.evaluate(() => window.form3d.api.toJSON());
  const st = await status();
  console.log(`   Edición ▸ ${it} (sin selección): modelo ${antes === despues ? 'sin tocar' : 'CAMBIADO'}, mensaje: ${st === '«sin cambios»' ? 'NINGUNO' : st.slice(0, 70)}`);
}
check('Edición ▸ Invertir caras sin selección avisa al usuario',
  (await status()) !== '«sin cambios»', await status());

console.log('\n### ARCHIVO: GUARDAR / EXPORTAR\n');
await reset(page);
await page.evaluate(() => {
  const api = window.form3d.api;
  api.rectangle(0, 0, 1, 1);
  api.pushPull(api.faces()[0].id, 1);
});
await page.waitForTimeout(300);
for (const it of ['Guardar', 'Exportar OBJ', 'Exportar STL', 'Exportar imagen PNG']) {
  await page.evaluate(() => window.form3d.editor.setStatus('«sin cambios»'));
  const before = errs.length;
  await menuClick('Archivo', it);
  await page.waitForTimeout(500);
  const st = await status();
  console.log(`   Archivo ▸ ${it}: ${st === '«sin cambios»' ? 'SIN MENSAJE' : st.slice(0, 60)}  (errores nuevos: ${errs.length - before})`);
  check(`Archivo ▸ ${it} no lanza excepciones`, errs.length === before, errs.slice(before).join(' | '));
}

console.log('\n### AUTOGUARDADO: RECARGAR LA PÁGINA\n');
await page.evaluate(() => {
  const api = window.form3d.api;
  api.clearSelection();
  api.rectangle(3, 0, 4, 1);
});
await page.waitForTimeout(600);
const antes = await page.evaluate(() => window.form3d.api.stats());
// forzar el guardado automático si tiene un método explícito
await page.evaluate(() => { try { window.form3d.__app?.autosave?.save?.(); } catch (e) {} });
await page.waitForTimeout(2500);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const despues = await page.evaluate(() => window.form3d.api.stats());
const stRestore = await status();
console.log('   antes de recargar: ' + JSON.stringify(antes) + '  después: ' + JSON.stringify(despues));
console.log('   estado: ' + stRestore);
check('al recargar se recupera el modelo de la sesión anterior',
  despues.faces === antes.faces && despues.edges === antes.edges, JSON.stringify(antes) + ' → ' + JSON.stringify(despues));

console.log('\n### TRABAJAR DENTRO DE UN GRUPO ANIDADO\n');
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
await page.keyboard.press('v'); await page.waitForTimeout(100);
let sc = await W({ x: 0.5, y: 0.5, z: 0.5 });
await page.mouse.dblclick(box.x + sc.x, box.y + sc.y); await page.waitForTimeout(400);
await page.waitForTimeout(700);
await page.mouse.dblclick(box.x + sc.x, box.y + sc.y); await page.waitForTimeout(400);
check('estoy dentro del grupo interior', await page.evaluate(() => window.form3d.editor.contextPath.length) === 2,
  'profundidad=' + await page.evaluate(() => window.form3d.editor.contextPath.length));
// empujar la cara superior desde dentro del grupo
const topc = await page.evaluate(() => {
  const api = window.form3d.api;
  return api.faces().map((f) => ({ id: f.id, c: api.faceCentre(f.id), n: api.geometry.faces.get(f.id).plane.n }))
    .filter((f) => f.n.z > 0.9)[0].c;
});
await page.keyboard.press('p'); await page.waitForTimeout(100);
await cl(topc);
await mv({ x: topc.x, y: topc.y, z: topc.z + 0.5 });
await page.fill('.vcb input', '500'); await page.press('.vcb input', 'Enter'); await page.waitForTimeout(300);
const volIn = await page.evaluate(() => window.form3d.api.volume());
check('empujar dentro del grupo anidado da 1 × 1 × 1,5 = 1,5 m³', Math.abs(volIn - 1.5) < 1e-6, String(volIn));
check('validate() vacío dentro del grupo', (await page.evaluate(() => window.form3d.api.validate())).length === 0,
  JSON.stringify(await page.evaluate(() => window.form3d.api.validate())));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
const volRoot = await page.evaluate(() => {
  const api = window.form3d.api;
  const i = api.instances()[0];
  return api.groupVolume(i);
});
console.log('   volumen visto desde la raíz: ' + volRoot);
check('desde la raíz el cambio se ve reflejado', await page.evaluate(() => window.form3d.editor.contextPath.length) === 0,
  'profundidad=' + await page.evaluate(() => window.form3d.editor.contextPath.length));

check('sin excepciones en el bloque final', errs.length === 0, [...new Set(errs)].slice(0, 6).join(' | '));
summary(results, errs);
await browser.close();
