/**
 * Sistema de ángulos y uniones, comprobado sobre la aplicación construida.
 *
 * Reproduce el caso del que salió la funcionalidad: dos 2×4 que se cruzan
 * tienen que unirse en una sola pieza y decir con qué ángulo hay que cortar
 * cada extremo.
 *
 *   node tests/e2e/angles.mjs [url]
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

const ok = [];
const check = (n, c, d = '') => { ok.push([n, c, d]); console.log((c ? '✓' : '✗') + ' ' + n + (d ? ' — ' + d : '')); };
const near = (a, b, eps = 1e-4) => typeof a === 'number' && Math.abs(a - b) <= eps;

const IN = 0.0254;
const LARGO = 2.4;
const ANCHO = 3.5 * IN;
const GRUESO = 1.5 * IN;

const reset = () => page.evaluate(() => {
  const app = window.form3d;
  app.editor.replaceModel(new (app.editor.model.constructor)());
});

/**
 * Inserta un 2×4 apoyado en el origen y lo gira `rotDeg` alrededor de Z.
 * `shift` lo desplaza después, para poder solapar dos piezas a voluntad.
 */
const board = (rotDeg, shift = [0, 0, 0]) => page.evaluate(([rot, sh, largo, ancho, grueso]) => {
  const api = window.form3d.api;
  api.solid('box', { width: largo, depth: ancho, height: grueso });
  const id = api.instances().at(-1);
  api.resetTransform(id);
  if (rot !== 0) api.rotate({ instances: [id] }, api.p(0, 0, 1), rot, api.p(0, 0, 0));
  if (sh[0] || sh[1] || sh[2]) api.move({ instances: [id] }, api.p(sh[0], sh[1], sh[2]));
  return id;
}, [rotDeg, shift, LARGO, ANCHO, GRUESO]);

// ---------------------------------------------------------------------------
// 1. La herramienta Ángulo
// ---------------------------------------------------------------------------
const hasTool = await page.evaluate(() =>
  [...document.querySelectorAll('.tool-btn')]
    .some((b) => (b.dataset.tip || b.getAttribute('aria-label') || '').includes('Ángulo')));
check('la herramienta Ángulo está en la barra', hasTool);

await page.keyboard.press('n');
await page.waitForTimeout(150);
const active = await page.evaluate(() => window.form3d.editor.tool?.id);
check('la tecla N activa la herramienta Ángulo', active === 'angle', `activa=${active}`);
await page.keyboard.press('v');
await page.waitForTimeout(80);

// ---------------------------------------------------------------------------
// 2. Diedros de una caja
// ---------------------------------------------------------------------------
await reset();
await page.waitForTimeout(150);
const dihedrals = await page.evaluate(() => {
  const app = window.form3d;
  app.api.solid('box', { width: 1, depth: 1, height: 1 });
  const id = app.api.instances().at(-1);
  app.editor.enterContext(id);
  const out = [...app.editor.geometry.edges.keys()].map((e) => app.api.dihedral(e));
  app.editor.exitContext();
  return out;
});
check('los doce cantos de la caja miden 90°',
  dihedrals.length === 12 && dihedrals.every((d) => near(d, 90, 1e-6)),
  `${dihedrals.length} aristas, primera ${dihedrals[0]}`);

// ---------------------------------------------------------------------------
// 3. Dos 2×4 en escuadra
// ---------------------------------------------------------------------------
await reset();
await page.waitForTimeout(150);
const a = await board(0);
const b = await board(90, [ANCHO, 0, 0]);
await page.waitForTimeout(200);

let joint = await page.evaluate(([x, y]) => window.form3d.api.jointAngles(x, y), [a, b]);
check('la unión en escuadra mide 90°', near(joint.angle, 90, 1e-6), `${joint.angle}°`);
check('el inglete es de 45° en las dos piezas',
  near(joint.cuts[0].miter, 45, 1e-6) && near(joint.cuts[1].miter, 45, 1e-6),
  `${joint.cuts[0].miter}° / ${joint.cuts[1].miter}°`);
check('el bisel es nulo con las caras en el mismo plano',
  near(joint.cuts[0].bevel, 0, 1e-6) && joint.sameFacePlane === true,
  `bisel ${joint.cuts[0].bevel}°`);
check('se reconoce como esquina', joint.kind === 'esquina', joint.kind);
check('los ejes se cortan de verdad', near(joint.gap, 0, 1e-9), `separación ${joint.gap}`);

