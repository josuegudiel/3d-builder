import { expect } from 'vitest';
import { Geometry, IdAllocator } from '../src/core/model/geometry';
import { Model } from '../src/core/model/model';
import { Id } from '../src/core/model/types';
import { Vec3, v3 } from '../src/core/math/vec';
import { drawPolyline } from '../src/core/ops/draw';
import { faceArea } from '../src/core/topology/triangulate';

export function newGeometry(): Geometry {
  return new Geometry(new IdAllocator(1));
}

export function newModel(): Model {
  return new Model();
}

export function P(x: number, y: number, z = 0): Vec3 {
  return v3(x, y, z);
}

/** Dibuja un rectángulo en el plano Z=z definido por dos esquinas opuestas. */
export function drawRect(
  geo: Geometry,
  x0: number, y0: number, x1: number, y1: number, z = 0,
): void {
  drawPolyline(geo, [P(x0, y0, z), P(x1, y0, z), P(x1, y1, z), P(x0, y1, z)], true);
}

/** Dibuja un rectángulo vertical en el plano X = x. */
export function drawRectYZ(
  geo: Geometry,
  y0: number, z0: number, y1: number, z1: number, x = 0,
): void {
  drawPolyline(geo, [v3(x, y0, z0), v3(x, y1, z0), v3(x, y1, z1), v3(x, y0, z1)], true);
}

/** Comprueba los invariantes de la geometría y falla con un mensaje legible. */
export function expectValid(geo: Geometry): void {
  const errs = geo.validate();
  expect(errs, `Invariantes rotos:\n  ${errs.join('\n  ')}`).toEqual([]);
}

/** Área total de todas las caras. */
export function totalArea(geo: Geometry): number {
  let a = 0;
  for (const f of geo.faces.keys()) a += faceArea(geo, f);
  return a;
}

/** Áreas de todas las caras, ordenadas de mayor a menor. */
export function faceAreas(geo: Geometry): number[] {
  return [...geo.faces.keys()].map((f) => faceArea(geo, f)).sort((x, y) => y - x);
}

/** Id de la cara de mayor área. */
export function largestFace(geo: Geometry): Id | null {
  let best: Id | null = null;
  let bestA = -1;
  for (const f of geo.faces.keys()) {
    const a = faceArea(geo, f);
    if (a > bestA) {
      bestA = a;
      best = f;
    }
  }
  return best;
}

/** Aproximación con tolerancia relativa cómoda para pruebas geométricas. */
export function closeTo(actual: number, expected: number, eps = 1e-9): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(eps);
}
