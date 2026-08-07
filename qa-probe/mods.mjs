import { open, reset, summary } from './lib.mjs';

const { browser, page, errs, box, check, results, frame } = await open();
const W = (p) => page.evaluate((q) => window.form3d.viewport.worldToScreen(q), p);
const mv = async (p) => { const s = await W(p); await page.mouse.move(box.x + s.x, box.y + s.y); await page.waitForTimeout(70); await frame(); };
const cl = async (p) => { await mv(p); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(130); };
const stats = () => page.evaluate(() => window.form3d.api.stats());
const val = () => page.evaluate(() => window.form3d.api.validate());
const status = () => page.evaluate(() => document.querySelector('.status-text').textContent);
const typeIn = async (t) => {
  if (await page.evaluate(() => document.querySelector('.vcb input').disabled)) return 'DESHABILITADO';
  await page.fill('.vcb input', t); await page.press('.vcb input', 'Enter'); await page.waitForTimeout(220);
  return status();
};
const clickTool = async (l) => { await page.locator(`.tool-btn[aria-label="${l}"]`).click(); await page.waitForTimeout(120); };
const box3 = () => page.evaluate(() => {
  const g = window.form3d.api.geometry;
  const b = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
  for (const v of g.vertices.values()) {
    b.min = [Math.min(b.min[0], v.p.x), Math.min(b.min[1], v.p.y), Math.min(b.min[2], v.p.z)];
    b.max = [Math.max(b.max[0], v.p.x), Math.max(b.max[1], v.p.y), Math.max(b.max[2], v.p.z)];
  }
  return b;
});

console.log('\n### MODIFICADORES ANUNCIADOS EN AYUDA\n');

// ------------------------------------------- Ctrl en Empujar/Tirar
await reset(page);
await page.evaluate(() => window.form3d.api.rectangle(0, 0, 2, 1));
await page.waitForTimeout(200);
await page.keyboard.press('p'); await page.waitForTimeout(90);
let fc = await page.evaluate(() => window.form3d.api.faceCentre(window.form3d.api.faces()[0].id));
await cl(fc);
await mv({ x: fc.x, y: fc.y, z: 0.5 });
await typeIn('500');
let s = await stats();
check('Empujar/Tirar normal da una caja de 6 caras', s.faces === 6, JSON.stringify(s));
// ahora con Ctrl sobre la cara superior
const top = await page.evaluate(() => {
  const api = window.form3d.api;
  return api.faces().map((f) => ({ id: f.id, c: api.faceCentre(f.id), n: api.geometry.faces.get(f.id).plane.n }))
    .filter((f) => Math.abs(f.n.z) > 0.9).sort((a, b) => b.c.z - a.c.z)[0];
});
await page.keyboard.press('p'); await page.waitForTimeout(90);
await mv(top.c);
await page.keyboard.down('Control');
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(150);
await mv({ x: top.c.x, y: top.c.y, z: top.c.z + 0.5 });
await typeIn('300');
await page.keyboard.up('Control');
await page.waitForTimeout(200);
s = await stats();
check('Ctrl + Empujar/Tirar crea geometría nueva (más caras que una caja)', s.faces > 6, JSON.stringify(s));
check('validate() vacío tras Ctrl+Empujar/Tirar', (await val()).length === 0, JSON.stringify(await val()));

// ------------------------------------------- Ctrl en Rotar (copiar)
await reset(page);
await page.evaluate(() => {
  const api = window.form3d.api;
  api.rectangle(0, 0, 1, 0.4);
  api.pushPull(api.faces()[0].id, 0.2);
  api.selectAll();
  const g = api.group('Pieza');
  api.select({ instances: [g] });
});
await page.waitForTimeout(300);
await page.keyboard.press('q'); await page.waitForTimeout(100);
await cl({ x: 0, y: 0, z: 0 });
await cl({ x: 1, y: 0, z: 0 });
await page.keyboard.down('Control');
await mv({ x: 0.7, y: 0.7, z: 0 });
let st = await typeIn('90');
await page.keyboard.up('Control');
await page.waitForTimeout(250);
s = await stats();
check('Ctrl + Rotar copia en lugar de girar (2 grupos)', s.instances === 2, JSON.stringify(s) + ' | ' + st);
check('validate() vacío tras copiar girando', (await val()).length === 0, JSON.stringify(await val()));

