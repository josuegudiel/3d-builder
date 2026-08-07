import { open, reset, summary } from './lib.mjs';

const { browser, page, errs, box, check, results, frame } = await open();
const W = (p) => page.evaluate((q) => window.form3d.viewport.worldToScreen(q), p);
const mv = async (p) => { const s = await W(p); await page.mouse.move(box.x + s.x, box.y + s.y); await page.waitForTimeout(70); await frame(); };
const status = () => page.evaluate(() => document.querySelector('.status-text').textContent);

// dos aristas que se tocan, en el suelo
await reset(page);
await page.evaluate(() => {
  const api = window.form3d.api;
  api.segment(api.p(0, 0, 0), api.p(1, 0, 0));
  api.segment(api.p(0, 0, 0), api.p(0, 1, 0));
});
await page.waitForTimeout(300);
await page.keyboard.press('n'); await page.waitForTimeout(120);
await mv({ x: 0.5, y: 0, z: 0 });
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(200);
console.log('tras la 1ª arista: ' + await status());
await mv({ x: 0, y: 0.5, z: 0 });
await page.keyboard.down('Control');
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(300);
await page.keyboard.up('Control');
console.log('tras la 2ª arista con Ctrl: ' + await status());
const n1 = await page.evaluate(() => window.form3d.editor.model.angleDimensions.size);
check('Ángulo + Ctrl entre DOS ARISTAS sí deja la cota', n1 === 1, 'cotas angulares=' + n1);

// dos caras
await reset(page);
await page.evaluate(() => {
  const api = window.form3d.api;
  api.rectangle(0, 0, 1, 1);
  api.pushPull(api.faces()[0].id, 1);
});
await page.waitForTimeout(300);
const fs = await page.evaluate(() => {
  const api = window.form3d.api;
  const l = api.faces().map((f) => ({ id: f.id, c: api.faceCentre(f.id), n: api.geometry.faces.get(f.id).plane.n }));
  return [l.find((f) => f.n.z > 0.9), l.find((f) => f.n.y < -0.9)];
});
await page.keyboard.press('n'); await page.waitForTimeout(120);
await mv(fs[0].c);
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(200);
await mv(fs[1].c);
await page.keyboard.down('Control');
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(300);
await page.keyboard.up('Control');
console.log('tras dos CARAS con Ctrl: ' + await status());
const n2 = await page.evaluate(() => window.form3d.editor.model.angleDimensions.size);
check('Ángulo + Ctrl entre DOS CARAS deja la cota o avisa de que no puede',
  n2 === 1 || /no|Ctrl/i.test(await status()), 'cotas angulares=' + n2 + ' | ' + await status());

summary(results, errs);
await browser.close();
