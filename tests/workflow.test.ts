import { describe, it, expect } from 'vitest';
import { newGeometry, expectValid, closeTo, totalArea } from './helpers';
import { drawPolyline } from '../src/core/ops/draw';
import { pushPull } from '../src/core/ops/pushpull';
import { offsetFace } from '../src/core/ops/offset';
import { eraseFacesWithEdges, eraseFaces } from '../src/core/ops/erase';
import { moveEntities } from '../src/core/ops/transform';
import { findOverlappingEdges } from '../src/core/topology/repair';
import { faceArea } from '../src/core/topology/triangulate';
import { shellVolume } from '../src/core/topology/orient';
import { exportSTLAscii } from '../src/core/io/stl';
import { serializeToJSON, deserializeModel } from '../src/core/io/serialize';
import { Model } from '../src/core/model/model';
import { Geometry } from '../src/core/model/geometry';
import { Id } from '../src/core/model/types';
import { v3 } from '../src/core/math/vec';
import { drawRect } from './helpers';

/**
 * Flujos de trabajo completos, encadenando las mismas operaciones que hace un
 * usuario. Son las pruebas que de verdad demuestran que el modelador sirve:
 * cada una construye algo reconocible y comprueba medidas exactas.
 */

function faceOn(g: Geometry, test: (pts: ReturnType<typeof v3>[]) => boolean): Id | null {
  let best: Id | null = null;
  let bestArea = -1;
  for (const f of g.faces.values()) {
    const pts = f.loops[0].vertices.map((v) => g.vertexPos(v));
    if (!test(pts)) continue;
    const a = faceArea(g, f.id);
    if (a > bestArea) {
      bestArea = a;
      best = f.id;
    }
  }
  return best;
}

const atZ = (z: number) => (pts: ReturnType<typeof v3>[]) =>
  pts.every((p) => Math.abs(p.z - z) < 1e-9);

const atX = (x: number) => (pts: ReturnType<typeof v3>[]) =>
  pts.every((p) => Math.abs(p.x - x) < 1e-9);