const text = await page.evaluate(([x, y]) => window.form3d.api.jointText(x, y), [a, b]);
check('el texto de la unión menciona el inglete',
  /Esquina/.test(text) && /inglete/.test(text), text);

const memberText = await page.evaluate(([x]) => window.form3d.api.memberText(x), [a]);
check('la pieza se reconoce como 2×4', /2×4/.test(memberText), memberText);

// ---------------------------------------------------------------------------
// 4. Unir de verdad
// ---------------------------------------------------------------------------
const before = await page.evaluate(() => window.form3d.api.instances().length);
const union = await page.evaluate(([x, y]) => {
  const r = window.form3d.api.union(x, y);
  return { ok: r.ok, solid: r.solid, id: r.instanceId, message: r.message };
}, [a, b]);
await page.waitForTimeout(300);
const after = await page.evaluate(() => window.form3d.api.instances().length);
check('unir deja un solo grupo', union.ok && before === 2 && after === 1,
  `${before} → ${after} ${union.message}`);
check('el resultado es un sólido cerrado', union.solid === true);

const vol = await page.evaluate((id) => window.form3d.api.groupVolume(id), union.id);
const esperado = 2 * LARGO * ANCHO * GRUESO - ANCHO * ANCHO * GRUESO;
check('el volumen de la unión descuenta el solape',
  near(vol, esperado, 1e-9), `${vol} vs ${esperado}`);

const validez = await page.evaluate(() => {
  const app = window.form3d;
  const id = app.api.instances()[0];
  app.editor.enterContext(id);
  const errores = app.api.validate();
  app.editor.exitContext();
  return errores;
});
check('la geometría unida es válida', validez.length === 0, validez.slice(0, 2).join(' | '));

// ---------------------------------------------------------------------------
// 5. Deshacer devuelve las dos piezas
// ---------------------------------------------------------------------------
await page.keyboard.press('Control+z');
await page.waitForTimeout(350);
const undone = await page.evaluate(() => window.form3d.api.instances().length);
check('deshacer devuelve las dos piezas', undone === 2, `${undone} grupos`);

// ---------------------------------------------------------------------------
// 6. Otros ángulos de unión
// ---------------------------------------------------------------------------
for (const [ang, inglete] of [[45, 67.5], [120, 30], [135, 22.5]]) {
  await reset();
  await page.waitForTimeout(120);
  const p = await board(0);
  const q = await board(ang);
  await page.waitForTimeout(150);
  joint = await page.evaluate(([x, y]) => window.form3d.api.jointAngles(x, y), [p, q]);
  check(`unión de ${ang}° → inglete ${inglete}°`,
    near(joint.angle, ang, 1e-4) && near(joint.cuts[0].miter, inglete, 1e-4),
    `${joint?.angle}° / ${joint?.cuts[0].miter}°`);
}

// ---------------------------------------------------------------------------
// 7. Restar e intersecar
// ---------------------------------------------------------------------------
await reset();
await page.waitForTimeout(120);
const resta = await page.evaluate(() => {
  const api = window.form3d.api;
  api.solid('box', { width: 1, depth: 1, height: 1 });
  const x = api.instances().at(-1);
  api.resetTransform(x);
  api.solid('box', { width: 0.5, depth: 0.5, height: 2 });
  const y = api.instances().at(-1);
  api.resetTransform(y);
  api.move({ instances: [y] }, api.p(0.25, 0.25, 0.5));
  const r = api.subtract(x, y);
  return { ok: r.ok, vol: r.instanceId !== null ? api.groupVolume(r.instanceId) : 0 };
});
check('restar quita el volumen del hueco', resta.ok && near(resta.vol, 1 - 0.5 * 0.5 * 0.5, 1e-9),
  `${resta.vol}`);

await reset();
await page.waitForTimeout(120);
const inter = await page.evaluate(() => {
  const api = window.form3d.api;
  api.solid('box', { width: 1, depth: 1, height: 1 });
  const x = api.instances().at(-1);
  api.resetTransform(x);
  api.solid('box', { width: 1, depth: 1, height: 1 });
  const y = api.instances().at(-1);
  api.resetTransform(y);
  api.move({ instances: [y] }, api.p(0.5, 0.5, 0.5));
  const r = api.intersectSolids(x, y);
  return { ok: r.ok, vol: r.instanceId !== null ? api.groupVolume(r.instanceId) : 0 };
});
check('intersecar deja sólo la parte común', inter.ok && near(inter.vol, 0.125, 1e-9), `${inter.vol}`);

