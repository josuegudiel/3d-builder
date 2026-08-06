/**
 * Prueba de extremo a extremo: abre la aplicación en un navegador real,
 * dibuja un rectángulo con medidas exactas, lo extruye y comprueba que la
 * geometría resultante es la esperada.
 *
 * Se ejecuta con:  node tests/e2e/smoke.mjs [url]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(HERE, '../../.shots');
mkdirSync(SHOTS, { recursive: true });

const URL_BASE = process.argv[2] ?? 'http://localhost:5173/';

const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  results.push({ name, ok: !!condition, detail });
  if (!condition) failures++;
  const mark = condition ? '✓' : '✗';
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function shot(page, name) {
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`) });
}

/** Estado del modelo leído desde la propia aplicación. */
async function modelState(page) {
  return page.evaluate(() => {
    const app = window.form3d;
    const geo = app.editor.geometry;
    const orient = window.__form3dOrient;
    const faces = [...geo.faces.keys()];
    return {
      stats: app.editor.model.stats(),
      faceCount: geo.faces.size,
      edgeCount: geo.edges.size,
      vertexCount: geo.vertices.size,
      volume: orient ? Math.abs(orient.shellVolume(geo, faces)) : null,
      isSolid: orient ? orient.isSolid(geo, faces) : null,
      invariants: geo.validate(),
      bounds: (() => {
        let min = [Infinity, Infinity, Infinity];
        let max = [-Infinity, -Infinity, -Infinity];
        for (const v of geo.vertices.values()) {
          min = [Math.min(min[0], v.p.x), Math.min(min[1], v.p.y), Math.min(min[2], v.p.z)];
          max = [Math.max(max[0], v.p.x), Math.max(max[1], v.p.y), Math.max(max[2], v.p.z)];
        }
        return { min, max };
      })(),
    };
  });
}

/** Escribe en el cuadro de medidas y confirma con Intro. */
async function typeMeasurement(page, text) {
  await page.fill('.vcb input', text);
  await page.press('.vcb input', 'Enter');
  await page.waitForTimeout(120);
}

async function clickCanvas(page, x, y, options = {}) {
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.move(box.x + x, box.y + y);
  await page.waitForTimeout(60);
  await page.mouse.click(box.x + x, box.y + y, options);
  await page.waitForTimeout(120);
}