describe('construir una casa sencilla', () => {
  it('cerramiento hueco con muros de 200 mm y hueco de puerta', () => {
    const g = newGeometry();

    // 1. Planta de 6 × 8 m.
    drawRect(g, 0, 0, 6, 8);
    expect(g.faces.size).toBe(1);
    closeTo(totalArea(g), 48);

    // 2. Levantar 3 m.
    const planta = [...g.faces.keys()][0];
    pushPull(g, planta, 3);
    expect(g.faces.size).toBe(6);
    closeTo(Math.abs(shellVolume(g, g.faces.keys())), 6 * 8 * 3);
    expectValid(g);

    // 3. Equidistancia de 200 mm en la cubierta: aparece el anillo del muro.
    const cubierta = faceOn(g, atZ(3))!;
    const off = offsetFace(g, cubierta, 0.2);
    expect(off).not.toBeNull();

    // En z = 3 quedan ahora dos caras: el anillo del muro y la losa interior.
    const enCubierta = [...g.faces.keys()].filter((f) =>
      atZ(3)(g.faces.get(f)!.loops[0].vertices.map((v) => g.vertexPos(v))));
    expect(enCubierta.length).toBe(2);
    const areas = enCubierta.map((f) => faceArea(g, f)).sort((a, b) => a - b);
    closeTo(areas[0], 6 * 8 - 5.6 * 7.6, 1e-9); // anillo de 200 mm
    closeTo(areas[1], 5.6 * 7.6, 1e-9);         // hueco interior
    expectValid(g);

    // 4. Hundir la cara interior hasta el suelo: el volumen queda hueco.
    const interior = [...g.faces.keys()].find((f) => {
      const pts = g.faces.get(f)!.loops[0].vertices.map((v) => g.vertexPos(v));
      return atZ(3)(pts) && Math.abs(faceArea(g, f) - 5.6 * 7.6) < 1e-9;
    })!;
    pushPull(g, interior, -3);

    expectValid(g);
    expect(findOverlappingEdges(g)).toEqual([]);

    // Los muros: perímetro exterior menos el interior, por la altura.
    const volumenMuros = 6 * 8 * 3 - 5.6 * 7.6 * 3;
    // El sólido resultante encierra exactamente el material de los muros más
    // el forjado inferior (que sigue siendo macizo: el hueco no lo atraviesa).
    const v = Math.abs(shellVolume(g, g.faces.keys()));
    expect(v, `volumen ${v}`).toBeGreaterThan(volumenMuros * 0.99);
    expect(v).toBeLessThan(6 * 8 * 3);

    // 5. Hueco de puerta en el muro x = 0: se dibuja y se borra la cara.
    const muro = faceOn(g, atX(0))!;
    expect(muro).not.toBeNull();
    drawPolyline(g, [
      v3(0, 2.5, 0), v3(0, 3.6, 0), v3(0, 3.6, 2.1), v3(0, 2.5, 2.1),
    ], true);
    expectValid(g);

    const puerta = [...g.faces.keys()].find((f) => {
      const pts = g.faces.get(f)!.loops[0].vertices.map((v) => g.vertexPos(v));
      return atX(0)(pts) && Math.abs(faceArea(g, f) - 1.1 * 2.1) < 1e-9;
    });
    expect(puerta, 'no se ha formado la cara de la puerta').toBeDefined();

    eraseFaces(g, [puerta!]);
    const sigue = [...g.faces.keys()].some((f) => {
      const pts = g.faces.get(f)!.loops[0].vertices.map((v) => g.vertexPos(v));
      return atX(0)(pts) && Math.abs(faceArea(g, f) - 1.1 * 2.1) < 1e-9;
    });
    expect(sigue, 'la cara de la puerta no se ha borrado').toBe(false);
    expectValid(g);
  });

  it('una escalera de seis peldaños con medidas exactas', () => {
    const g = newGeometry();
    const huella = 0.28;
    const contrahuella = 0.18;
    const ancho = 1;

    // Perfil lateral en el plano y = 0.
    const perfil: ReturnType<typeof v3>[] = [v3(0, 0, 0)];
    for (let i = 0; i < 6; i++) {
      perfil.push(v3(i * huella, 0, (i + 1) * contrahuella));
      perfil.push(v3((i + 1) * huella, 0, (i + 1) * contrahuella));
    }
    perfil.push(v3(6 * huella, 0, 0));

    drawPolyline(g, perfil, true);
    expect(g.faces.size).toBe(1);

    const cara = [...g.faces.keys()][0];
    const areaPerfil = faceArea(g, cara);
    // Suma de rectángulos: cada peldaño aporta huella × altura acumulada.
    let esperado = 0;
    for (let i = 0; i < 6; i++) esperado += huella * (i + 1) * contrahuella;
    closeTo(areaPerfil, esperado, 1e-9);

    pushPull(g, cara, ancho);
    expectValid(g);
    expect(findOverlappingEdges(g)).toEqual([]);
    closeTo(Math.abs(shellVolume(g, g.faces.keys())), esperado * ancho, 1e-9);

    // Altura total y huella total exactas.
    let maxZ = -Infinity;
    let maxX = -Infinity;
    for (const v of g.vertices.values()) {
      maxZ = Math.max(maxZ, v.p.z);
      maxX = Math.max(maxX, v.p.x);
    }
    closeTo(maxZ, 6 * contrahuella, 1e-12);
    closeTo(maxX, 6 * huella, 1e-12);
  });

  it('una mesa: tablero y cuatro patas como grupos independientes', () => {
    const model = new Model();
    const raiz = model.rootGeometry;

    const tableroDef = model.createDefinition('group', 'Tablero');
    drawRect(tableroDef.geometry, 0, 0, 1.6, 0.9, 0.72);
    const tapa = [...tableroDef.geometry.faces.keys()][0];
    pushPull(tableroDef.geometry, tapa, 0.04);
    expect(tableroDef.geometry.faces.size).toBe(6);

    const pataDef = model.createDefinition('component', 'Pata');
    drawRect(pataDef.geometry, 0, 0, 0.07, 0.07);
    pushPull(pataDef.geometry, [...pataDef.geometry.faces.keys()][0], 0.72);

    raiz.addInstance({
      definitionId: tableroDef.id,
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      name: 'Tablero', materialId: 'madera', hidden: false, locked: false,
    });
    const posiciones = [[0.05, 0.05], [1.48, 0.05], [1.48, 0.78], [0.05, 0.78]];
    for (const [x, y] of posiciones) {
      raiz.addInstance({
        definitionId: pataDef.id,
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1],
        name: 'Pata', materialId: 'madera', hidden: false, locked: false,
      });
    }
    model.recountInstances();

    // Un componente, cuatro instancias: editar la definición cambia las cuatro.
    expect(model.definitions.get(pataDef.id)!.instanceCount).toBe(4);
    expect(raiz.instances.size).toBe(5);

    // La caja envolvente del conjunto es la de la mesa.
    const b = model.bounds();
    closeTo(b.min.x, 0, 1e-12);
    closeTo(b.max.x, 1.6, 1e-12);
    closeTo(b.max.z, 0.76, 1e-12);

    // Exportar e importar no cambia nada.
    const json = serializeToJSON(model);
    const round = deserializeModel(json);
    expect(round.stats()).toEqual(model.stats());
    const stl = exportSTLAscii(model);
    expect((stl.match(/facet normal/g) ?? []).length).toBeGreaterThan(50);

    for (const def of model.definitions.values()) expectValid(def.geometry);
  });

  it('mover una pared estira el suelo conectado', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 4, 4);
    pushPull(g, [...g.faces.keys()][0], 2);

    const pared = faceOn(g, (pts) => pts.every((p) => Math.abs(p.x - 4) < 1e-9))!;
    moveEntities(g, { faces: [pared] }, v3(2, 0, 0));

    expectValid(g);
    expect(findOverlappingEdges(g)).toEqual([]);
    expect(g.faces.size).toBe(6);
    closeTo(Math.abs(shellVolume(g, g.faces.keys())), 6 * 4 * 2, 1e-9);
  });

  it('borrar una cara con sus aristas abre el volumen', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 2, 2);
    pushPull(g, [...g.faces.keys()][0], 2);
    const tapa = faceOn(g, atZ(2))!;
    eraseFacesWithEdges(g, [tapa]);
    expectValid(g);
    // Sin la tapa quedan las cuatro paredes y el suelo.
    expect(g.faces.size).toBe(5);
  });
});
