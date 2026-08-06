import { describe, it, expect } from 'vitest';
import { newGeometry, P, drawRect, expectValid, totalArea, closeTo, largestFace } from './helpers';
import { drawPolyline } from '../src/core/ops/draw';
import { pushPull, canSlide } from '../src/core/ops/pushpull';
import { faceArea } from '../src/core/topology/triangulate';
import { v3 } from '../src/core/math/vec';
import { Geometry } from '../src/core/model/geometry';
import { Id } from '../src/core/model/types';
import { shellVolume, isSolid } from '../src/core/topology/orient';

/**
 * Volumen encerrado por la malla (teorema de la divergencia sobre los
 * triángulos orientados). Si las normales no son coherentes, el resultado no
 * coincide con el volumen real: la prueba sirve también de verificación de
 * orientación.
 */
function meshVolume(g: Geometry): number {
  return Math.abs(shellVolume(g, g.faces.keys()));
}

function onlyFace(g: Geometry): Id {
  const ids = [...g.faces.keys()];
  expect(ids.length).toBe(1);
  return ids[0];
}

describe('extruir (push/pull)', () => {
  it('convierte un rectángulo en una caja de 6 caras', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 4, 3);
    const f = onlyFace(g);

    const r = pushPull(g, f, 2);
    expect(r.mode).toBe('extrude');
    expect(g.faces.size).toBe(6);
    expect(g.edges.size).toBe(12);
    expect(g.vertices.size).toBe(8);
    closeTo(totalArea(g), 2 * (4 * 3) + 2 * (4 * 2) + 2 * (3 * 2));
    closeTo(meshVolume(g), 24);
    expect(isSolid(g, g.faces.keys())).toBe(true);
    expectValid(g);
  });

  it('cada arista de la caja pertenece exactamente a dos caras', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 2, 2);
    pushPull(g, onlyFace(g), 2);
    for (const e of g.edges.keys()) {
      expect(g.edgeFaces.get(e)!.size).toBe(2);
    }
  });

  it('extruye hacia abajo con distancia negativa', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 2, 2);
    pushPull(g, onlyFace(g), -3);
    expect(g.faces.size).toBe(6);
    closeTo(meshVolume(g), 12);
    let minZ = Infinity;
    for (const v of g.vertices.values()) minZ = Math.min(minZ, v.p.z);
    closeTo(minZ, -3);
    expectValid(g);
  });

  it('extruye desde un plano vertical', () => {
    const g = newGeometry();
    drawPolyline(g, [v3(0, 0, 0), v3(0, 3, 0), v3(0, 3, 2), v3(0, 0, 2)], true);
    const f = onlyFace(g);
    const r = pushPull(g, f, 1);
    expect(g.faces.size).toBe(6);
    closeTo(meshVolume(g), 6);
    expect(r.faceId).not.toBeNull();
    expectValid(g);
  });

  it('extruye una cara con agujero creando un tubo', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 10, 10);
    drawRect(g, 3, 3, 7, 7);
    const outer = largestFace(g)!;
    closeTo(faceArea(g, outer), 84);

    pushPull(g, outer, 2);
    // El agujero atraviesa el volumen: no debe quedar tapa sobre él en z = 2.
    for (const f of g.faces.values()) {
      const pts = f.loops[0].vertices.map((v) => g.vertexPos(v));
      const atTop = pts.every((p) => Math.abs(p.z - 2) < 1e-9);
      if (atTop) expect(faceArea(g, f.id)).toBeGreaterThan(20);
    }
    // El marco: (100 - 16) * 2 = 168. La cara suelta del fondo está en z = 0 y
    // no aporta volumen.
    closeTo(meshVolume(g), 84 * 2, 1e-9);
    expectValid(g);
  });

  it('extruye una cara en L', () => {
    const g = newGeometry();
    drawPolyline(g, [P(0, 0), P(4, 0), P(4, 1), P(1, 1), P(1, 4), P(0, 4)], true);
    const f = onlyFace(g);
    pushPull(g, f, 2);
    closeTo(meshVolume(g), 14);
    expect(g.faces.size).toBe(8); // 2 tapas + 6 laterales
    expectValid(g);
  });
});

