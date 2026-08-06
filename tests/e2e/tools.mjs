/**
 * Prueba de extremo a extremo de las HERRAMIENTAS que `smoke.mjs` no cubre:
 * Mover, Copiar, Rotar, Escalar, Equidistancia, Borrar, Pintar, Acotar, Metro,
 * Arco, Polígono, grupos, inferencia y deshacer profundo.
 *
 * Cada bloque parte de un modelo vacío y termina comprobando los invariantes
 * de la geometría y que no se hayan producido errores de consola.
 *
 * Se ejecuta con:  node tests/e2e/tools.mjs [url]
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
let currentBlock = '';

function check(name, condition, detail = '') {
  results.push({ block: currentBlock, name, ok: !!condition, detail });
  if (!condition) failures++;
  const mark = condition ? '✓' : '✗';
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`);
}

function note(text) {
  console.log(`    · ${text}`);
}

async function shot(page, name) {
  await page.screenshot({ path: resolve(SHOTS, `tools-${name}.png`) });
}

/** Estado del modelo leído desde la propia aplicación. */
async function modelState(page) {
  return page.evaluate(() => {
    const app = window.form3d;
    const ed = app.editor;
    const geo = ed.geometry;

    const invariants = [];
    for (const d of ed.model.definitions.values()) {
      for (const e of d.geometry.validate()) invariants.push(`[${d.name}] ${e}`);
    }

    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (const v of geo.vertices.values()) {
      min = [Math.min(min[0], v.p.x), Math.min(min[1], v.p.y), Math.min(min[2], v.p.z)];
      max = [Math.max(max[0], v.p.x), Math.max(max[1], v.p.y), Math.max(max[2], v.p.z)];
    }

    return {
      faceCount: geo.faces.size,
      edgeCount: geo.edges.size,
      vertexCount: geo.vertices.size,
      instanceCount: geo.instances.size,
      rootFaces: ed.model.rootGeometry.faces.size,
      rootEdges: ed.model.rootGeometry.edges.size,
      definitions: ed.model.definitions.size,
      dimensions: ed.model.dimensions.size,
      guides: ed.model.guides.size,
      contextDepth: ed.contextPath.length,
      undoDepth: ed.history.size().undo,
      selection: {
        faces: ed.selection.faces.size,
        edges: ed.selection.edges.size,
        instances: ed.selection.instances.size,
      },
      invariants,
      bounds: { min, max },
      vertices: [...geo.vertices.values()].map((v) => [v.p.x, v.p.y, v.p.z]),
    };
  });
}

function boxSize(state) {
  return [
    state.bounds.max[0] - state.bounds.min[0],
    state.bounds.max[1] - state.bounds.min[1],
    state.bounds.max[2] - state.bounds.min[2],
  ];
}

const fmt = (n) => (Number.isFinite(n) ? n.toFixed(9) : String(n));
const fmt3 = (a) => `[${a.map(fmt).join(', ')}]`;

/**
 * Escribe en el cuadro de medidas y confirma con Intro.
 * Devuelve true si la herramienta ACEPTÓ el valor (el cuadro se vacía).
 */
async function typeMeasurement(page, text) {
  const input = page.locator('.vcb input');
  if (await input.isDisabled()) {
    return { accepted: false, reason: 'el cuadro de medidas está deshabilitado' };
  }
  await input.fill(text);
  await input.press('Enter');
  await page.waitForTimeout(160);
  const value = await input.inputValue();
  return { accepted: value === '', reason: value === '' ? '' : `el cuadro conserva "${value}"` };
}

async function clickCanvas(page, x, y, options = {}) {
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.move(box.x + x, box.y + y);
  await page.waitForTimeout(60);
  await page.mouse.click(box.x + x, box.y + y, options);
  await page.waitForTimeout(140);
}

async function doubleClickCanvas(page, x, y) {
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.move(box.x + x, box.y + y);
  await page.waitForTimeout(60);
  await page.mouse.click(box.x + x, box.y + y);
  await page.waitForTimeout(90);
  await page.mouse.click(box.x + x, box.y + y);
  await page.waitForTimeout(200);
}

async function moveCanvas(page, x, y) {
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.move(box.x + x, box.y + y);
  await page.waitForTimeout(90);
}

async function focusCanvas(page) {
  await page.evaluate(() => window.form3d.viewport.renderer.domElement.focus());
  await page.waitForTimeout(40);
}

/** Coordenadas de pantalla (píxeles del lienzo) de un punto del mundo. */
async function toScreen(page, p) {
  return page.evaluate((q) => {
    const s = window.form3d.viewport.worldToScreen({ x: q[0], y: q[1], z: q[2] });
    return [s.x, s.y, s.depth];
  }, p);
}

/** Módulos del núcleo que la prueba necesita dentro de la página. */
const KERNEL_IMPORTS = `
  import * as tri from '/src/core/topology/triangulate.ts';
  import * as orient from '/src/core/topology/orient.ts';
  window.__tri = tri;
  window.__orient = orient;
`;

/** Espera a que la aplicación esté montada (protege ante una recarga de Vite). */
async function ensureApp(page) {
  await page.waitForFunction(() => !!window.form3d, null, { timeout: 20000 });
  if (!(await page.evaluate(() => !!window.__tri))) {
    await page.addScriptTag({ type: 'module', content: KERNEL_IMPORTS });
    await page.waitForTimeout(300);
  }
}

