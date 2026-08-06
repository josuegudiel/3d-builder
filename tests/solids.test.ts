import { describe, it, expect } from 'vitest';
import { newGeometry, expectValid, closeTo, totalArea } from './helpers';
import {
  makeBox, makeCylinder, makeCone, makeSphere, makePyramid, makeTube, makeWedge, SOLIDS,
} from '../src/core/ops/solids';
import { shellVolume, isSolid } from '../src/core/topology/orient';

function volume(g: ReturnType<typeof newGeometry>): number {
  return Math.abs(shellVolume(g, g.faces.keys()));
}

describe('sólidos paramétricos', () => {
  it('la caja tiene 6 caras, 12 aristas y el volumen exacto', () => {
    const g = newGeometry();
    makeBox(g, 2, 3, 4);
    expect(g.faces.size).toBe(6);
    expect(g.edges.size).toBe(12);
    expect(g.vertices.size).toBe(8);
    closeTo(volume(g), 24);
    closeTo(totalArea(g), 2 * (2 * 3 + 2 * 4 + 3 * 4));
    expect(isSolid(g, g.faces.keys())).toBe(true);
    expectValid(g);
  });

  it('el cilindro tiene el volumen del prisma regular', () => {
    const g = newGeometry();
    const n = 24;
    const r = 1.5;
    const h = 2;
    makeCylinder(g, r, h, n);
    expect(g.faces.size).toBe(n + 2);
    expect(g.vertices.size).toBe(n * 2);
    const expected = 0.5 * n * r * r * Math.sin((2 * Math.PI) / n) * h;
    closeTo(volume(g), expected, 1e-9);
    expect(isSolid(g, g.faces.keys())).toBe(true);
    expectValid(g);
  });

  it('el cono tiene un tercio del volumen del cilindro equivalente', () => {
    const g = newGeometry();
    const n = 36;
    const r = 1;
    const h = 3;
    makeCone(g, r, h, n);
    expect(g.faces.size).toBe(n + 1);
    const base = 0.5 * n * r * r * Math.sin((2 * Math.PI) / n);
    closeTo(volume(g), (base * h) / 3, 1e-9);
    expect(isSolid(g, g.faces.keys())).toBe(true);
    expectValid(g);
  });

  it('la esfera se aproxima a 4/3·π·r³ y es un sólido cerrado', () => {
    const g = newGeometry();
    const r = 1;
    makeSphere(g, r, 48, 24);
    const exact = (4 / 3) * Math.PI * r ** 3;
    const v = volume(g);
    // Una malla de 48 × 24 se queda algo por debajo del volumen exacto.
    expect(v).toBeLessThan(exact);
    expect(v).toBeGreaterThan(exact * 0.99);
    expect(isSolid(g, g.faces.keys())).toBe(true);
    expectValid(g);
  });

  it('la esfera apoya en el suelo', () => {
    const g = newGeometry();
    makeSphere(g, 2, 16, 8);
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const v of g.vertices.values()) {
      minZ = Math.min(minZ, v.p.z);
      maxZ = Math.max(maxZ, v.p.z);
    }
    closeTo(minZ, 0, 1e-12);
    closeTo(maxZ, 4, 1e-12);
  });

  it('la pirámide de base cuadrada tiene 5 caras', () => {
    const g = newGeometry();
    makePyramid(g, Math.SQRT2 / 2, 3, 4);
    expect(g.faces.size).toBe(5);
    // Base cuadrada de lado 1 (radio a los vértices = √2/2).
    closeTo(volume(g), (1 * 3) / 3, 1e-9);
    expect(isSolid(g, g.faces.keys())).toBe(true);
    expectValid(g);
  });

  it('el tubo tiene el volumen de la corona por la altura', () => {
    const g = newGeometry();
    const n = 32;
    const ro = 1;
    const ri = 0.6;
    const h = 2;
    makeTube(g, ro, ri, h, n);
    const areaRing = 0.5 * n * Math.sin((2 * Math.PI) / n) * (ro * ro - ri * ri);
    closeTo(volume(g), areaRing * h, 1e-9);
    expect(isSolid(g, g.faces.keys())).toBe(true);
    expectValid(g);
  });

  it('el tubo con radio interior nulo es un cilindro', () => {
    const g = newGeometry();
    makeTube(g, 1, 0, 2, 12);
    expect(g.faces.size).toBe(14);
    expectValid(g);
  });

  it('la cuña tiene la mitad del volumen de su caja', () => {
    const g = newGeometry();
    makeWedge(g, 2, 3, 4);
    expect(g.faces.size).toBe(5);
    closeTo(volume(g), (2 * 3 * 4) / 2, 1e-9);
    expect(isSolid(g, g.faces.keys())).toBe(true);
    expectValid(g);
  });

  it('rechaza parámetros degenerados sin lanzar excepciones', () => {
    const g = newGeometry();
    expect(makeBox(g, 0, 1, 1).faces).toEqual([]);
    expect(makeCylinder(g, 1, 1, 2).faces).toEqual([]);
    expect(makeCone(g, -1, 1, 12).faces).toEqual([]);
    expect(makeSphere(g, 1, 2, 4).faces).toEqual([]);
    expect(makePyramid(g, 1, 1, 2).faces).toEqual([]);
    expect(g.faces.size).toBe(0);
  });

  it('todos los sólidos del catálogo se construyen con sus valores por defecto', () => {
    for (const def of SOLIDS) {
      const g = newGeometry();
      const values: Record<string, number> = {};
      for (const p of def.params) values[p.key] = p.defaultValue;
      const result = def.build(g, values);
      expect(result.faces.length, `${def.label}: sin caras`).toBeGreaterThan(3);
      expect(isSolid(g, g.faces.keys()), `${def.label}: no es un sólido cerrado`).toBe(true);
      expect(volume(g), `${def.label}: volumen no positivo`).toBeGreaterThan(0);
      expectValid(g);
    }
  });
});
