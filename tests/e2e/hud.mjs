/**
 * El cartel que sigue al cursor: qué enseña mientras se dibuja (medida y
 * ángulo), que refleja lo que se teclea y que no se sale del lienzo. Y la
 * entrada polar "longitud;ángulo" de la herramienta Línea, que es la que
 * permite replantear un faldón sin calcular las coordenadas a mano.
 *
 *   node tests/e2e/hud.mjs [url]
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(process.argv[2] ?? 'http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);

const box = await page.locator('canvas').boundingBox();
const ok = [];
const check = (n, c, d = '') => { ok.push([n, c, d]); console.log((c ? '✓' : '✗') + ' ' + n + (d ? ' — ' + d : '')); };

const hud = () => page.evaluate(() => {
  const el = document.querySelector('.cursor-hud');
  return {
    visible: el.classList.contains('visible'),
    snap: el.querySelector('.hud-snap').textContent,
    filas: [...el.querySelectorAll('.hud-row')].map((r) => ({
      label: r.querySelector('.hud-label').textContent,
      value: r.querySelector('.hud-value').textContent,
      typing: r.querySelector('.hud-value').classList.contains('typing'),
    })),
    rect: el.getBoundingClientRect().toJSON(),
  };
});
const limpiar = () => page.evaluate(() => {
  const e = window.form3d.editor;
  e.replaceModel(new (e.model.constructor)());
});

// 1. Rectángulo: el cartel enseña los dos lados junto al cursor.
await page.keyboard.press('r'); await page.waitForTimeout(80);
await page.mouse.click(box.x + 400, box.y + 420); await page.waitForTimeout(80);
await page.mouse.move(box.x + 620, box.y + 320); await page.waitForTimeout(150);
let h = await hud();
check('el cartel aparece al dibujar', h.visible, JSON.stringify(h.filas));
check('el rectángulo enseña sus dos lados', h.filas.length === 1 && /;/.test(h.filas[0].value), JSON.stringify(h.filas));
const cerca = Math.abs(h.rect.x - (box.x + 620)) < 260 && Math.abs(h.rect.y - (box.y + 320)) < 260;
check('el cartel va junto al cursor', cerca, JSON.stringify(h.rect));

// 2. Lo tecleado se ve en el cartel, no sólo abajo.
await page.keyboard.press('3'); await page.waitForTimeout(120);
h = await hud();
check('lo tecleado se ve en el cartel', h.filas.some((f) => f.typing && f.value === '3'), JSON.stringify(h.filas));
await page.keyboard.press('0'); await page.waitForTimeout(120);
h = await hud();
check('el cartel sigue lo que se escribe', h.filas.some((f) => f.typing && f.value === '30'), JSON.stringify(h.filas));
await page.keyboard.press('Escape'); await page.waitForTimeout(80);
await page.keyboard.press('Escape'); await page.waitForTimeout(120);

// 3. Línea, primer segmento: longitud e inclinación sobre la horizontal.
await limpiar(); await page.waitForTimeout(120);
await page.keyboard.press('l'); await page.waitForTimeout(80);
await page.mouse.click(box.x + 420, box.y + 430); await page.waitForTimeout(100);
await page.mouse.move(box.x + 640, box.y + 380); await page.waitForTimeout(150);
h = await hud();
const etiquetas = h.filas.map((f) => f.label);
check('la línea enseña longitud y ángulo a la vez',
  etiquetas.includes('Longitud') && (etiquetas.includes('Inclinación') || etiquetas.includes('Ángulo')),
  JSON.stringify(etiquetas));

// 4. Entrada polar: 3 m a 30° sobre la horizontal.
await page.fill('.vcb input', '3000;30');
await page.press('.vcb input', 'Enter');
await page.waitForTimeout(250);
const seg = await page.evaluate(() => {
  const g = window.form3d.editor.geometry;
  const e = [...g.edges.values()][0];
  if (!e) return null;
  const a = g.vertexPos(e.a); const b = g.vertexPos(e.b);
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  return {
    largo: Math.hypot(d.x, d.y, d.z),
    inclinacion: Math.atan2(d.z, Math.hypot(d.x, d.y)) * 180 / Math.PI,
  };
});
check('"longitud;ángulo" fija el largo', seg !== null && Math.abs(seg.largo - 3) < 1e-6, JSON.stringify(seg));
check('"longitud;ángulo" fija la pendiente', seg !== null && Math.abs(Math.abs(seg.inclinacion) - 30) < 1e-6, JSON.stringify(seg));

// 5. Segundo segmento: la lectura pasa a ser el giro en el vértice.
await page.mouse.move(box.x + 700, box.y + 300); await page.waitForTimeout(150);
h = await hud();
check('encadenando se mide el ángulo del vértice',
  h.filas.some((f) => f.label === 'Ángulo'), JSON.stringify(h.filas.map((f) => f.label)));
await page.keyboard.press('Escape'); await page.waitForTimeout(100);

// 6. El cartel no se sale por el borde derecho ni por abajo.
await page.keyboard.press('r'); await page.waitForTimeout(80);
await page.mouse.click(box.x + 200, box.y + 200); await page.waitForTimeout(80);
await page.mouse.move(box.x + box.width - 12, box.y + box.height - 12); await page.waitForTimeout(180);
h = await hud();
const dentro = h.rect.x + h.rect.width <= box.x + box.width + 1
  && h.rect.y + h.rect.height <= box.y + box.height + 1;
check('el cartel se aparta del borde', dentro, JSON.stringify({ hud: h.rect, lienzo: box }));
await page.keyboard.press('Escape'); await page.waitForTimeout(100);

// 7. Empujar/tirar hacia abajo hunde la cara (no sólo extruye hacia fuera).
await limpiar(); await page.waitForTimeout(120);
await page.keyboard.press('r'); await page.waitForTimeout(80);
await page.mouse.click(box.x + 500, box.y + 400); await page.waitForTimeout(80);
await page.mouse.move(box.x + 640, box.y + 330); await page.waitForTimeout(80);
await page.fill('.vcb input', '2000;2000'); await page.press('.vcb input', 'Enter'); await page.waitForTimeout(250);
await page.keyboard.press('p'); await page.waitForTimeout(80);
await page.mouse.click(box.x + 560, box.y + 372); await page.waitForTimeout(120);
await page.fill('.vcb input', '1000'); await page.press('.vcb input', 'Enter'); await page.waitForTimeout(300);
const caja1 = await page.evaluate(() => window.form3d.editor.model.visibleStats());
check('extruir crea el volumen', caja1.faces >= 6, JSON.stringify(caja1));

const alturas = () => page.evaluate(() => {
  const g = window.form3d.editor.geometry;
  const z = [...g.vertices.keys()].map((id) => g.vertexPos(id).z);
  return { min: Math.min(...z), max: Math.max(...z) };
});
const antes = await alturas();
// Se hunde la cara superior: se arrastra hacia abajo y se teclea la distancia.
await page.mouse.move(box.x + 560, box.y + 340); await page.waitForTimeout(80);
await page.mouse.down(); await page.mouse.move(box.x + 560, box.y + 420, { steps: 6 }); await page.waitForTimeout(120);
await page.mouse.up(); await page.waitForTimeout(250);
const despues = await alturas();
check('empujar hacia abajo baja la cara', despues.max < antes.max - 1e-9,
  JSON.stringify({ antes, despues }));

check('sin excepciones en toda la sesión', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();
const fallos = ok.filter(([, c]) => !c);
console.log(`\n${ok.length - fallos.length}/${ok.length} comprobaciones correctas`);
process.exit(fallos.length ? 1 : 0);
