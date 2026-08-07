/**
 * Comprobaciones de interfaz: cada una reproduce un problema real encontrado
 * conduciendo la aplicación a mano, para que no vuelva.
 *
 *   node tests/e2e/ux.mjs [url]
 */
import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
await page.goto(process.argv[2] ?? 'http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
const box = await page.locator('canvas').boundingBox();
const ok = [];
const check = (n, c, d='') => { ok.push([n,c,d]); console.log((c?'✓':'✗')+' '+n+(d?' — '+d:'')); };

// 1. Ctrl+A + Supr y deshacer
await page.keyboard.press('r'); await page.waitForTimeout(80);
await page.mouse.click(box.x+400, box.y+400); await page.waitForTimeout(80);
await page.mouse.move(box.x+600, box.y+300); await page.waitForTimeout(80);
await page.fill('.vcb input','3000;2000'); await page.press('.vcb input','Enter'); await page.waitForTimeout(200);
await page.keyboard.press('v'); await page.waitForTimeout(80);
await page.keyboard.press('Control+a'); await page.waitForTimeout(150);
await page.keyboard.press('Delete'); await page.waitForTimeout(250);
let st = await page.evaluate(()=>window.form3d.editor.model.visibleStats());
check('Supr borra todo', st.edges===0, JSON.stringify(st));
await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
st = await page.evaluate(()=>window.form3d.editor.model.visibleStats());
check('Ctrl+Z lo restaura', st.edges===4, JSON.stringify(st));
check('sin excepciones al borrar+deshacer', errs.length===0, errs.slice(0,2).join(' | '));

// 2. Diálogo de atajos: visible desde el principio y cierra con Escape
errs.length = 0;
await page.keyboard.press('?'); await page.waitForTimeout(300);
const pos = await page.evaluate(()=>{
  const m=document.querySelector('.modal'); const h=m.querySelector('h2');
  const k=m.querySelector('.help-grid kbd');
  const mr=m.getBoundingClientRect();
  return { titulo: h.getBoundingClientRect().top - mr.top, primerAtajo: k.getBoundingClientRect().top - mr.top, texto: k.textContent };
});
check('el diálogo de atajos abre por el principio', pos.titulo >= -2 && pos.primerAtajo >= 0, JSON.stringify(pos));
await page.keyboard.press('5'); await page.waitForTimeout(150);
const vcb = await page.inputValue('.vcb input');
check('el teclado no se filtra al cuadro de medidas', vcb === '', `valor="${vcb}"`);
await page.keyboard.press('?'); await page.waitForTimeout(200);
const n = await page.locator('.modal-backdrop').count();
check('no se apilan diálogos', n === 1, `${n} diálogos`);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
check('Escape cierra el diálogo', await page.locator('.modal-backdrop').count() === 0);

// 3. Arrastrar para dibujar un rectángulo
await page.evaluate(()=>window.form3d.editor.replaceModel(new (window.form3d.editor.model.constructor)()));
await page.waitForTimeout(150);
await page.keyboard.press('r'); await page.waitForTimeout(80);
await page.mouse.move(box.x+400, box.y+400);
await page.mouse.down(); await page.waitForTimeout(60);
await page.mouse.move(box.x+560, box.y+330, {steps:6}); await page.waitForTimeout(120);
await page.mouse.up(); await page.waitForTimeout(250);
st = await page.evaluate(()=>window.form3d.editor.model.visibleStats());
check('arrastrar crea el rectángulo', st.faces===1, JSON.stringify(st));

// 4. Clic que cierra un menú no dibuja
await page.keyboard.press('l'); await page.waitForTimeout(80);
await page.click('.menu:nth-of-type(3) > button'); await page.waitForTimeout(150);
await page.mouse.click(box.x+300, box.y+520); await page.waitForTimeout(200);
const puntos = await page.evaluate(()=>window.form3d.editor.tool.points?.length ?? -1);
check('cerrar un menú no coloca un punto', puntos === 0, `puntos=${puntos}`);

// 5. Zoom con rueda proporcional
await page.keyboard.press('v'); await page.waitForTimeout(80);
const d0 = await page.evaluate(()=>window.form3d.viewport.cameraCtl.distance);
await page.mouse.move(box.x+400, box.y+400);
await page.mouse.wheel(0, -4); await page.waitForTimeout(120);
const d1 = await page.evaluate(()=>window.form3d.viewport.cameraCtl.distance);
await page.mouse.wheel(0, -100); await page.waitForTimeout(120);
const d2 = await page.evaluate(()=>window.form3d.viewport.cameraCtl.distance);
// La cantidad de zoom es logarítmica: se compara cuánto zoom aporta cada
// evento, no la razón de distancias.
const z1 = Math.log(d0/d1), z2 = Math.log(d1/d2);
const proporcion = z2 / z1;
check('la rueda respeta la magnitud del gesto',
  proporcion > 15 && proporcion < 40,
  `un roce (deltaY 4) aporta ${(z1*100).toFixed(2)}% y una muesca (deltaY 100) ${(z2*100).toFixed(2)}%: ×${proporcion.toFixed(1)}`);

// 6. stats visibles tras borrar un grupo
await page.evaluate(()=>{
  const app = window.form3d;
  app.editor.replaceModel(new (app.editor.model.constructor)());
  app.api.solid('box', {});
});
await page.waitForTimeout(250);
let vs = await page.evaluate(()=>window.form3d.editor.model.visibleStats());
check('la caja insertada se cuenta', vs.faces===6, JSON.stringify(vs));
await page.keyboard.press('Delete'); await page.waitForTimeout(250);
vs = await page.evaluate(()=>window.form3d.editor.model.visibleStats());
check('tras borrarla el panel no cuenta geometría fantasma', vs.faces===0, JSON.stringify(vs));

// 7. Explotar conserva el suavizado
await page.evaluate(()=>{
  const app = window.form3d;
  app.editor.replaceModel(new (app.editor.model.constructor)());
  app.api.solid('cylinder', { radius: 0.5, height: 1, segments: 24 });
});
await page.waitForTimeout(250);
const antes = await page.evaluate(()=>{
  const app=window.form3d; const inst=[...app.editor.geometry.instances.values()][0];
  const def=app.editor.model.definitions.get(inst.definitionId);
  return [...def.geometry.edges.values()].filter(e=>e.soft).length;
});
await page.evaluate(()=>{
  const app=window.form3d; const inst=[...app.editor.geometry.instances.values()][0];
  app.api.select({ instances:[inst.id] }); app.api.explode(inst.id);
});
await page.waitForTimeout(300);
const despues = await page.evaluate(()=>[...window.form3d.editor.geometry.edges.values()].filter(e=>e.soft).length);
check('explotar conserva las aristas suaves', despues >= antes*0.9, `${antes} → ${despues}`);

// 8. Las aristas del fondo de una cara se pueden señalar
await page.evaluate(()=>{
  const app = window.form3d;
  app.editor.replaceModel(new (app.editor.model.constructor)());
  app.api.rectangle(0, 0, 2, 1.5);
  app.api.zoomExtents();
});
await page.waitForTimeout(300);
const midpuntos = await page.evaluate(()=>{
  const app=window.form3d, g=app.editor.geometry;
  return [...g.edges.keys()].map(e=>{ const [p,q]=g.edgeEndpoints(e);
    const m={x:(p.x+q.x)/2,y:(p.y+q.y)/2,z:(p.z+q.z)/2}; const s=app.viewport.worldToScreen(m);
    return {e, x:s.x, y:s.y}; });
});
const señaladas = [];
for (const {e,x,y} of midpuntos) {
  await page.mouse.move(box.x+x, box.y+y); await page.waitForTimeout(90);
  const h = await page.evaluate(()=>window.form3d.editor.tool?.hovered ?? null);
  señaladas.push(h && h.kind==='edge' && h.id===e);
}
check('las cuatro aristas de una cara se pueden señalar',
  señaladas.length===4 && señaladas.every(Boolean), JSON.stringify(señaladas));

// 9. Pero una arista tapada por un sólido sigue sin poder señalarse
await page.evaluate(()=>{
  const app = window.form3d;
  app.editor.replaceModel(new (app.editor.model.constructor)());
  app.api.solid('box', { width: 1, depth: 1, height: 1 });
  app.api.zoomExtents();
});
await page.waitForTimeout(300);
const tapada = await page.evaluate(()=>{
  const app=window.form3d;
  const inst=[...app.editor.geometry.instances.values()][0];
  const def=app.editor.model.definitions.get(inst.definitionId);
  const g=def.geometry;
  // La arista más lejana a la cámara.
  const fwd=app.viewport.cameraCtl.forward;
  let best=null, bestD=-Infinity;
  for (const e of g.edges.keys()) {
    const [p,q]=g.edgeEndpoints(e);
    const m={x:(p.x+q.x)/2,y:(p.y+q.y)/2,z:(p.z+q.z)/2};
    const d=m.x*fwd.x+m.y*fwd.y+m.z*fwd.z;
    if (d>bestD) { bestD=d; best={e,m}; }
  }
  const s=app.viewport.worldToScreen(best.m);
  return { x:s.x, y:s.y };
});
await page.mouse.move(box.x+tapada.x, box.y+tapada.y); await page.waitForTimeout(120);
const hTapada = await page.evaluate(()=>window.form3d.editor.tool?.hovered ?? null);
check('una arista tapada por el sólido no se señala',
  !hTapada || hTapada.kind !== 'edge', JSON.stringify(hTapada));

// 10. Una arista a 20 mm por detrás de una cara opaca no se puede señalar
await page.evaluate(()=>{
  const app = window.form3d;
  app.editor.replaceModel(new (app.editor.model.constructor)());
  const api = app.api;
  // Cara de 1 x 1 m en el plano XZ y una arista 20 mm por detrás.
  api.polyline([api.p(0,0,0), api.p(1,0,0), api.p(1,0,1), api.p(0,0,1)], true);
  api.segment(api.p(0.2,0.02,0.5), api.p(0.8,0.02,0.5));
  api.view('front');
  api.zoomExtents();
});
await page.waitForTimeout(350);
const detras = await page.evaluate(()=>{
  const s = window.form3d.viewport.worldToScreen({x:0.5,y:0.02,z:0.5});
  return { x:s.x, y:s.y };
});
await page.mouse.move(box.x+detras.x, box.y+detras.y); await page.waitForTimeout(150);
const hDetras = await page.evaluate(()=>window.form3d.editor.tool?.hovered ?? null);
check('una arista 20 mm detrás de una cara no se señala',
  hDetras !== null && hDetras.kind === 'face', JSON.stringify(hDetras));

check('sin errores de consola', errs.length===0, errs.slice(0,2).join(' | '));
const bad = ok.filter(o=>!o[1]);
console.log(`\n${ok.length-bad.length}/${ok.length} correctas`);
await browser.close();
process.exit(bad.length ? 1 : 0);