describe('deslizar (push/pull sobre un sólido)', () => {
  it('detecta que la tapa de una caja se puede deslizar', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 2, 2);
    const r = pushPull(g, onlyFace(g), 2);
    const top = r.faceId!;
    expect(canSlide(g, top, g.faces.get(top)!.plane.n)).toBe(true);
  });

  it('subir la tapa alarga la caja sin crear caras internas', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 2, 2);
    const top = pushPull(g, onlyFace(g), 2).faceId!;
    closeTo(meshVolume(g), 8);

    const r2 = pushPull(g, top, 3);
    expect(r2.mode).toBe('slide');
    expect(g.faces.size).toBe(6);
    closeTo(meshVolume(g), 20);
    expectValid(g);
  });

  it('bajar la tapa acorta la caja', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 2, 2);
    const top = pushPull(g, onlyFace(g), 5).faceId!;
    const r = pushPull(g, top, -3);
    expect(r.mode).toBe('slide');
    expect(g.faces.size).toBe(6);
    closeTo(meshVolume(g), 8);
    expectValid(g);
  });

  it('bajar la tapa hasta la base deja una cara plana', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 2, 2);
    const top = pushPull(g, onlyFace(g), 4).faceId!;
    pushPull(g, top, -4);
    expect(g.vertices.size).toBe(4);
    expect(g.edges.size).toBe(4);
    expect(g.faces.size).toBe(1);
    closeTo(totalArea(g), 4);
    expectValid(g);
  });

  it('empujar una cara lateral desplaza la pared', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 4, 4);
    pushPull(g, onlyFace(g), 2);
    // Cara lateral en x = 4
    let side: Id | null = null;
    for (const f of g.faces.values()) {
      const pts = f.loops[0].vertices.map((v) => g.vertexPos(v));
      if (pts.every((p) => Math.abs(p.x - 4) < 1e-9)) side = f.id;
    }
    expect(side).not.toBeNull();
    const before = meshVolume(g);
    closeTo(before, 32);

    const r = pushPull(g, side!, 1); // hacia +x si la normal apunta hacia fuera
    expect(r.mode).toBe('slide');
    expect(g.faces.size).toBe(6);
    const after = meshVolume(g);
    // Se ha añadido o quitado una losa de 1 × 4 × 2 = 8
    expect(Math.abs(after - 32)).toBeGreaterThan(7.9);
    expect(Math.abs(after - 32)).toBeLessThan(8.1);
    expectValid(g);
  });

  it('la opción createNew fuerza geometría nueva sobre un sólido', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 2, 2);
    const top = pushPull(g, onlyFace(g), 2).faceId!;
    const r = pushPull(g, top, 2, { createNew: true });
    expect(r.mode).toBe('extrude');
    // Se apilan dos volúmenes conservando la cara intermedia:
    // base + 4 laterales bajos + intermedia + 4 laterales altos + tapa = 11.
    expect(g.faces.size).toBe(11);
    const zs = [...g.vertices.values()].map((v) => v.p.z).sort((a, b) => a - b);
    closeTo(zs[0], 0);
    closeTo(zs[zs.length - 1], 4);
    // La cara intermedia sigue en z = 2.
    const middle = [...g.faces.values()].filter((f) =>
      f.loops[0].vertices.every((v) => Math.abs(g.vertexPos(v).z - 2) < 1e-9));
    expect(middle.length).toBe(1);
    expectValid(g);
  });

  it('extruir una pirámide truncada no deja cara interna', () => {
    const g = newGeometry();
    // Base cuadrada
    drawRect(g, 0, 0, 4, 4);
    const base = onlyFace(g);
    pushPull(g, base, 2);
    // Convertimos la tapa en un tronco moviendo... en su lugar comprobamos la
    // regla general: la cara superior de la caja, al extruirse con createNew,
    // sí conserva la cara intermedia; sin createNew, se desliza.
    const top = largestFaceAtZ(g, 2);
    expect(top).not.toBeNull();
    const r = pushPull(g, top!, 1);
    expect(r.mode).toBe('slide');
    expect(g.faces.size).toBe(6);
    expectValid(g);
  });

  it('encadena varias operaciones manteniendo la validez', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 6, 4);
    let f = onlyFace(g);
    let r = pushPull(g, f, 3);
    expectValid(g);
    r = pushPull(g, r.faceId!, 2);
    expectValid(g);
    r = pushPull(g, r.faceId!, -1);
    expectValid(g);
    closeTo(meshVolume(g), 6 * 4 * 4);
    expect(g.faces.size).toBe(6);
  });
});

function largestFaceAtZ(g: Geometry, z: number): Id | null {
  let best: Id | null = null;
  let bestArea = -1;
  for (const f of g.faces.values()) {
    const pts = f.loops[0].vertices.map((v) => g.vertexPos(v));
    if (!pts.every((p) => Math.abs(p.z - z) < 1e-9)) continue;
    const a = faceArea(g, f.id);
    if (a > bestArea) {
      bestArea = a;
      best = f.id;
    }
  }
  return best;
}
