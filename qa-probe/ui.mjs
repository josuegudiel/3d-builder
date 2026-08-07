import { open, reset, summary } from './lib.mjs';

const { browser, page, errs, box, check, results, frame } = await open();
const status = () => page.evaluate(() => document.querySelector('.status-text').textContent);
const info = () => page.evaluate(() => {
  const out = {};
  for (const r of document.querySelectorAll('.panels .card .card-body .row, .panels .card .card-body > div')) {
    const k = r.children[0]?.textContent;
    const v = r.children[1]?.textContent;
    if (k) out[k] = v;
  }
  return out;
});
const menuClick = async (menu, item) => {
  await page.locator('.menu > button', { hasText: menu }).click();
  await page.waitForTimeout(150);
  await page.locator('.menu.open .menu-item', { hasText: item }).first().click();
  await page.waitForTimeout(350);
};

console.log('\n### COHERENCIA DE LOS MENÚS: ¿avisan cuando no se puede?\n');
await reset(page);
const casos = [
  ['Edición', 'Invertir selección'],
  ['Edición', 'Explotar'],
  ['Edición', 'Crear grupo'],
  ['Edición', 'Crear componente'],
  ['Edición', 'Invertir caras'],
  ['Edición', 'Orientar caras del sólido'],
  ['Edición', 'Eliminar cotas'],
  ['Edición', 'Eliminar guías'],
  ['Edición', 'Deshacer'],
  ['Edición', 'Rehacer'],
  ['Sólidos', 'Unir'],
  ['Sólidos', 'Restar'],
  ['Sólidos', 'Intersecar caras'],
  ['Sólidos', 'Medir la unión'],
  ['Ver', 'Encajar selección'],
  ['Ver', 'Encajar todo'],
];
const sinAviso = [];
for (const [m, it] of casos) {
  await reset(page);
  await page.evaluate(() => window.form3d.editor.setStatus('«sin cambios»'));
  await menuClick(m, it);
  const st = await status();
  const cambio = st !== '«sin cambios»';
  console.log(`   ${m} ▸ ${it}  →  ${cambio ? st.slice(0, 80) : 'SIN NINGÚN MENSAJE'}`);
  if (!cambio) sinAviso.push(`${m} ▸ ${it}`);
}
check('todas las entradas de menú avisan cuando no se pueden aplicar (modelo vacío)',
  sinAviso.length === 0, JSON.stringify(sinAviso));

console.log('\n### VERACIDAD DEL PANEL DE INFORMACIÓN\n');
// caja 2 x 1 x 0.5
await reset(page);
await page.evaluate(() => {
  const api = window.form3d.api;
  api.rectangle(0, 0, 2, 1);
  api.pushPull(api.faces()[0].id, 0.5);
});
await page.waitForTimeout(300);

// 1. una cara: área + volumen del sólido
await page.evaluate(() => {
  const api = window.form3d.api;
  const top = api.faces().sort((a, b) => b.area - a.area)[0];
  api.select({ faces: [top.id] });
});
await page.waitForTimeout(250);
let i = await info();
console.log('   una cara 2×1: ' + JSON.stringify(i));
check('el panel da el área correcta de la cara (2 m² = 2000000 mm²)',
  /2\s*000\s*000|2000000/.test((i['Área seleccionada'] || '').replace(/ | |\s/g, '')) || /2\s*m²/.test(i['Área seleccionada'] || ''),
  i['Área seleccionada']);
check('el panel da el volumen del sólido (1 m³)',
  (i['Volumen del sólido'] || '').length > 0, i['Volumen del sólido']);

// en metros, para leerlo cómodamente
await page.evaluate(() => window.form3d.editor.setUnits({ format: 'decimal', unit: 'm', precision: 3 }));
await page.evaluate(() => window.form3d.editor.refreshModel());
await page.waitForTimeout(250);
i = await info();
console.log('   en metros: ' + JSON.stringify(i));
check('área en metros = 2 m²', /^2(,|\.)000\s*m²$|^2\s*m²$/.test((i['Área seleccionada'] || '').trim()), i['Área seleccionada']);
check('volumen en metros = 1 m³', /^1(,|\.)000\s*m³$|^1\s*m³$/.test((i['Volumen del sólido'] || '').trim()), i['Volumen del sólido']);

// 2. una arista: longitud
await page.evaluate(() => {
  const api = window.form3d.api;
  let best = null; let bestLen = 0;
  for (const id of api.geometry.edges.keys()) {
    const l = api.geometry.edgeLength(id);
    if (l > bestLen) { bestLen = l; best = id; }
  }
  api.select({ edges: [best] });
});
await page.waitForTimeout(250);
i = await info();
console.log('   una arista larga: ' + JSON.stringify(i));
check('el panel da la longitud de la arista (2 m)', /^2(,|\.)000\s*m$|^2\s*m$/.test((i['Longitud'] || '').trim()), i['Longitud']);

// 3. dos caras perpendiculares: ángulo
await page.evaluate(() => {
  const api = window.form3d.api;
  const fs = api.faces();
  const top = fs.find((f) => Math.abs(api.geometry.faces.get(f.id).plane.n.z) > 0.9);
  const side = fs.find((f) => Math.abs(api.geometry.faces.get(f.id).plane.n.x) > 0.9);
  api.select({ faces: [top.id, side.id] });
});
await page.waitForTimeout(250);
i = await info();
console.log('   dos caras perpendiculares: ' + JSON.stringify(i));
check('el panel da 90° entre dos caras perpendiculares', /90/.test(i['Ángulo'] || ''), i['Ángulo']);