// ------------------------------------------- Flechas: bloqueo de eje
await reset(page);
await page.keyboard.press('l'); await page.waitForTimeout(90);
await cl({ x: 0, y: 0, z: 0 });
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(90);
let locked = await page.evaluate(() => window.form3d.editor.tool.lockedAxis);
check('→ bloquea el eje rojo (X)', locked && Math.abs(locked.x - 1) < 1e-9, JSON.stringify(locked));
await page.keyboard.press('ArrowUp'); await page.waitForTimeout(90);
locked = await page.evaluate(() => window.form3d.editor.tool.lockedAxis);
check('↑ bloquea el eje azul (Z)', locked && Math.abs(locked.z - 1) < 1e-9, JSON.stringify(locked));
await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(90);
locked = await page.evaluate(() => window.form3d.editor.tool.lockedAxis);
check('← bloquea el eje verde (Y)', locked && Math.abs(locked.y - 1) < 1e-9, JSON.stringify(locked));
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(90);
locked = await page.evaluate(() => window.form3d.editor.tool.lockedAxis);
check('↓ quita el bloqueo', locked === null, JSON.stringify(locked));
// dibujar 1 m bloqueado en X
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(90);
await mv({ x: 0.4, y: 0.9, z: 0 });
await typeIn('1000');
let b = await box3();
check('bloqueado en X, "1000" traza 1 m exacto sobre el eje rojo',
  Math.abs(b.max[0] - 1) < 1e-6 && Math.abs(b.max[1]) < 1e-9 && Math.abs(b.max[2]) < 1e-9, JSON.stringify(b));
await page.keyboard.press('Escape'); await page.waitForTimeout(120);

// ------------------------------------------- "24s" en el Círculo
await reset(page);
await page.keyboard.press('c'); await page.waitForTimeout(90);
await cl({ x: 0, y: 0, z: 0 });
await mv({ x: 1, y: -0.4, z: 0 });
st = await typeIn('8s');
await mv({ x: 1, y: -0.4, z: 0 });
await typeIn('600');
s = await stats();
check('Círculo: "8s" + radio 600 da un octógono de 8 aristas', s.edges === 8 && s.faces === 1, JSON.stringify(s) + ' | ' + st);
const r = await page.evaluate(() => {
  const g = window.form3d.api.geometry;
  return [...g.vertices.values()].map((v) => Math.hypot(v.p.x, v.p.y, v.p.z));
});
check('Círculo: todos los vértices a 0,6 m exactos', r.every((x) => Math.abs(x - 0.6) < 1e-9), JSON.stringify(r.slice(0, 3)));

// ------------------------------------------- Borrar: Ctrl suaviza, Mayús oculta
await reset(page);
await page.evaluate(() => {
  const api = window.form3d.api;
  api.rectangle(0, 0, 1, 1);
  api.pushPull(api.faces()[0].id, 1);
});
await page.waitForTimeout(250);
const anEdge = await page.evaluate(() => {
  const api = window.form3d.api; const g = api.geometry;
  for (const [id, e] of g.edges) {
    const a = g.vertexPos(e.a); const bb = g.vertexPos(e.b);
    if (Math.abs(a.z - bb.z) > 0.5) return { id, mid: { x: (a.x + bb.x) / 2, y: (a.y + bb.y) / 2, z: (a.z + bb.z) / 2 } };
  }
  return null;
});
await page.keyboard.press('e'); await page.waitForTimeout(90);
await mv(anEdge.mid);
await page.keyboard.down('Control');
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(200);
await page.keyboard.up('Control');
let soft = await page.evaluate((id) => { const e = window.form3d.api.geometry.edges.get(id); return e ? { soft: e.soft, smooth: e.smooth, hidden: e.hidden } : 'BORRADA'; }, anEdge.id);
check('Borrar + Ctrl suaviza la arista en vez de borrarla', soft !== 'BORRADA' && soft.soft === true, JSON.stringify(soft));
await mv(anEdge.mid);
await page.keyboard.down('Shift');
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(200);
await page.keyboard.up('Shift');
soft = await page.evaluate((id) => { const e = window.form3d.api.geometry.edges.get(id); return e ? { soft: e.soft, hidden: e.hidden } : 'BORRADA'; }, anEdge.id);
check('Borrar + Mayús oculta la arista', soft !== 'BORRADA' && soft.hidden === true, JSON.stringify(soft));
check('la caja sigue intacta tras suavizar y ocultar', (await stats()).faces === 6 && (await val()).length === 0,
  JSON.stringify(await stats()) + JSON.stringify(await val()));

