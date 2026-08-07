import { open, reset, summary } from './lib.mjs';

const { browser, page, errs, box, check, results, frame } = await open();

const W = (p) => page.evaluate((q) => window.form3d.viewport.worldToScreen(q), p);
const mv = async (p) => { const s = await W(p); await page.mouse.move(box.x + s.x, box.y + s.y); await page.waitForTimeout(70); await frame(); };
const cl = async (p) => { await mv(p); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(130); };
const dbl = async (p) => {
  const s = await W(p);
  await page.mouse.move(box.x + s.x, box.y + s.y); await page.waitForTimeout(60); await frame();
  await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(60);
  await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(250);
};
const ctx = () => page.evaluate(() => window.form3d.editor.contextPath.length);

console.log('\n### GRUPOS ANIDADOS\n');
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

await dbl({ x: 0.5, y: 0.5, z: 0.5 });
check('1er doble clic entra en Exterior', await ctx() === 1, 'profundidad=' + await ctx());
console.log('   migas: ' + await page.evaluate(() => document.querySelector('.breadcrumb').textContent));
console.log('   instancias del contexto: ' + await page.evaluate(() => JSON.stringify([...window.form3d.editor.geometry.instances.keys()])));

await page.waitForTimeout(700);
await dbl({ x: 0.5, y: 0.5, z: 0.5 });
const d2 = await ctx();
check('2º doble clic entra en Interior', d2 === 2, 'profundidad=' + d2);
console.log('   selección: ' + await page.evaluate(() => JSON.stringify({
  inst: [...window.form3d.editor.selection.instances],
  faces: window.form3d.editor.selection.faces.size,
  st: document.querySelector('.status-text').textContent,
})));

if (d2 !== 2) {
  await page.waitForTimeout(700);
  await cl({ x: 0.5, y: 0.5, z: 0.5 });
  console.log('   un solo clic dentro de Exterior selecciona: ' + await page.evaluate(() => JSON.stringify({
    inst: [...window.form3d.editor.selection.instances],
    faces: window.form3d.editor.selection.faces.size,
    st: document.querySelector('.status-text').textContent,
  })));
  await page.evaluate(() => {
    const id = [...window.form3d.editor.geometry.instances.keys()][0];
    window.form3d.editor.enterContext(id);
  });
  await page.waitForTimeout(250);
  check('entrar en Interior por API sí funciona', await ctx() === 2, 'profundidad=' + await ctx());
  console.log('   migas: ' + await page.evaluate(() => document.querySelector('.breadcrumb').textContent));
}

// salir con el botón de las migas
await page.evaluate(() => { window.form3d.editor.contextPath = []; window.form3d.editor.refreshModel(); });
await page.waitForTimeout(200);
await page.waitForTimeout(700);
await dbl({ x: 0.5, y: 0.5, z: 0.5 });
const bcBtn = await page.locator('.breadcrumb button').count();
console.log('   botones en las migas: ' + bcBtn + '  (profundidad ' + await ctx() + ')');
if (bcBtn) {
  await page.locator('.breadcrumb button').first().click();
  await page.waitForTimeout(250);
  check('el botón de las migas sale del grupo', await ctx() === 0, 'profundidad=' + await ctx());
}

console.log('\n### CUADRO DE MEDIDAS CON TEXTO RARO (herramienta Rectángulo)\n');
const weird = ['0', '0;0', '-500', '-500;-300', '1e9', '99999999', 'abc', '<script>alert(1)</script>',
  '1;2;3;4;5', '1,,2', '∞', 'NaN', '  1200 ; 800  ', "5' 6\"", '1200mmm', '1200;', ';800'];
for (const txt of weird) {
  await page.evaluate(() => { document.activeElement?.blur?.(); });
  await page.keyboard.press('v'); await page.waitForTimeout(90);
  await reset(page);
  await page.keyboard.press('r'); await page.waitForTimeout(110);
  await cl({ x: 0, y: 0, z: 0 });
  await mv({ x: 1, y: 1, z: 0 });
  const dis = await page.evaluate(() => document.querySelector('.vcb input').disabled);
  if (dis) { console.log(`   "${txt}" → CUADRO DESHABILITADO`); continue; }
  await page.fill('.vcb input', txt);
  await page.press('.vcb input', 'Enter');
  await page.waitForTimeout(230);
  const out = await page.evaluate(() => ({
    st: document.querySelector('.status-text').textContent,
    s: window.form3d.editor.model.stats(),
    v: window.form3d.api.validate(),
    a: window.form3d.api.faceAreas(),
  }));
  console.log(`   "${txt}" → caras ${out.s.faces} aristas ${out.s.edges} áreas ${JSON.stringify(out.a)} val=${JSON.stringify(out.v)} | ${out.st.slice(0, 60)}`);
  if (out.v.length) check(`"${txt}" deja la topología válida`, false, JSON.stringify(out.v));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
}
check('ningún texto raro rompe la topología ni lanza excepciones', errs.length === 0, [...new Set(errs)].join(' | '));

// tamaños extremos
for (const [txt, name] of [['0.001;0.001', '1 µm'], ['10000000;10000000', '10 km']]) {
  await page.evaluate(() => { document.activeElement?.blur?.(); });
  await page.keyboard.press('v'); await page.waitForTimeout(90);
  await reset(page);
  await page.keyboard.press('r'); await page.waitForTimeout(110);
  await cl({ x: 0, y: 0, z: 0 });
  await mv({ x: 1, y: 1, z: 0 });
  if (await page.evaluate(() => document.querySelector('.vcb input').disabled)) { console.log('   ' + name + ': cuadro deshabilitado'); continue; }
  await page.fill('.vcb input', txt);
  await page.press('.vcb input', 'Enter'); await page.waitForTimeout(300);
  const out = await page.evaluate(() => ({ s: window.form3d.editor.model.stats(), v: window.form3d.api.validate(), a: window.form3d.api.faceAreas() }));
  console.log('   rectángulo de ' + name + ': ' + JSON.stringify(out));
  check('un rectángulo de ' + name + ' no rompe la topología', out.v.length === 0, JSON.stringify(out.v));
}

summary(results, errs);
await browser.close();