// 4. un grupo: pieza y volumen
await page.evaluate(() => {
  const api = window.form3d.api;
  api.selectAll();
  const g = api.group('Viga');
  api.select({ instances: [g] });
});
await page.waitForTimeout(300);
i = await info();
console.log('   un grupo: ' + JSON.stringify(i));
check('el panel describe la pieza del grupo (0,5 × 1 · 2 m)', /2/.test(i['Pieza'] || ''), i['Pieza']);
check('el panel dice que es un Grupo y cuántas instancias tiene',
  i['Tipo'] === 'Grupo' && i['Instancias'] === '1', JSON.stringify({ t: i['Tipo'], n: i['Instancias'] }));

// 5. contador de aristas/caras visibles
const vis = await page.evaluate(() => window.form3d.editor.model.visibleStats());
check('los contadores del panel coinciden con visibleStats()',
  i['Aristas'] === String(vis.edges) && i['Caras'] === String(vis.faces) && i['Grupos'] === String(vis.instances),
  JSON.stringify({ panel: [i['Aristas'], i['Caras'], i['Grupos']], vis }));

console.log('\n### TEXTOS DE ESTADO\n');
await reset(page);
const hints = await page.evaluate(() => {
  const out = [];
  const btns = [...document.querySelectorAll('.tool-btn')];
  return btns.map((b) => b.getAttribute('aria-label'));
});
const textos = [];
for (const name of hints) {
  await page.locator(`.tool-btn[aria-label="${name}"]`).click();
  await page.waitForTimeout(90);
  textos.push([name, await status()]);
}
for (const [n, t] of textos) console.log(`   ${n.padEnd(22)} → ${t}`);
const vacios = textos.filter(([, t]) => !t || t.trim() === '');
check('todas las herramientas tienen texto de estado', vacios.length === 0, JSON.stringify(vacios.map((v) => v[0])));
const sinTilde = textos.filter(([, t]) => /[a-z]/.test(t) && !/[áéíóúñÁÉÍÓÚÑ¿¡]/.test(t) && t.length > 60);
console.log('   (informativo) textos largos sin ninguna tilde: ' + JSON.stringify(sinTilde.map((v) => v[0])));

console.log('\n### GUÍA "CÓMO EMPEZAR" vs REALIDAD\n');
await page.locator('.menu > button', { hasText: 'Ayuda' }).click(); await page.waitForTimeout(150);
await page.locator('.menu.open .menu-item', { hasText: 'Cómo empezar' }).click(); await page.waitForTimeout(300);
const guia = await page.evaluate(() => document.querySelector('.modal')?.innerText ?? '');
const kbds = await page.evaluate(() => [...document.querySelectorAll('.modal kbd')].map((k) => k.textContent));
console.log('   teclas citadas en la guía: ' + JSON.stringify(kbds));
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
const esperado = { R: 'Rectángulo', P: 'Empujar/Tirar', L: 'Línea', D: 'Acotar', T: 'Metro', N: 'Ángulo' };
const malas = [];
for (const [k, name] of Object.entries(esperado)) {
  if (!kbds.includes(k)) continue;
  await page.keyboard.press(k.toLowerCase()); await page.waitForTimeout(90);
  const cur = await page.evaluate(() => window.form3d.editor.tool.name);
  if (cur !== name) malas.push(`${k} → ${cur} (la guía dice ${name})`);
}
check('las teclas citadas en "Cómo empezar" activan lo que dicen', malas.length === 0, JSON.stringify(malas));

// la guía promete "4000;3000" en el rectángulo y "2500" en empujar/tirar
await reset(page);
await page.keyboard.press('r'); await page.waitForTimeout(100);
const W = (p) => page.evaluate((q) => window.form3d.viewport.worldToScreen(q), p);
let s = await W({ x: 0, y: 0, z: 0 });
await page.mouse.move(box.x + s.x, box.y + s.y); await page.waitForTimeout(70); await frame();
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(120);
s = await W({ x: 2, y: -1.2, z: 0 });
await page.mouse.move(box.x + s.x, box.y + s.y); await page.waitForTimeout(70); await frame();
await page.fill('.vcb input', '4000;3000'); await page.press('.vcb input', 'Enter'); await page.waitForTimeout(300);
let ar = await page.evaluate(() => window.form3d.api.faceAreas());
check('la guía es cierta: "4000;3000" da 4 × 3 m (12 m²)', Math.abs(ar[0] - 12) < 1e-6, JSON.stringify(ar));

await page.keyboard.press('p'); await page.waitForTimeout(100);
const fc = await page.evaluate(() => window.form3d.api.faceCentre(window.form3d.api.faces()[0].id));
s = await W(fc);
await page.mouse.move(box.x + s.x, box.y + s.y); await page.waitForTimeout(70); await frame();
await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(150);
s = await W({ x: fc.x, y: fc.y, z: 1 });
await page.mouse.move(box.x + s.x, box.y + s.y); await page.waitForTimeout(70); await frame();
await page.fill('.vcb input', '2500'); await page.press('.vcb input', 'Enter'); await page.waitForTimeout(300);
const vol = await page.evaluate(() => window.form3d.api.volume());
check('la guía es cierta: "2500" en Empujar/Tirar da 4×3×2,5 = 30 m³', Math.abs(vol - 30) < 1e-6, String(vol));

check('sin excepciones en el bloque de interfaz', errs.length === 0, [...new Set(errs)].slice(0, 5).join(' | '));

summary(results, errs);
await browser.close();