// ------------------------------------------- Pintar: Alt copia, Mayús coplanar
await reset(page);
await page.evaluate(() => {
  const api = window.form3d.api;
  api.rectangle(0, 0, 1, 1);
  api.pushPull(api.faces()[0].id, 1);
});
await page.waitForTimeout(250);
const topFace = await page.evaluate(() => {
  const api = window.form3d.api;
  return api.faces().map((f) => ({ id: f.id, c: api.faceCentre(f.id), n: api.geometry.faces.get(f.id).plane.n }))
    .filter((f) => f.n.z > 0.9)[0];
});
await page.locator('.swatches > *').nth(2).click(); await page.waitForTimeout(150);
const matSel = await page.evaluate(() => window.form3d.editor.tool.material);
console.log('   material elegido: ' + matSel);
await cl(topFace.c);
await page.waitForTimeout(200);
const painted = await page.evaluate((id) => {
  const f = window.form3d.api.geometry.faces.get(id);
  return { front: f.frontMaterial, back: f.backMaterial };
}, topFace.id);
check('Pintar aplica el material a la cara', painted.front === matSel || painted.back === matSel, JSON.stringify(painted) + ' esperado ' + matSel);
// Alt copia el material
await page.locator('.swatches > *').nth(5).click(); await page.waitForTimeout(150);
await mv(topFace.c);
await page.keyboard.down('Alt');
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(200);
await page.keyboard.up('Alt');
const picked = await page.evaluate(() => window.form3d.editor.tool.material);
check('Pintar + Alt recoge el material de la cara', picked === matSel, 'recogido=' + picked + ' esperado=' + matSel);
console.log('   estado tras Alt: ' + await status());

// ------------------------------------------- Ángulo con Ctrl deja la cota
await reset(page);
await page.evaluate(() => {
  const api = window.form3d.api;
  api.rectangle(0, 0, 1, 1);
  api.pushPull(api.faces()[0].id, 1);
});
await page.waitForTimeout(250);
const dosCaras = await page.evaluate(() => {
  const api = window.form3d.api;
  const fs = api.faces().map((f) => ({ id: f.id, c: api.faceCentre(f.id), n: api.geometry.faces.get(f.id).plane.n }));
  return [fs.find((f) => f.n.z > 0.9), fs.find((f) => f.n.y < -0.9)];
});
await page.keyboard.press('n'); await page.waitForTimeout(100);
await cl(dosCaras[0].c);
await mv(dosCaras[1].c);
await page.keyboard.down('Control');
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(250);
await page.keyboard.up('Control');
const angDims = await page.evaluate(() => window.form3d.editor.model.angleDimensions.size);
console.log('   estado del Ángulo: ' + await status());
check('Ángulo + Ctrl deja puesta la cota angular', angDims === 1, 'cotas angulares=' + angDims);

// ------------------------------------------- Insertar ▸ Caja (diálogo)
await reset(page);
await page.locator('.menu > button', { hasText: 'Insertar' }).click(); await page.waitForTimeout(150);
await page.locator('.menu.open .menu-item', { hasText: 'Cilindro' }).click(); await page.waitForTimeout(350);
const dlg = await page.evaluate(() => {
  const m = document.querySelector('.modal');
  if (!m) return null;
  return { title: m.querySelector('h2')?.textContent, inputs: [...m.querySelectorAll('input')].map((i) => [i.previousElementSibling?.textContent ?? '', i.value]) };
});
console.log('   diálogo de sólido: ' + JSON.stringify(dlg));
check('Insertar ▸ Cilindro abre un diálogo con parámetros', dlg && dlg.inputs.length > 0, JSON.stringify(dlg));
if (dlg) {
  const btn = await page.locator('.modal button').allTextContents();
  console.log('   botones: ' + JSON.stringify(btn));
  await page.locator('.modal button', { hasText: /Insertar|Aceptar|Crear/ }).first().click().catch(async () => {
    await page.locator('.modal button').last().click();
  });
  await page.waitForTimeout(400);
  s = await stats();
  check('el cilindro se inserta como grupo', s.instances === 1, JSON.stringify(s));
  check('validate() vacío tras insertar el sólido', (await val()).length === 0, JSON.stringify(await val()));
}

check('sin excepciones en el bloque de modificadores', errs.length === 0, [...new Set(errs)].slice(0, 5).join(' | '));

summary(results, errs);
await browser.close();
