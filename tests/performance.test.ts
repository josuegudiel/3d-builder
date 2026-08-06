import { describe, it, expect } from 'vitest';
import { newGeometry, P, drawRect } from './helpers';
import { drawPolyline, drawSegment } from '../src/core/ops/draw';
import { pushPull } from '../src/core/ops/pushpull';
import { moveEntities } from '../src/core/ops/transform';
import { serializeModel, deserializeModel } from '../src/core/io/serialize';
import { Model } from '../src/core/model/model';
import { v3 } from '../src/core/math/vec';
import { largestFace } from './helpers';

/**
 * Estas pruebas no comprueban corrección sino que las operaciones se mantienen
 * dentro de un presupuesto de tiempo razonable para el uso interactivo. Los
 * márgenes son holgados a propósito: sirven para detectar regresiones de orden
 * de magnitud, no para medir con precisión.
 */

function timed(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

describe('rendimiento', () => {
  it('construye un edificio de 60 volúmenes en un tiempo razonable', () => {
    const g = newGeometry();
    const ms = timed(() => {
      for (let i = 0; i < 60; i++) {
        const x = (i % 10) * 6;
        const y = Math.floor(i / 10) * 6;
        drawRect(g, x, y, x + 4, y + 4);
        const f = largestFaceNear(g, x + 2, y + 2);
        if (f !== null) pushPull(g, f, 2 + (i % 5));
      }
    });
    expect(g.faces.size).toBeGreaterThan(300);
    expect(g.validate()).toEqual([]);
    // Medido: ~230 ms. El presupuesto deja 10× de margen para máquinas lentas,
    // pero detecta cualquier regresión de orden de magnitud.
    expect(ms, `tardó ${ms.toFixed(0)} ms`).toBeLessThan(2500);
  });

  it('mantiene interactivo el dibujo sobre una malla densa', () => {
    const g = newGeometry();
    // Rejilla de 20 × 20 celdas: 441 vértices, 840 aristas, 400 caras.
    for (let i = 0; i <= 20; i++) {
      drawSegment(g, P(i, 0), P(i, 20));
      drawSegment(g, P(0, i), P(20, i));
    }
    expect(g.faces.size).toBe(400);

    // Un trazo más sobre la malla no debe dispararse.
    const ms = timed(() => {
      drawSegment(g, P(0.5, 0.5), P(19.5, 19.5));
    });
    expect(g.validate()).toEqual([]);
    expect(ms, `tardó ${ms.toFixed(0)} ms`).toBeLessThan(300); // medido: ~10 ms
  });

  it('mueve una selección grande sin degradarse', () => {
    const g = newGeometry();
    for (let i = 0; i < 25; i++) {
      const x = (i % 5) * 5;
      const y = Math.floor(i / 5) * 5;
      drawRect(g, x, y, x + 3, y + 3);
    }
    const faces = [...g.faces.keys()];
    const ms = timed(() => {
      moveEntities(g, { faces }, v3(0, 0, 1));
    });
    expect(g.validate()).toEqual([]);
    expect(ms, `tardó ${ms.toFixed(0)} ms`).toBeLessThan(300); // medido: ~5 ms
  });

  it('serializa y deserializa un modelo grande rápidamente', () => {
    const model = new Model();
    const g = model.rootGeometry;
    for (let i = 0; i < 40; i++) {
      const x = (i % 8) * 5;
      const y = Math.floor(i / 8) * 5;
      drawRect(g, x, y, x + 3, y + 3);
      const f = largestFaceNear(g, x + 1.5, y + 1.5);
      if (f !== null) pushPull(g, f, 2);
    }
    let data: ReturnType<typeof serializeModel>;
    const msOut = timed(() => { data = serializeModel(model); });
    const msIn = timed(() => { deserializeModel(data); });
    expect(msOut + msIn, `serializar ${msOut.toFixed(0)} ms, cargar ${msIn.toFixed(0)} ms`)
      .toBeLessThan(1500);
  });

  it('el coste de dibujar no se dispara con muchas caras coplanares', () => {
    const g = newGeometry();
    // 400 rectángulos disjuntos en el mismo plano: 1604 aristas coplanares.
    for (let i = 0; i < 400; i++) {
      const x = (i % 20) * 3;
      const y = Math.floor(i / 20) * 3;
      drawRect(g, x, y, x + 2, y + 2);
    }
    expect(g.faces.size).toBe(400);

    // Una operación más sobre ese plano debe seguir siendo instantánea. Antes
    // costaba 49 ms porque cada ciclo negativo del arreglo se probaba contra
    // todos los positivos; ahora son ~5 ms.
    const ms = timed(() => {
      drawRect(g, 70, 0, 72, 2);
    });
    expect(g.faces.size).toBe(401);
    expect(g.validate()).toEqual([]);
    expect(ms, `tardó ${ms.toFixed(0)} ms`).toBeLessThan(120);
  });

  it('crea un polígono de 128 lados y lo extruye', () => {
    const g = newGeometry();
    const pts: ReturnType<typeof v3>[] = [];
    for (let i = 0; i < 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      pts.push(v3(Math.cos(a) * 3, Math.sin(a) * 3, 0));
    }
    const ms = timed(() => {
      drawPolyline(g, pts, true);
      const f = largestFace(g);
      if (f !== null) pushPull(g, f, 2);
    });
    expect(g.faces.size).toBe(130); // 128 laterales + 2 tapas
    expect(g.validate()).toEqual([]);
    expect(ms, `tardó ${ms.toFixed(0)} ms`).toBeLessThan(800); // medido: ~42 ms
  });
});

/** Cara de mayor área cuyo centro está cerca del punto indicado. */
function largestFaceNear(g: ReturnType<typeof newGeometry>, x: number, y: number): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const f of g.faces.values()) {
    const pts = f.loops[0].vertices.map((v) => g.vertexPos(v));
    if (!pts.every((p) => Math.abs(p.z) < 1e-9)) continue;
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p.x / pts.length;
      cy += p.y / pts.length;
    }
    const d = Math.hypot(cx - x, cy - y);
    if (d < bestD) {
      bestD = d;
      best = f.id;
    }
  }
  return best;
}