// ---------------------------------------------------------------------------
// 8. Panel de información
// ---------------------------------------------------------------------------
await reset();
await page.waitForTimeout(120);
const p1 = await board(0);
const p2 = await board(90, [ANCHO, 0, 0]);
await page.evaluate(([x, y]) => window.form3d.api.select({ instances: [x, y] }), [p1, p2]);
await page.waitForTimeout(300);
const panel = await page.evaluate(() =>
  [...document.querySelectorAll('.card')]
    .map((c) => c.textContent)
    .find((t) => t.startsWith('Información')) ?? '');
check('el panel muestra la unión y la escuadría',
  /Unión/.test(panel) && /2×4/.test(panel) && /inglete/.test(panel),
  panel.replace(/\s+/g, ' ').slice(0, 160));

// ---------------------------------------------------------------------------
// 9. Cota angular
// ---------------------------------------------------------------------------
await reset();
await page.waitForTimeout(120);
const dimCount = await page.evaluate(() => {
  const api = window.form3d.api;
  api.angleDimension(api.p(0, 0, 0), api.p(1, 0, 0), api.p(0, 1, 0));
  return window.form3d.editor.model.angleDimensions.size;
});
check('la cota angular se guarda en el modelo', dimCount === 1, `${dimCount}`);

// Los textos los coloca un bucle de animación: sin un fotograma real no se
// dibujan, y en este navegador sin compositor sólo lo fuerza una captura.
await page.screenshot();
await page.waitForTimeout(200);

const labelText = await page.evaluate(() =>
  [...document.querySelectorAll('.dim-label')].map((d) => d.textContent).filter(Boolean));
check('la cota angular se dibuja con su valor',
  labelText.some((t) => /90/.test(t)), JSON.stringify(labelText));

const roundTrip = await page.evaluate(() => {
  const api = window.form3d.api;
  return api.parseJSON(api.toJSON()).angleDimensions.size;
});
check('la cota angular sobrevive a guardar y cargar', roundTrip === 1, `${roundTrip}`);

// ---------------------------------------------------------------------------
// 10. Menú de sólidos
// ---------------------------------------------------------------------------
const menu = await page.evaluate(() => {
  const m = [...document.querySelectorAll('.menu')]
    .find((x) => x.querySelector('button')?.textContent.trim() === 'Sólidos');
  if (!m) return null;
  return [...m.querySelectorAll('.menu-item')].map((i) => i.textContent.trim());
});
check('el menú Sólidos ofrece unir, restar e intersecar',
  menu !== null && ['Unir', 'Restar', 'Intersecar', 'Medir la unión']
    .every((l) => menu.some((i) => i.startsWith(l))),
  JSON.stringify(menu));

// El informe se abre desde el menú con dos grupos seleccionados.
await reset();
await page.waitForTimeout(120);
const m1 = await board(0);
const m2 = await board(90, [ANCHO, 0, 0]);
await page.evaluate(([x, y]) => window.form3d.api.select({ instances: [x, y] }), [m1, m2]);
await page.waitForTimeout(150);
await page.evaluate(() => {
  const m = [...document.querySelectorAll('.menu')]
    .find((x) => x.querySelector('button')?.textContent.trim() === 'Sólidos');
  [...m.querySelectorAll('.menu-item')].find((i) => i.textContent.startsWith('Medir la unión')).click();
});
await page.waitForTimeout(300);
const modal = await page.evaluate(() => document.querySelector('.modal')?.textContent ?? '');
check('el informe de la unión detalla el corte de cada pieza',
  /Unión entre piezas/.test(modal) && /Pieza 1 · corte/.test(modal) && /inglete/.test(modal),
  modal.replace(/\s+/g, ' ').slice(0, 140));
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// ---------------------------------------------------------------------------
// 11. Sin errores
// ---------------------------------------------------------------------------
check('sin errores de consola', errs.length === 0, errs.slice(0, 3).join(' | '));

const bad = ok.filter((o) => !o[1]);
console.log(`\n${ok.length - bad.length}/${ok.length} correctas`);
await browser.close();
process.exit(bad.length ? 1 : 0);
