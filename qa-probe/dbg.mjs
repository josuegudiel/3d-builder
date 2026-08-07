import { open, reset, summary } from './lib.mjs';

const { browser, page, errs, box, check, results, frame } = await open();
const W = (p) => page.evaluate((q) => window.form3d.viewport.worldToScreen(q), p);

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
await page.keyboard.press('v'); await page.waitForTimeout(150);

await page.evaluate(() => {
  window.__log = [];
  const el = window.form3d.viewport.renderer.domElement;
  for (const t of ['pointerdown', 'pointerup', 'dblclick', 'click']) {
    el.addEventListener(t, (e) => window.__log.push(t + ' detail=' + e.detail + ' btn=' + e.button), true);
  }
});

const s = await W({ x: 0.5, y: 0.5, z: 0.5 });
console.log('pantalla:', JSON.stringify(s), 'canvas box:', JSON.stringify(box));
await page.mouse.move(box.x + s.x, box.y + s.y);
await page.waitForTimeout(100); await frame();
console.log('tras mover, herramienta =', await page.evaluate(() => window.form3d.editor.tool.id));
console.log('hovered =', await page.evaluate(() => JSON.stringify(window.form3d.editor.tool.hovered)));

await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(80);
console.log('tras clic 1: ctx=' + await page.evaluate(() => window.form3d.editor.contextPath.length)
  + ' sel=' + await page.evaluate(() => JSON.stringify([...window.form3d.editor.selection.instances]))
  + ' lastClick=' + await page.evaluate(() => JSON.stringify(window.form3d.editor.tool.lastClick)));
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(200);
console.log('tras clic 2: ctx=' + await page.evaluate(() => window.form3d.editor.contextPath.length)
  + ' lastClick=' + await page.evaluate(() => JSON.stringify(window.form3d.editor.tool.lastClick)));
console.log('eventos:', await page.evaluate(() => JSON.stringify(window.__log)));

// --- diagnóstico del cuadro de medidas tras un valor rechazado -------------
console.log('\n--- cuadro de medidas ---');
await reset(page);
for (const txt of ['0', '1200;800', '0', '1200;800']) {
  await page.evaluate(() => { document.activeElement?.blur?.(); });
  await page.keyboard.press('v'); await page.waitForTimeout(90);
  await reset(page);
  await page.keyboard.press('r'); await page.waitForTimeout(110);
  const t0 = await page.evaluate(() => ({ id: window.form3d.editor.tool.id, pts: window.form3d.editor.tool.points?.length }));
  const s0 = await W({ x: 0, y: 0, z: 0 });
  await page.mouse.move(box.x + s0.x, box.y + s0.y); await page.waitForTimeout(70); await frame();
  await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(130);
  const t1 = await page.evaluate(() => ({ pts: window.form3d.editor.tool.points?.length }));
  const s1 = await W({ x: 1, y: 1, z: 0 });
  await page.mouse.move(box.x + s1.x, box.y + s1.y); await page.waitForTimeout(70); await frame();
  const st = await page.evaluate(() => ({
    dis: document.querySelector('.vcb input').disabled,
    lab: document.querySelector('.vcb label').textContent,
    val: document.querySelector('.vcb input').value,
    pts: window.form3d.editor.tool.points?.length,
    act: document.activeElement.className || document.activeElement.tagName,
  }));
  console.log(`"${txt}" antes=${JSON.stringify(t0)} trasClic=${JSON.stringify(t1)} vcb=${JSON.stringify(st)}`);
  if (!st.dis) {
    await page.fill('.vcb input', txt);
    await page.press('.vcb input', 'Enter'); await page.waitForTimeout(220);
    console.log('   → ' + await page.evaluate(() => document.querySelector('.status-text').textContent).then((x) => x.slice(0, 60))
      + ' | stats ' + JSON.stringify(await page.evaluate(() => window.form3d.editor.model.stats())));
  }
  await page.keyboard.press('Escape'); await page.waitForTimeout(90);
}

summary(results, errs);
await browser.close();