async function moveCanvas(page, x, y) {
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.move(box.x + x, box.y + y);
  await page.waitForTimeout(80);
}

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

  console.log(`\nAbriendo ${URL_BASE}`);
  await page.goto(URL_BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  // Exponer utilidades del kernel para las comprobaciones.
  await page.addScriptTag({
    type: 'module',
    content: `
      import * as orient from '/src/core/topology/orient.ts';
      window.__form3dOrient = orient;
    `,
  });
  await page.waitForTimeout(400);

  console.log('\n1. Arranque');
  check(page, true);
  results.pop();
  check('la aplicación se monta', await page.locator('canvas').count() === 1);
  check('la barra de herramientas tiene botones',
    (await page.locator('.tool-btn').count()) >= 15,
    `${await page.locator('.tool-btn').count()} herramientas`);
  check('sin errores de consola al arrancar', consoleErrors.length === 0, consoleErrors.join(' | '));
  await shot(page, '01-inicio');

  // -------------------------------------------------------------------------
  console.log('\n2. Rectángulo con medidas exactas (4000 × 3000 mm)');
  await page.keyboard.press('r');
  await page.waitForTimeout(100);
  await clickCanvas(page, 620, 520);
  await moveCanvas(page, 800, 420);
  await typeMeasurement(page, '4000;3000');

  let state = await modelState(page);
  check('se ha creado una cara', state.faceCount === 1, `caras=${state.faceCount}`);
  check('tiene 4 aristas', state.edgeCount === 4, `aristas=${state.edgeCount}`);
  const size = [
    state.bounds.max[0] - state.bounds.min[0],
    state.bounds.max[1] - state.bounds.min[1],
  ];
  check('las medidas son exactas 4 × 3 m',
    Math.abs(Math.max(...size) - 4) < 1e-9 && Math.abs(Math.min(...size) - 3) < 1e-9,
    `${size.map((v) => v.toFixed(6)).join(' × ')} m`);
  check('invariantes intactos', state.invariants.length === 0, state.invariants.join('; '));
  await shot(page, '02-rectangulo');

  // -------------------------------------------------------------------------
  console.log('\n3. Empujar/tirar con altura exacta (2500 mm)');
  await page.keyboard.press('p');
  await page.waitForTimeout(100);
  await clickCanvas(page, 700, 480);
  await moveCanvas(page, 700, 380);
  await typeMeasurement(page, '2500');

  state = await modelState(page);
  check('la caja tiene 6 caras', state.faceCount === 6, `caras=${state.faceCount}`);
  check('la caja tiene 12 aristas', state.edgeCount === 12, `aristas=${state.edgeCount}`);
  check('la caja tiene 8 vértices', state.vertexCount === 8, `vértices=${state.vertexCount}`);
  check('es un sólido cerrado', state.isSolid === true);
  check('el volumen es 4 × 3 × 2.5 = 30 m³',
    Math.abs(state.volume - 30) < 1e-6, `${state.volume?.toFixed(6)} m³`);
  check('altura exacta 2.5 m',
    Math.abs((state.bounds.max[2] - state.bounds.min[2]) - 2.5) < 1e-9,
    `${(state.bounds.max[2] - state.bounds.min[2]).toFixed(6)} m`);
  check('invariantes intactos tras extruir', state.invariants.length === 0, state.invariants.join('; '));
  await shot(page, '03-caja');

  // -------------------------------------------------------------------------
  console.log('\n4. Deshacer y rehacer');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  state = await modelState(page);
  check('deshacer devuelve al rectángulo', state.faceCount === 1, `caras=${state.faceCount}`);
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(250);
  state = await modelState(page);
  check('rehacer restaura la caja', state.faceCount === 6, `caras=${state.faceCount}`);

  // -------------------------------------------------------------------------
  console.log('\n5. Dibujar una línea sobre una cara para dividirla');
  await page.keyboard.press('Shift+z'); // encajar
  await page.waitForTimeout(300);
  const before = await modelState(page);
  await page.keyboard.press('l');
  await page.waitForTimeout(100);

  // Se buscan dos puntos medios de aristas de la cara superior mediante la API.
  const midpoints = await page.evaluate(() => {
    const app = window.form3d;
    const geo = app.editor.geometry;
    // Cara superior: la de mayor z medio.
    let best = null;
    let bestZ = -Infinity;
    for (const f of geo.faces.values()) {
      const pts = f.loops[0].vertices.map((v) => geo.vertexPos(v));
      const z = pts.reduce((a, p) => a + p.z, 0) / pts.length;
      if (z > bestZ) { bestZ = z; best = f; }
    }
    const pts = best.loops[0].vertices.map((v) => geo.vertexPos(v));
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
    const m0 = mid(pts[0], pts[1]);
    const m1 = mid(pts[2], pts[3]);
    const s0 = app.viewport.worldToScreen(m0);
    const s1 = app.viewport.worldToScreen(m1);
    return [[s0.x, s0.y], [s1.x, s1.y]];
  });

  await clickCanvas(page, midpoints[0][0], midpoints[0][1]);
  await clickCanvas(page, midpoints[1][0], midpoints[1][1]);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  state = await modelState(page);
  check('la cara superior se ha dividido en dos',
    state.faceCount === before.faceCount + 1,
    `${before.faceCount} → ${state.faceCount} caras`);
  check('invariantes intactos tras dividir', state.invariants.length === 0, state.invariants.join('; '));
  await shot(page, '04-dividida');

  // -------------------------------------------------------------------------
  console.log('\n6. Empujar una de las mitades');
  const halfPoint = await page.evaluate(() => {
    const app = window.form3d;
    const geo = app.editor.geometry;
    let best = null;
    let bestZ = -Infinity;
    for (const f of geo.faces.values()) {
      const pts = f.loops[0].vertices.map((v) => geo.vertexPos(v));
      const z = pts.reduce((a, p) => a + p.z, 0) / pts.length;
      if (z > bestZ + 1e-9) { bestZ = z; best = f; }
    }
    const pts = best.loops[0].vertices.map((v) => geo.vertexPos(v));
    const c = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length, z: a.z + p.z / pts.length }), { x: 0, y: 0, z: 0 });
    const s = app.viewport.worldToScreen(c);
    return [s.x, s.y];
  });
  await page.keyboard.press('p');
  await page.waitForTimeout(100);
  await clickCanvas(page, halfPoint[0], halfPoint[1]);
  await moveCanvas(page, halfPoint[0], halfPoint[1] - 60);
  await typeMeasurement(page, '1000');

  state = await modelState(page);
  check('el volumen crece en 4×1.5×1 = 6 m³ aprox.',
    Math.abs(state.volume - 36) < 1e-5, `${state.volume?.toFixed(6)} m³`);
  check('sigue siendo un sólido', state.isSolid === true);
  check('invariantes intactos', state.invariants.length === 0, state.invariants.join('; '));
  await shot(page, '05-escalon');

  // -------------------------------------------------------------------------
  console.log('\n7. Círculo con radio exacto y extrusión');
  await page.evaluate(() => window.form3d.editor.replaceModel(new (window.form3d.editor.model.constructor)()));
  await page.waitForTimeout(200);
  await page.keyboard.press('c');
  await page.waitForTimeout(100);
  await clickCanvas(page, 700, 480);
  await moveCanvas(page, 800, 480);
  await typeMeasurement(page, '1500');

  state = await modelState(page);
  check('el círculo genera una cara', state.faceCount === 1, `caras=${state.faceCount}`);
  const radius = await page.evaluate(() => {
    const geo = window.form3d.editor.geometry;
    let max = 0;
    let cx = 0; let cy = 0; let n = 0;
    for (const v of geo.vertices.values()) { cx += v.p.x; cy += v.p.y; n++; }
    cx /= n; cy /= n;
    for (const v of geo.vertices.values()) {
      max = Math.max(max, Math.hypot(v.p.x - cx, v.p.y - cy));
    }
    return max;
  });
  check('radio exacto 1.5 m', Math.abs(radius - 1.5) < 1e-9, `${radius.toFixed(9)} m`);
  await shot(page, '06-circulo');

  await page.keyboard.press('p');
  await page.waitForTimeout(100);
  await clickCanvas(page, 700, 480);
  await moveCanvas(page, 700, 400);
  await typeMeasurement(page, '2000');
  state = await modelState(page);
  const sides = await page.evaluate(() => {
    const geo = window.form3d.editor.geometry;
    return geo.vertices.size / 2;
  });
  const expectedCylinder = 0.5 * sides * 1.5 * 1.5 * Math.sin((2 * Math.PI) / sides) * 2;
  check('el prisma tiene exactamente 24 lados', sides === 24, `${sides} lados`);
  check('el volumen coincide con la fórmula del prisma regular',
    Math.abs(state.volume - expectedCylinder) < 1e-6,
    `${state.volume?.toFixed(6)} vs ${expectedCylinder.toFixed(6)} m³`);
  check('invariantes intactos', state.invariants.length === 0, state.invariants.join('; '));
  await shot(page, '07-cilindro');

  // -------------------------------------------------------------------------
  console.log('\n8. Agrupar y entrar en el grupo');
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+g');
  await page.waitForTimeout(300);
  const grouped = await page.evaluate(() => {
    const app = window.form3d;
    return {
      instances: app.editor.geometry.instances.size,
      rootFaces: app.editor.geometry.faces.size,
      definitions: app.editor.model.definitions.size,
    };
  });
  check('se ha creado un grupo', grouped.instances === 1, `instancias=${grouped.instances}`);
  check('la geometría se ha movido dentro', grouped.rootFaces === 0, `caras en la raíz=${grouped.rootFaces}`);
  await shot(page, '08-grupo');

  // -------------------------------------------------------------------------
  console.log('\n9. Exportación y guardado');
  const exports = await page.evaluate(async () => {
    const app = window.form3d;
    const [{ exportOBJ }, { exportSTLAscii }, { serializeToJSON, deserializeModel }] = await Promise.all([
      import('/src/core/io/obj.ts'),
      import('/src/core/io/stl.ts'),
      import('/src/core/io/serialize.ts'),
    ]);
    const obj = exportOBJ(app.editor.model).obj;
    const stl = exportSTLAscii(app.editor.model);
    const json = serializeToJSON(app.editor.model);
    const round = deserializeModel(json);
    return {
      objFaces: (obj.match(/^f /gm) || []).length,
      stlFacets: (stl.match(/facet normal/g) || []).length,
      jsonLength: json.length,
      roundTrip: JSON.stringify(round.stats()) === JSON.stringify(app.editor.model.stats()),
    };
  });
  check('OBJ contiene triángulos', exports.objFaces > 0, `${exports.objFaces} caras`);
  check('STL contiene facetas', exports.stlFacets === exports.objFaces, `${exports.stlFacets} facetas`);
  check('el ciclo guardar/cargar conserva el modelo', exports.roundTrip);

  // -------------------------------------------------------------------------
  console.log('\n10. Elementos del entorno: cada capa debe pintar píxeles');

  /**
   * Cuenta los colores distintos del lienzo. Sirve para detectar capas que se
   * envían a dibujar pero no llegan a rasterizar ningún fragmento — un fallo
   * que ninguna prueba unitaria puede ver.
   */
  const paletteSize = () => page.evaluate(() => {
    const vp = window.form3d.viewport;
    vp.forceRender();
    const cvs = vp.renderer.domElement;
    const tmp = document.createElement('canvas');
    tmp.width = cvs.width;
    tmp.height = cvs.height;
    const ctx = tmp.getContext('2d');
    ctx.drawImage(cvs, 0, 0);
    const d = ctx.getImageData(0, 0, cvs.width, cvs.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]}`);
    return seen.size;
  });

  const setLayer = (name, value) => page.evaluate(([n, v]) => {
    window.form3d.viewport.options[n] = v;
    window.form3d.viewport.invalidate();
  }, [name, value]);

  await page.evaluate(() => window.form3d.editor.replaceModel(new (window.form3d.editor.model.constructor)()));
  await page.waitForTimeout(200);

  for (const layer of ['showGrid', 'showAxes', 'showGround']) {
    await setLayer(layer, false);
    await page.waitForTimeout(150);
    const without = await paletteSize();
    await setLayer(layer, true);
    await page.waitForTimeout(150);
    const with_ = await paletteSize();
    check(`la capa ${layer} cambia lo que se dibuja`, with_ !== without,
      `${without} colores sin ella, ${with_} con ella`);
  }
  await shot(page, '10-entorno');

  // -------------------------------------------------------------------------
  console.log('\n11. Estado final');
  check('sin errores de consola en toda la sesión',
    consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  await shot(page, '09-final');
  await browser.close();

  console.log(`\n${results.length - failures}/${results.length} comprobaciones correctas`);
  if (failures > 0) {
    console.log('\nFALLOS:');
    for (const r of results.filter((r) => !r.ok)) console.log(`  - ${r.name} ${r.detail}`);
    process.exit(1);
  }
  console.log('Todo correcto.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
