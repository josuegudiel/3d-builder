import { chromium } from 'playwright';

export async function open(url = 'http://127.0.0.1:4197/') {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  page.on('dialog', (d) => { d.accept(d.type() === 'prompt' ? (d.defaultValue() || 'X') : undefined).catch(() => {}); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  const box = await page.locator('canvas').boundingBox();
  const results = [];
  const check = (n, c, d = '') => {
    results.push([n, !!c, d]);
    console.log((c ? '  ok  ' : ' FAIL ') + n + (d ? '  — ' + d : ''));
  };
  const frame = () => page.screenshot({ path: '/dev/null' }).catch(() => {});
  return { browser, page, errs, box, check, results, frame };
}

export async function reset(page) {
  await page.evaluate(() => {
    const app = window.form3d;
    app.editor.replaceModel(new (app.editor.model.constructor)());
    app.viewport.cameraCtl.fromJSON({
      target: [0, 0, 0], distance: 12, azimuth: -2.356194490192345,
      elevation: 0.8796459430051422, mode: 'perspective', fov: 35,
    });
    app.viewport.invalidate();
  });
  await page.waitForTimeout(120);
}

export function summary(results, errs) {
  const bad = results.filter((r) => !r[1]);
  console.log('\n=== ' + (results.length - bad.length) + '/' + results.length + ' ok ===');
  if (errs.length) console.log('ERRORES DE PAGINA:\n' + [...new Set(errs)].join('\n'));
}