/** Reinicia el modelo y la cámara para que cada bloque parta de lo mismo. */
async function resetModel(page) {
  await ensureApp(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
  await page.evaluate(() => {
    const app = window.form3d;
    app.editor.replaceModel(new (app.editor.model.constructor)());
    const c = app.viewport.cameraCtl;
    c.setStandardView('iso');
    c.target = { x: 0, y: 0, z: 0 };
    c.distance = 20;
    c.update();
    app.viewport.invalidate();
  });
  await page.waitForTimeout(200);
  await focusCanvas(page);
}

/**
 * Dibuja un rectángulo con medidas exactas partiendo de (x0,y0) en pantalla.
 *
 * El arrastre por defecto es HORIZONTAL en pantalla a propósito: en la vista
 * isométrica las líneas de inferencia de los ejes rojo/verde salen del primer
 * vértice a ±37° y la del azul es vertical, así que un arrastre horizontal es
 * el que más lejos queda de todas ellas.
 */
async function drawRectangle(page, text, x0 = 620, y0 = 520, x1 = 800, y1 = 520) {
  await page.keyboard.press('r');
  await page.waitForTimeout(80);
  await clickCanvas(page, x0, y0);
  await moveCanvas(page, x1, y1);
  return typeMeasurement(page, text);
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
  page.on('pageerror', (err) => {
    const where = (err.stack ?? '').split('\n').slice(1, 3).map((s) => s.trim()).join(' ← ');
    consoleErrors.push(`pageerror: ${err.message}${where ? ` @ ${where}` : ''}`);
  });
  let navigations = 0;
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations++; });

  let errorMark = 0;
  let navMark = 0;
  const beginBlock = (title) => {
    currentBlock = title;
    errorMark = consoleErrors.length;
    navMark = navigations;
    console.log(`\n${title}`);
  };
  /** Comprobaciones comunes al final de cada bloque (punto 14 del encargo). */
  const endBlock = async (state) => {
    check('invariantes intactos (geometry.validate() === [])',
      state.invariants.length === 0, state.invariants.slice(0, 3).join(' | '));
    const nuevos = consoleErrors.slice(errorMark);
    check('sin errores de consola en el bloque',
      nuevos.length === 0, nuevos.slice(0, 3).join(' | '));
    if (navigations !== navMark) {
      note(`ATENCIÓN: la página se ha recargado ${navigations - navMark} vez/veces durante el bloque`);
    }
  };

  console.log(`\nAbriendo ${URL_BASE}`);
  await page.goto(URL_BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  await page.addScriptTag({ type: 'module', content: KERNEL_IMPORTS });
  await page.waitForTimeout(400);

  const booted = await page.evaluate(() => !!window.form3d && !!window.__tri);
  if (!booted) {
    console.error('La aplicación no se ha montado o no se han podido importar los módulos.');
    await browser.close();
    process.exit(1);
  }

  // ==========================================================================
  beginBlock('1. MOVER (m): rectángulo 2×2 m desplazado 1 m sobre el eje rojo');
  // ==========================================================================
  await resetModel(page);
  let r = await drawRectangle(page, '2000;2000');
  check('el rectángulo acepta "2000;2000"', r.accepted, r.reason);

  let state = await modelState(page);
  check('hay una cara de partida', state.faceCount === 1, `caras=${state.faceCount}`);
  const boundsBefore = state.bounds;

  await focusCanvas(page);
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(200);
  state = await modelState(page);
  check('Ctrl+A selecciona la geometría',
    state.selection.faces === 1 && state.selection.edges === 4,
    `caras=${state.selection.faces} aristas=${state.selection.edges}`);

  await page.keyboard.press('m');
  await page.waitForTimeout(150);
  check('la herramienta activa es Mover',
    (await page.evaluate(() => window.form3d.editor.tool.id)) === 'move');

  // Vértice de referencia: el de menor X.
  const baseVertex = await page.evaluate(() => {
    const app = window.form3d;
    let best = null;
    for (const v of app.editor.geometry.vertices.values()) {
      if (!best || v.p.x < best.x) best = v.p;
    }
    const s = app.viewport.worldToScreen(best);
    return { world: [best.x, best.y, best.z], screen: [s.x, s.y] };
  });
  await clickCanvas(page, baseVertex.screen[0], baseVertex.screen[1]);
  await focusCanvas(page);
  await page.keyboard.press('ArrowRight'); // bloquear el eje rojo
  await page.waitForTimeout(80);

  let far = await toScreen(page, [baseVertex.world[0] + 3, baseVertex.world[1], baseVertex.world[2]]);
  await moveCanvas(page, far[0], far[1]);
  r = await typeMeasurement(page, '1000');
  check('Mover acepta la distancia "1000"', r.accepted, r.reason);

  state = await modelState(page);
  const dMin = [0, 1, 2].map((i) => state.bounds.min[i] - boundsBefore.min[i]);
  const dMax = [0, 1, 2].map((i) => state.bounds.max[i] - boundsBefore.max[i]);
  check('la caja envolvente se desplaza exactamente 1 m en X',
    Math.abs(dMin[0] - 1) < 1e-9 && Math.abs(dMax[0] - 1) < 1e-9,
    `Δmin=${fmt3(dMin)} Δmax=${fmt3(dMax)}`);
  check('no hay desplazamiento en Y ni en Z',
    Math.abs(dMin[1]) < 1e-9 && Math.abs(dMin[2]) < 1e-9
    && Math.abs(dMax[1]) < 1e-9 && Math.abs(dMax[2]) < 1e-9,
    `Δmin=${fmt3(dMin)} Δmax=${fmt3(dMax)}`);
  check('la geometría no se ha duplicado al mover',
    state.faceCount === 1 && state.edgeCount === 4,
    `caras=${state.faceCount} aristas=${state.edgeCount}`);
  check('la selección se conserva tras mover',
    state.selection.faces === 1 && state.selection.edges === 4,
    `caras=${state.selection.faces} aristas=${state.selection.edges}`);

  // Desplazamiento por vector explícito "1000;500;250".
  const beforeVector = state.bounds;
  await focusCanvas(page);
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(150);
  const v2 = await page.evaluate(() => {
    const app = window.form3d;
    let best = null;
    for (const v of app.editor.geometry.vertices.values()) {
      if (!best || v.p.x < best.x) best = v.p;
    }
    const s = app.viewport.worldToScreen(best);
    return [s.x, s.y];
  });
  await clickCanvas(page, v2[0], v2[1]);
  await moveCanvas(page, v2[0] + 70, v2[1]);
  r = await typeMeasurement(page, '1000;500;250');
  check('Mover acepta un vector "1000;500;250"', r.accepted, r.reason);
  state = await modelState(page);
  const dv = [0, 1, 2].map((i) => state.bounds.min[i] - beforeVector.min[i]);
  check('el vector desplaza exactamente (1, 0.5, 0.25) m',
    Math.abs(dv[0] - 1) < 1e-9 && Math.abs(dv[1] - 0.5) < 1e-9 && Math.abs(dv[2] - 0.25) < 1e-9,
    fmt3(dv));
  await shot(page, '01-mover');
  await endBlock(state);

  // ==========================================================================
  beginBlock('2. COPIAR con Ctrl durante Mover');
  // ==========================================================================
  await resetModel(page);
  r = await drawRectangle(page, '2000;2000');
  check('rectángulo de partida', r.accepted, r.reason);
  const originalVerts = (await modelState(page)).vertices;

  await focusCanvas(page);
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(150);
  await page.keyboard.press('m');
  await page.waitForTimeout(120);

  const copyBase = await page.evaluate(() => {
    const app = window.form3d;
    let best = null;
    for (const v of app.editor.geometry.vertices.values()) {
      if (!best || v.p.x < best.x) best = v.p;
    }
    const s = app.viewport.worldToScreen(best);
    return { world: [best.x, best.y, best.z], screen: [s.x, s.y] };
  });
  await clickCanvas(page, copyBase.screen[0], copyBase.screen[1]);
  await focusCanvas(page);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(80);

  far = await toScreen(page, [copyBase.world[0] + 6, copyBase.world[1], copyBase.world[2]]);
  await page.keyboard.down('Control');
  await moveCanvas(page, far[0], far[1]);
  await page.waitForTimeout(80);
  await page.keyboard.up('Control');
  r = await typeMeasurement(page, '6000');
  check('Copiar acepta la distancia "6000"', r.accepted, r.reason);

  state = await modelState(page);
  check('aparece geometría nueva (2 caras)', state.faceCount === 2, `caras=${state.faceCount}`);
  check('la copia tiene sus 8 aristas y 8 vértices',
    state.edgeCount === 8 && state.vertexCount === 8,
    `aristas=${state.edgeCount} vértices=${state.vertexCount}`);
  const survive = originalVerts.every((o) => state.vertices.some(
    (v) => Math.abs(v[0] - o[0]) < 1e-9 && Math.abs(v[1] - o[1]) < 1e-9 && Math.abs(v[2] - o[2]) < 1e-9,
  ));
  check('la geometría original sigue en su sitio', survive);
  const copied = originalVerts.every((o) => state.vertices.some(
    (v) => Math.abs(v[0] - (o[0] + 6)) < 1e-9 && Math.abs(v[1] - o[1]) < 1e-9 && Math.abs(v[2] - o[2]) < 1e-9,
  ));
  check('la copia está exactamente a 6 m en X', copied);
  await shot(page, '02-copiar');
  await endBlock(state);

  // ==========================================================================
  beginBlock('3. ROTAR (q): 90° sobre un rectángulo 2×1 m');
  // ==========================================================================
  await resetModel(page);
  r = await drawRectangle(page, '2000;1000');
  check('rectángulo 2×1 m', r.accepted, r.reason);
  state = await modelState(page);
  let sz = boxSize(state);
  check('las medidas de partida son 2 × 1 m',
    Math.abs(sz[0] - 2) < 1e-9 && Math.abs(sz[1] - 1) < 1e-9, fmt3(sz));
  const centerBefore = [0, 1, 2].map((i) => (state.bounds.min[i] + state.bounds.max[i]) / 2);

  await focusCanvas(page);
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(150);
  await page.keyboard.press('q');
  await page.waitForTimeout(120);
  check('la herramienta activa es Rotar',
    (await page.evaluate(() => window.form3d.editor.tool.id)) === 'rotate');

  const rotCenter = await toScreen(page, centerBefore);
  await clickCanvas(page, rotCenter[0], rotCenter[1]);
  const refCorner = await page.evaluate(() => {
    const app = window.form3d;
    let best = null;
    for (const v of app.editor.geometry.vertices.values()) {
      if (!best || v.p.x > best.x) best = v.p;
    }
    const s = app.viewport.worldToScreen(best);
    return [s.x, s.y];
  });
  await clickCanvas(page, refCorner[0], refCorner[1]);
  await moveCanvas(page, refCorner[0] - 40, refCorner[1] - 40);
  r = await typeMeasurement(page, '90');
  check('Rotar acepta el ángulo "90"', r.accepted, r.reason);

  state = await modelState(page);
  sz = boxSize(state);
  check('la caja envolvente intercambia ancho y alto (1 × 2 m)',
    Math.abs(sz[0] - 1) < 1e-6 && Math.abs(sz[1] - 2) < 1e-6, fmt3(sz));
  const centerAfter = [0, 1, 2].map((i) => (state.bounds.min[i] + state.bounds.max[i]) / 2);
  check('el centro de giro no se mueve',
    centerAfter.every((c, i) => Math.abs(c - centerBefore[i]) < 1e-6),
    `${fmt3(centerBefore)} → ${fmt3(centerAfter)}`);
  check('sigue habiendo una sola cara', state.faceCount === 1, `caras=${state.faceCount}`);
  await shot(page, '03-rotar');
  await endBlock(state);

  // ==========================================================================
  beginBlock('4. ESCALAR (s): factor 2 desde un tirador de esquina');
  // ==========================================================================
  await resetModel(page);
  r = await drawRectangle(page, '2000;2000');
  check('rectángulo 2×2 m', r.accepted, r.reason);
  state = await modelState(page);
  const scaleBounds = state.bounds;

  await focusCanvas(page);
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(150);
  await page.keyboard.press('s');
  await page.waitForTimeout(150);
  check('la herramienta activa es Escalar',
    (await page.evaluate(() => window.form3d.editor.tool.id)) === 'scale');

  // Tirador de la esquina (max X, max Y); el opuesto es (min X, min Y).
  const grip = [scaleBounds.max[0], scaleBounds.max[1], 0];
  const opposite = [scaleBounds.min[0], scaleBounds.min[1], 0];
  const gripScreen = await toScreen(page, grip);
  await clickCanvas(page, gripScreen[0], gripScreen[1]);
  const dragTo = await toScreen(page, [
    opposite[0] + (grip[0] - opposite[0]) * 2,
    opposite[1] + (grip[1] - opposite[1]) * 2,
    0,
  ]);
  await moveCanvas(page, dragTo[0], dragTo[1]);
  r = await typeMeasurement(page, '2');
  check('Escalar acepta el factor "2"', r.accepted, r.reason);

  state = await modelState(page);
  sz = boxSize(state);
  check('la caja envolvente duplica su tamaño (4 × 4 m)',
    Math.abs(sz[0] - 4) < 1e-9 && Math.abs(sz[1] - 4) < 1e-9, fmt3(sz));
  check('el tirador opuesto queda fijo',
    Math.abs(state.bounds.min[0] - opposite[0]) < 1e-9
    && Math.abs(state.bounds.min[1] - opposite[1]) < 1e-9,
    `esperado ${fmt3(opposite.slice(0, 2))}, obtenido ${fmt3(state.bounds.min.slice(0, 2))}`);
  await shot(page, '04-escalar');
  await endBlock(state);

  // ==========================================================================
  beginBlock('5. EQUIDISTANCIA (f): 500 mm hacia dentro de una cara 4×4 m');
  // ==========================================================================
  await resetModel(page);
  r = await drawRectangle(page, '4000;4000');
  check('rectángulo 4×4 m', r.accepted, r.reason);
  state = await modelState(page);
  sz = boxSize(state);
  check('la cara mide 4 × 4 m',
    Math.abs(sz[0] - 4) < 1e-9 && Math.abs(sz[1] - 4) < 1e-9, fmt3(sz));

  const faceCentre = await page.evaluate(() => {
    const app = window.form3d;
    const geo = app.editor.geometry;
    const id = [...geo.faces.keys()][0];
    const c = window.__tri.faceCentroid(geo, id);
    const s = app.viewport.worldToScreen(c);
    return { world: [c.x, c.y, c.z], screen: [s.x, s.y] };
  });

  await page.keyboard.press('f');
  await page.waitForTimeout(120);
  check('la herramienta activa es Equidistancia',
    (await page.evaluate(() => window.form3d.editor.tool.id)) === 'offset');
  await clickCanvas(page, faceCentre.screen[0], faceCentre.screen[1]);
  // Cursor hacia el interior de la cara para que el signo sea "hacia dentro".
  const inward = await toScreen(page, [
    faceCentre.world[0] + 0.3, faceCentre.world[1] + 0.3, faceCentre.world[2],
  ]);
  await moveCanvas(page, inward[0], inward[1]);
  r = await typeMeasurement(page, '500');
  check('Equidistancia acepta "500"', r.accepted, r.reason);

  state = await modelState(page);
  check('aparecen 2 caras (marco + interior)', state.faceCount === 2, `caras=${state.faceCount}`);
  const areas = await page.evaluate(() => {
    const geo = window.form3d.editor.geometry;
    return [...geo.faces.keys()].map((id) => window.__tri.faceArea(geo, id)).sort((a, b) => a - b);
  });
  const totalArea = areas.reduce((a, b) => a + b, 0);
  check('el área total sigue siendo 16 m²', Math.abs(totalArea - 16) < 1e-9,
    `${fmt(totalArea)} m² — caras: ${areas.map(fmt).join(', ')}`);
  check('el interior mide 3×3 = 9 m² y el marco 7 m²',
    areas.length === 2 && Math.abs(areas[0] - 7) < 1e-9 && Math.abs(areas[1] - 9) < 1e-9,
    areas.map(fmt).join(' / '));
  await shot(page, '05-equidistancia');
  await endBlock(state);

  // ==========================================================================
  beginBlock('6. BORRAR (e): una arista vertical de una caja');
  // ==========================================================================
  await resetModel(page);
  r = await drawRectangle(page, '2000;2000');
  check('rectángulo de partida', r.accepted, r.reason);
  const topFace = await page.evaluate(() => {
    const app = window.form3d;
    const geo = app.editor.geometry;
    const id = [...geo.faces.keys()][0];
    const c = window.__tri.faceCentroid(geo, id);
    const s = app.viewport.worldToScreen(c);
    return [s.x, s.y];
  });
  await page.keyboard.press('p');
  await page.waitForTimeout(120);
  await clickCanvas(page, topFace[0], topFace[1]);
  await moveCanvas(page, topFace[0], topFace[1] - 70);
  r = await typeMeasurement(page, '1000');
  check('Empujar/Tirar acepta "1000"', r.accepted, r.reason);

  state = await modelState(page);
  check('la caja tiene 6 caras y 12 aristas',
    state.faceCount === 6 && state.edgeCount === 12,
    `caras=${state.faceCount} aristas=${state.edgeCount}`);

  const targetEdge = await page.evaluate(() => {
    const app = window.form3d;
    const geo = app.editor.geometry;
    const eye = app.viewport.cameraCtl.eye;
    let best = null;
    let bestD = Infinity;
    for (const e of geo.edges.values()) {
      const a = geo.vertexPos(e.a);
      const b = geo.vertexPos(e.b);
      if (Math.abs(a.z - b.z) < 0.5) continue; // sólo aristas verticales
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
      const d = Math.hypot(m.x - eye.x, m.y - eye.y, m.z - eye.z);
      if (d < bestD) { bestD = d; best = { id: e.id, m }; }
    }
    if (!best) return null;
    const s = app.viewport.worldToScreen(best.m);
    return {
      id: best.id,
      screen: [s.x, s.y],
      faces: [...(geo.edgeFaces.get(best.id) ?? [])],
    };
  });
  check('se ha localizado una arista vertical', targetEdge !== null);
  check('la arista separa 2 caras', targetEdge && targetEdge.faces.length === 2,
    targetEdge ? `caras=${targetEdge.faces.length}` : '');

  await page.keyboard.press('e');
  await page.waitForTimeout(120);
  check('la herramienta activa es Borrar',
    (await page.evaluate(() => window.form3d.editor.tool.id)) === 'eraser');
  await clickCanvas(page, targetEdge.screen[0], targetEdge.screen[1]);
  await page.waitForTimeout(200);

  state = await modelState(page);
  const gone = await page.evaluate((info) => ({
    edge: !window.form3d.editor.geometry.edges.has(info.id),
    faces: info.faces.filter((f) => window.form3d.editor.geometry.faces.has(f)),
  }), targetEdge);
  check('la arista se ha borrado', gone.edge);
  check('desaparecen las dos caras adyacentes', gone.faces.length === 0,
    `siguen presentes: ${gone.faces.join(', ')}`);
  check('quedan 4 caras', state.faceCount === 4, `caras=${state.faceCount}`);

  await focusCanvas(page);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  state = await modelState(page);
  check('deshacer devuelve la caja completa',
    state.faceCount === 6 && state.edgeCount === 12,
    `caras=${state.faceCount} aristas=${state.edgeCount}`);
  await shot(page, '06-borrar');
  await endBlock(state);

  // ==========================================================================
  beginBlock('7. PINTAR (b): material del panel aplicado a una cara');
  // ==========================================================================
  await resetModel(page);
  r = await drawRectangle(page, '2000;2000');
  check('rectángulo de partida', r.accepted, r.reason);

  const swatches = await page.locator('.swatch').count();
  check('el panel de materiales tiene muestras', swatches >= 5, `${swatches} muestras`);
  const materialId = await page.evaluate(() => [...window.form3d.editor.model.materials.keys()][2]);
  await page.locator('.swatch').nth(2).click();
  await page.waitForTimeout(200);
  check('al elegir material se activa la herramienta Pintar',
    (await page.evaluate(() => window.form3d.editor.tool.id)) === 'paint');

  const paintTarget = await page.evaluate(() => {
    const app = window.form3d;
    const geo = app.editor.geometry;
    const id = [...geo.faces.keys()][0];
    const c = window.__tri.faceCentroid(geo, id);
    const s = app.viewport.worldToScreen(c);
    return { id, screen: [s.x, s.y] };
  });
  await clickCanvas(page, paintTarget.screen[0], paintTarget.screen[1]);
  await page.waitForTimeout(200);

  const painted = await page.evaluate((id) => {
    const f = window.form3d.editor.geometry.faces.get(id);
    return f ? { front: f.frontMaterial, back: f.backMaterial } : null;
  }, paintTarget.id);
  check(`la cara queda pintada con "${materialId}" en su anverso`,
    painted && painted.front === materialId,
    `frontMaterial=${painted?.front} backMaterial=${painted?.back}`);
  state = await modelState(page);
  await shot(page, '07-pintar');
  await endBlock(state);

  // ==========================================================================
  beginBlock('8. ACOTAR (d): cota entre dos vértices');
  // ==========================================================================
  await resetModel(page);
  r = await drawRectangle(page, '2000;2000');
  check('rectángulo de partida', r.accepted, r.reason);

  const corners = await page.evaluate(() => {
    const app = window.form3d;
    const geo = app.editor.geometry;
    const pts = [...geo.vertices.values()].map((v) => v.p);
    // Dos vértices unidos por una arista de 2 m: mínimo y su vecino en +X.
    const a = pts.reduce((m, p) => (p.x < m.x || (p.x === m.x && p.y < m.y) ? p : m), pts[0]);
    let b = null;
    for (const p of pts) {
      if (Math.abs(p.y - a.y) < 1e-9 && Math.abs(p.x - a.x) > 1e-9) b = p;
    }
    const sa = app.viewport.worldToScreen(a);
    const sb = app.viewport.worldToScreen(b);
    return {
      a: [a.x, a.y, a.z], b: [b.x, b.y, b.z],
      sa: [sa.x, sa.y], sb: [sb.x, sb.y],
      dist: Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z),
    };
  });
  check('los dos vértices elegidos distan 2 m', Math.abs(corners.dist - 2) < 1e-9,
    `${fmt(corners.dist)} m`);

  await page.keyboard.press('d');
  await page.waitForTimeout(120);
  check('la herramienta activa es Acotar',
    (await page.evaluate(() => window.form3d.editor.tool.id)) === 'dimension');
  await clickCanvas(page, corners.sa[0], corners.sa[1]);
  await clickCanvas(page, corners.sb[0], corners.sb[1]);
  // Tercer clic: separar la línea de cota.
  const offsetPt = await toScreen(page, [corners.a[0], corners.a[1] - 1, corners.a[2]]);
  await moveCanvas(page, offsetPt[0], offsetPt[1]);
  await clickCanvas(page, offsetPt[0], offsetPt[1]);
  await page.waitForTimeout(300);

  state = await modelState(page);
  check('model.dimensions.size === 1', state.dimensions === 1, `cotas=${state.dimensions}`);
  const labels = await page.evaluate(() => [...document.querySelectorAll('.dim-label')]
    .filter((d) => d.style.display !== 'none')
    .map((d) => d.textContent));
  check('la etiqueta .dim-label aparece en el DOM', labels.length === 1,
    `${labels.length} etiquetas: ${JSON.stringify(labels)}`);
  check('la etiqueta muestra "2000 mm"', labels[0] === '2000 mm', JSON.stringify(labels[0]));
  await shot(page, '08-acotar');
  await endBlock(state);

  // ==========================================================================
  beginBlock('9. METRO (t): medir y crear guías');
  // ==========================================================================
  await resetModel(page);
  r = await drawRectangle(page, '2000;2000');
  check('rectángulo de partida', r.accepted, r.reason);
  const tape = await page.evaluate(() => {
    const app = window.form3d;
    const pts = [...app.editor.geometry.vertices.values()].map((v) => v.p);
    const a = pts.reduce((m, p) => (p.x < m.x ? p : m), pts[0]);
    let b = null;
    for (const p of pts) if (Math.abs(p.y - a.y) < 1e-9 && Math.abs(p.x - a.x) > 1e-9) b = p;
    const sa = app.viewport.worldToScreen(a);
    const sb = app.viewport.worldToScreen(b);
    return { sa: [sa.x, sa.y], sb: [sb.x, sb.y] };
  });

  await page.keyboard.press('t');
  await page.waitForTimeout(120);
  check('la herramienta activa es Metro',
    (await page.evaluate(() => window.form3d.editor.tool.id)) === 'tape');
  await clickCanvas(page, tape.sa[0], tape.sa[1]);
  await clickCanvas(page, tape.sb[0], tape.sb[1]);
  await page.waitForTimeout(250);

  state = await modelState(page);
  check('el Metro crea guías (model.guides.size > 0)', state.guides > 0, `guías=${state.guides}`);
  const guideOk = await page.evaluate(() => {
    const gs = [...window.form3d.editor.model.guides.values()];
    const line = gs.find((g) => g.kind === 'line');
    if (!line) return { ok: false, len: null };
    const len = Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y, line.b.z - line.a.z);
    return { ok: true, len };
  });
  check('la guía de línea mide 2 m', guideOk.ok && Math.abs(guideOk.len - 2) < 1e-9,
    guideOk.len === null ? 'no hay guía de línea' : `${fmt(guideOk.len)} m`);

  // Segunda guía con longitud escrita en el cuadro de medidas.
  await clickCanvas(page, tape.sa[0], tape.sa[1]);
  await moveCanvas(page, tape.sb[0], tape.sb[1]);
  r = await typeMeasurement(page, '3000');
  check('el Metro acepta una longitud escrita ("3000")', r.accepted, r.reason);
  const guideLens = await page.evaluate(() => [...window.form3d.editor.model.guides.values()]
    .filter((g) => g.kind === 'line')
    .map((g) => Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y, g.b.z - g.a.z)));
  check('la nueva guía mide exactamente 3 m',
    guideLens.some((l) => Math.abs(l - 3) < 1e-9), guideLens.map(fmt).join(', '));
  state = await modelState(page);
  await shot(page, '09-metro');
  await endBlock(state);

  // ==========================================================================
  beginBlock('10a. ARCO (a): comba exacta de 500 mm');
  // ==========================================================================
  await resetModel(page);
  await page.keyboard.press('a');
  await page.waitForTimeout(120);
  check('la herramienta activa es Arco',
    (await page.evaluate(() => window.form3d.editor.tool.id)) === 'arc');
  await clickCanvas(page, 560, 520);
  await clickCanvas(page, 860, 520);
  await moveCanvas(page, 710, 460);
  const segs = await typeMeasurement(page, '12s');
  check('Arco acepta el número de tramos "12s"', segs.accepted, segs.reason);
  await moveCanvas(page, 710, 462);
  r = await typeMeasurement(page, '500');
  check('Arco acepta la comba "500"', r.accepted, r.reason);

  state = await modelState(page);
  check('el arco tiene 12 aristas (12 tramos)',
    state.edgeCount === 12, `aristas=${state.edgeCount}`);
  check('el arco tiene 13 vértices', state.vertexCount === 13, `vértices=${state.vertexCount}`);
  check('un arco abierto no crea cara', state.faceCount === 0, `caras=${state.faceCount}`);
  const bulge = await page.evaluate(() => {
    const geo = window.form3d.editor.geometry;
    const pts = [...geo.vertices.values()].map((v) => v.p);
    // Extremos = los dos puntos más separados entre sí.
    let a = pts[0]; let b = pts[1]; let best = -1;
    for (const p of pts) {
      for (const q of pts) {
        const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
        if (d > best) { best = d; a = p; b = q; }
      }
    }
    const ux = b.x - a.x; const uy = b.y - a.y; const uz = b.z - a.z;
    const ul = Math.hypot(ux, uy, uz);
    let maxPerp = 0;
    for (const p of pts) {
      const rx = p.x - a.x; const ry = p.y - a.y; const rz = p.z - a.z;
      const t = (rx * ux + ry * uy + rz * uz) / (ul * ul);
      const px = rx - ux * t; const py = ry - uy * t; const pz = rz - uz * t;
      maxPerp = Math.max(maxPerp, Math.hypot(px, py, pz));
    }
    return { chord: ul, maxPerp };
  });
  check('la comba máxima del arco es exactamente 0.5 m',
    Math.abs(bulge.maxPerp - 0.5) < 1e-9, `${fmt(bulge.maxPerp)} m`);
  await shot(page, '10-arco');
  await endBlock(state);

  // ==========================================================================
  beginBlock('10b. POLÍGONO (g): hexágono de radio 1500 mm');
  // ==========================================================================
  await resetModel(page);
  await page.keyboard.press('g');
  await page.waitForTimeout(120);
  check('la herramienta activa es Polígono',
    (await page.evaluate(() => window.form3d.editor.tool.id)) === 'polygon');
  await clickCanvas(page, 700, 480);
  await moveCanvas(page, 800, 480);
  r = await typeMeasurement(page, '1500');
  check('Polígono acepta el radio "1500"', r.accepted, r.reason);

  state = await modelState(page);
  check('el hexágono tiene 6 aristas', state.edgeCount === 6, `aristas=${state.edgeCount}`);
  check('el hexágono tiene 6 vértices', state.vertexCount === 6, `vértices=${state.vertexCount}`);
  check('el hexágono genera una cara', state.faceCount === 1, `caras=${state.faceCount}`);
  const radii = await page.evaluate(() => {
    const geo = window.form3d.editor.geometry;
    const pts = [...geo.vertices.values()].map((v) => v.p);
    const c = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length, z: a.z + p.z / pts.length }),
      { x: 0, y: 0, z: 0 });
    return pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z));
  });
  const rMin = Math.min(...radii);
  const rMax = Math.max(...radii);
  check('todos los vértices están a 1.5 m exactos del centro',
    Math.abs(rMin - 1.5) < 1e-9 && Math.abs(rMax - 1.5) < 1e-9,
    `min=${fmt(rMin)} max=${fmt(rMax)}`);
  await shot(page, '11-poligono');
  await endBlock(state);

  // ==========================================================================
  beginBlock('11. GRUPOS: agrupar, entrar, dibujar dentro y salir');
  // ==========================================================================
  await resetModel(page);
  r = await drawRectangle(page, '2000;2000');
  check('rectángulo de partida', r.accepted, r.reason);
  await focusCanvas(page);
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+g');
  await page.waitForTimeout(300);

  state = await modelState(page);
  check('se ha creado un grupo', state.instanceCount === 1, `instancias=${state.instanceCount}`);
  check('la raíz se queda sin caras', state.rootFaces === 0, `caras en la raíz=${state.rootFaces}`);

  await page.keyboard.press('v');
  await page.waitForTimeout(120);
  const groupPoint = await page.evaluate(() => {
    const app = window.form3d;
    const tri = app.viewport.builder.pick.triangles.find((t) => t.topInstance !== null);
    if (!tri) return null;
    const c = {
      x: (tri.a.x + tri.b.x + tri.c.x) / 3,
      y: (tri.a.y + tri.b.y + tri.c.y) / 3,
      z: (tri.a.z + tri.b.z + tri.c.z) / 3,
    };
    const s = app.viewport.worldToScreen(c);
    return [s.x, s.y];
  });
  check('el grupo es visible para el selector', groupPoint !== null);
  await doubleClickCanvas(page, groupPoint[0], groupPoint[1]);

  state = await modelState(page);
  check('el doble clic entra en el grupo (contextPath.length === 1)',
    state.contextDepth === 1, `contextPath.length=${state.contextDepth}`);

  // Dibujar dentro del grupo, lejos de la geometría existente.
  const insidePt = await page.evaluate(() => {
    const app = window.form3d;
    const geo = app.editor.geometry;
    let minX = Infinity; let maxY = -Infinity;
    for (const v of geo.vertices.values()) {
      minX = Math.min(minX, v.p.x);
      maxY = Math.max(maxY, v.p.y);
    }
    const p = { x: minX, y: maxY + 3, z: 0 };
    const s = app.viewport.worldToScreen(p);
    return [s.x, s.y];
  });
  await page.keyboard.press('r');
  await page.waitForTimeout(100);
  await clickCanvas(page, insidePt[0], insidePt[1]);
  await moveCanvas(page, insidePt[0] + 80, insidePt[1]);
  r = await typeMeasurement(page, '1000;1000');
  check('se dibuja un rectángulo dentro del grupo', r.accepted, r.reason);

  state = await modelState(page);
  check('la geometría nueva va al contexto del grupo',
    state.faceCount === 2 && state.contextDepth === 1,
    `caras en contexto=${state.faceCount} profundidad=${state.contextDepth}`);
  check('la raíz sigue sin caras propias', state.rootFaces === 0, `caras en la raíz=${state.rootFaces}`);

  await page.keyboard.press('Escape'); // cancela el rectángulo en curso
  await page.waitForTimeout(120);
  await page.keyboard.press('v');
  await page.waitForTimeout(120);
  await page.keyboard.press('Escape'); // limpia selección o sale
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  state = await modelState(page);
  check('Escape sale del grupo (contextPath vacío)', state.contextDepth === 0,
    `contextPath.length=${state.contextDepth}`);
  const inside = await page.evaluate(() => {
    const model = window.form3d.editor.model;
    const out = [];
    for (const d of model.definitions.values()) {
      if (d.id === model.rootId) continue;
      out.push({ name: d.name, faces: d.geometry.faces.size, edges: d.geometry.edges.size });
    }
    return out;
  });
  check('la geometría quedó DENTRO del grupo (2 caras, 8 aristas)',
    inside.length === 1 && inside[0].faces === 2 && inside[0].edges === 8,
    JSON.stringify(inside));
  check('la raíz sólo contiene la instancia',
    state.rootFaces === 0 && state.rootEdges === 0 && state.instanceCount === 1,
    `caras=${state.rootFaces} aristas=${state.rootEdges} instancias=${state.instanceCount}`);
  await shot(page, '12-grupos');
  await endBlock(state);

  // ==========================================================================
  beginBlock('12. INFERENCIA: "En el eje rojo" con la herramienta Línea');
  // ==========================================================================
  await resetModel(page);
  r = await drawRectangle(page, '2000;2000');
  check('rectángulo de partida', r.accepted, r.reason);

  const startVertex = await page.evaluate(() => {
    const app = window.form3d;
    // Esquina de mayor X: hacia +X no hay ninguna arista del rectángulo.
    let best = null;
    for (const v of app.editor.geometry.vertices.values()) {
      if (!best || v.p.x > best.x || (v.p.x === best.x && v.p.y > best.y)) best = v.p;
    }
    const s = app.viewport.worldToScreen(best);
    return { world: [best.x, best.y, best.z], screen: [s.x, s.y] };
  });

  await page.keyboard.press('l');
  await page.waitForTimeout(120);
  check('la herramienta activa es Línea',
    (await page.evaluate(() => window.form3d.editor.tool.id)) === 'line');
  await clickCanvas(page, startVertex.screen[0], startVertex.screen[1]);

  const alongX = await toScreen(page, [
    startVertex.world[0] + 3, startVertex.world[1], startVertex.world[2],
  ]);
  await moveCanvas(page, alongX[0], alongX[1]);
  await page.waitForTimeout(150);
  const tip = await page.evaluate(() => {
    const el = document.querySelector('.inference-tip');
    return { text: el ? el.textContent : null, visible: el ? el.classList.contains('visible') : false };
  });
  check('la etiqueta de inferencia dice "En el eje rojo"',
    tip.text === 'En el eje rojo', JSON.stringify(tip));
  check('la etiqueta de inferencia está visible', tip.visible);

  // Comprobación complementaria: el eje verde en la otra dirección.
  const alongY = await toScreen(page, [
    startVertex.world[0], startVertex.world[1] + 3, startVertex.world[2],
  ]);
  await moveCanvas(page, alongY[0], alongY[1]);
  await page.waitForTimeout(150);
  const tipY = await page.evaluate(() => document.querySelector('.inference-tip')?.textContent);
  check('hacia +Y la etiqueta dice "En el eje verde"', tipY === 'En el eje verde',
    JSON.stringify(tipY));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  state = await modelState(page);
  await shot(page, '13-inferencia');
  await endBlock(state);

  // ==========================================================================
  beginBlock('12b. RECTÁNGULO apoyado en una inferencia de eje');
  // ==========================================================================
  await resetModel(page);
  r = await drawRectangle(page, '2000;2000');
  check('rectángulo de partida', r.accepted, r.reason);
  const cornerX = await page.evaluate(() => {
    const app = window.form3d;
    let best = null;
    for (const v of app.editor.geometry.vertices.values()) {
      if (!best || v.p.x > best.x || (v.p.x === best.x && v.p.y > best.y)) best = v.p;
    }
    const s = app.viewport.worldToScreen(best);
    return { world: [best.x, best.y, best.z], screen: [s.x, s.y] };
  });

  await page.keyboard.press('r');
  await page.waitForTimeout(100);
  await clickCanvas(page, cornerX.screen[0], cornerX.screen[1]);
  const onRedAxis = await toScreen(page, [
    cornerX.world[0] + 2, cornerX.world[1], cornerX.world[2],
  ]);
  const erroresAntes = consoleErrors.length;
  await moveCanvas(page, onRedAxis[0], onRedAxis[1]);
  await page.waitForTimeout(150);
  const tipRect = await page.evaluate(() => document.querySelector('.inference-tip')?.textContent);
  check('el cursor está sobre la inferencia del eje rojo', tipRect === 'En el eje rojo',
    JSON.stringify(tipRect));
  const rectCrash = consoleErrors.slice(erroresAntes);
  check('mover el rectángulo sobre el eje rojo no lanza excepciones',
    rectCrash.length === 0, rectCrash.slice(0, 2).join(' | '));
  check('el cuadro de medidas queda utilizable sobre el eje',
    !(await page.locator('.vcb input').isDisabled()));

  r = await typeMeasurement(page, '2000;2000');
  check('se puede escribir la medida exacta apoyado en el eje', r.accepted, r.reason);
  state = await modelState(page);
  check('se crea el segundo rectángulo', state.faceCount === 2, `caras=${state.faceCount}`);
  await shot(page, '13b-rect-eje');
  await endBlock(state);

  // ==========================================================================
  beginBlock('13. DESHACER PROFUNDO: 10 operaciones y 10 deshacer');
  // ==========================================================================
  await resetModel(page);
  const spots = [
    [420, 560], [560, 560], [700, 560], [840, 560], [980, 560],
    [420, 440], [560, 440], [700, 440], [840, 440], [980, 440],
  ];
  let drawn = 0;
  for (let i = 0; i < spots.length; i++) {
    const [x, y] = spots[i];
    await page.keyboard.press('Escape');
    await page.keyboard.press('r');
    await page.waitForTimeout(70);
    await clickCanvas(page, x, y);
    await moveCanvas(page, x + 70, y);
    const res = await typeMeasurement(page, '400;400');
    if (res.accepted) drawn++;
    else note(`operación ${i + 1} rechazada: ${res.reason}`);
  }
  check('se han ejecutado 10 operaciones', drawn === 10, `${drawn}/10`);
  state = await modelState(page);
  check('el historial guarda 10 pasos', state.undoDepth === 10, `undo=${state.undoDepth}`);
  check('el modelo tiene geometría antes de deshacer', state.faceCount >= 1,
    `caras=${state.faceCount}`);
  await shot(page, '14-diez-operaciones');

  await focusCanvas(page);
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(140);
  }
  state = await modelState(page);
  check('tras 10 deshacer el modelo está vacío',
    state.faceCount === 0 && state.edgeCount === 0 && state.vertexCount === 0,
    `caras=${state.faceCount} aristas=${state.edgeCount} vértices=${state.vertexCount}`);
  check('la pila de deshacer se ha vaciado', state.undoDepth === 0, `undo=${state.undoDepth}`);
  await shot(page, '15-deshecho');
  await endBlock(state);

  // ==========================================================================
  currentBlock = '14. Estado final';
  console.log(`\n${currentBlock}`);
  check('sin errores de consola en toda la sesión',
    consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));

  await browser.close();

  console.log(`\n${results.length - failures}/${results.length} comprobaciones correctas`);
  if (failures > 0) {
    console.log('\nFALLOS:');
    for (const res of results.filter((x) => !x.ok)) {
      console.log(`  - [${res.block}] ${res.name}${res.detail ? ` — ${res.detail}` : ''}`);
    }
    process.exit(1);
  }
  console.log('Todo correcto.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
