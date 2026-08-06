import { describe, it, expect } from 'vitest';
import { newGeometry, P, drawRect, expectValid, faceAreas, totalArea, closeTo } from './helpers';
import { drawPolyline, drawSegment } from '../src/core/ops/draw';
import { eraseEdges, eraseFaces } from '../src/core/ops/erase';
import { faceArea, triangulateFace, faceGeometricNormal } from '../src/core/topology/triangulate';
import { v3, dot } from '../src/core/math/vec';

describe('inserción de aristas', () => {
  it('crea una cadena simple sin duplicar aristas', () => {
    const g = newGeometry();
    drawSegment(g, P(0, 0), P(1, 0));
    expect(g.edges.size).toBe(1);
    expect(g.vertices.size).toBe(2);

    // Redibujar el mismo segmento no debe crear nada nuevo.
    const r = drawSegment(g, P(0, 0), P(1, 0));
    expect(g.edges.size).toBe(1);
    expect(r.insert.newEdges.length).toBe(0);
    expect(r.insert.retracedEdges.length).toBe(1);
    expectValid(g);
  });

  it('parte una arista existente cuando otra la cruza', () => {
    const g = newGeometry();
    drawSegment(g, P(-1, 0), P(1, 0));
    drawSegment(g, P(0, -1), P(0, 1));
    // Dos aristas cruzadas → 4 subaristas y 5 vértices.
    expect(g.edges.size).toBe(4);
    expect(g.vertices.size).toBe(5);
    expectValid(g);
  });

  it('parte una arista al apoyar un extremo en su interior (unión en T)', () => {
    const g = newGeometry();
    drawSegment(g, P(0, 0), P(2, 0));
    drawSegment(g, P(1, 0), P(1, 1));
    expect(g.edges.size).toBe(3);
    expect(g.vertices.size).toBe(4);
    expectValid(g);
  });

  it('parte un segmento nuevo al atravesar un vértice existente', () => {
    const g = newGeometry();
    drawSegment(g, P(1, 0), P(1, 1));
    drawSegment(g, P(0, 0), P(2, 0));
    expect(g.edges.size).toBe(3);
    expectValid(g);
  });

  it('trata correctamente los solapamientos colineales', () => {
    const g = newGeometry();
    drawSegment(g, P(0, 0), P(4, 0));
    drawSegment(g, P(1, 0), P(3, 0));
    // El segmento interior parte al primero en tres tramos.
    expect(g.edges.size).toBe(3);
    expect(g.vertices.size).toBe(4);
    expectValid(g);
  });

  it('extiende una arista colineal más allá de su extremo', () => {
    const g = newGeometry();
    drawSegment(g, P(0, 0), P(1, 0));
    drawSegment(g, P(1, 0), P(2, 0));
    expect(g.edges.size).toBe(2);
    expect(g.vertices.size).toBe(3);
    expectValid(g);
  });

  it('ignora segmentos degenerados', () => {
    const g = newGeometry();
    const r = drawSegment(g, P(0, 0), P(0, 0));
    expect(r.insert.newEdges.length).toBe(0);
    expect(g.edges.size).toBe(0);
  });
});

describe('formación de caras', () => {
  it('un rectángulo cerrado genera exactamente una cara', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 4, 3);
    expect(g.faces.size).toBe(1);
    closeTo(totalArea(g), 12);
    expectValid(g);
  });

  it('un triángulo genera una cara con el área correcta', () => {
    const g = newGeometry();
    drawPolyline(g, [P(0, 0), P(3, 0), P(0, 4)], true);
    expect(g.faces.size).toBe(1);
    closeTo(totalArea(g), 6);
    expectValid(g);
  });

  it('no genera cara si el contorno queda abierto', () => {
    const g = newGeometry();
    drawPolyline(g, [P(0, 0), P(1, 0), P(1, 1)], false);
    expect(g.faces.size).toBe(0);
    expectValid(g);
  });

  it('una diagonal parte el rectángulo en dos caras', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 2, 2);
    expect(g.faces.size).toBe(1);
    drawSegment(g, P(0, 0), P(2, 2));
    expect(g.faces.size).toBe(2);
    closeTo(totalArea(g), 4);
    expect(faceAreas(g)).toEqual([2, 2]);
    expectValid(g);
  });

  it('una línea de lado a lado parte el rectángulo', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 4, 2);
    drawSegment(g, P(1, 0), P(1, 2));
    expect(g.faces.size).toBe(2);
    expect(faceAreas(g)).toEqual([6, 2]);
    expectValid(g);
  });

  it('un rectángulo interior crea un agujero y una cara propia', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 10, 10);
    drawRect(g, 3, 3, 7, 7);
    expect(g.faces.size).toBe(2);
    const areas = faceAreas(g);
    // La cara exterior tiene un agujero: 100 - 16 = 84. La interior mide 16.
    closeTo(areas[0], 84);
    closeTo(areas[1], 16);
    expectValid(g);
  });

  it('soporta agujeros anidados a tres niveles', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 12, 12);
    drawRect(g, 2, 2, 10, 10);
    drawRect(g, 4, 4, 8, 8);
    expect(g.faces.size).toBe(3);
    const areas = faceAreas(g);
    closeTo(areas[0], 144 - 64);
    closeTo(areas[1], 64 - 16);
    closeTo(areas[2], 16);
    expectValid(g);
  });

  it('una arista colgante dentro de la cara no la divide', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 4, 4);
    drawSegment(g, P(1, 1), P(3, 3));
    expect(g.faces.size).toBe(1);
    closeTo(totalArea(g), 16);
    expectValid(g);
  });

  it('una arista colgante que toca el contorno tampoco lo divide', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 4, 4);
    drawSegment(g, P(0, 2), P(2, 2));
    expect(g.faces.size).toBe(1);
    closeTo(totalArea(g), 16);
    const f = [...g.faces.keys()][0];
    const t = triangulateFace(g, f);
    expect(t).not.toBeNull();
    expectValid(g);
  });

  it('borrar la arista divisoria vuelve a fundir las caras', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 4, 2);
    drawSegment(g, P(2, 0), P(2, 2));
    expect(g.faces.size).toBe(2);

    // Localizar la arista divisoria y borrarla.
    let divider = -1;
    for (const e of g.edges.values()) {
      const a = g.vertexPos(e.a);
      const b = g.vertexPos(e.b);
      if (Math.abs(a.x - 2) < 1e-9 && Math.abs(b.x - 2) < 1e-9) divider = e.id;
    }
    expect(divider).toBeGreaterThan(0);

    eraseEdges(g, [divider]);

    expect(g.faces.size).toBe(1);
    closeTo(totalArea(g), 8);
    // Los vértices del corte permanecen, igual que en SketchUp: el contorno
    // superior e inferior quedan divididos en dos tramos colineales.
    expect(g.edges.size).toBe(6);
    expect([...g.faces.values()][0].loops[0].edges.length).toBe(6);
    expectValid(g);
  });

  it('borrar sólo la cara conserva las aristas y no la regenera', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 4, 4);
    const f = [...g.faces.keys()][0];
    const edgesBefore = g.edges.size;
    eraseFaces(g, [f]);
    expect(g.faces.size).toBe(0);
    expect(g.edges.size).toBe(edgesBefore);

    // Dibujar en otro plano no debe resucitarla.
    drawPolyline(g, [v3(30, 0, 0), v3(30, 1, 0), v3(30, 1, 1)], true);
    expect(g.faces.size).toBe(1);

    // Repasar una de sus aristas sí la regenera (como en SketchUp).
    drawSegment(g, P(0, 0), P(4, 0));
    expect(g.faces.size).toBe(2);
    expectValid(g);
  });

  it('crea caras en planos verticales e inclinados', () => {
    const g = newGeometry();
    drawPolyline(g, [v3(0, 0, 0), v3(0, 2, 0), v3(0, 2, 2), v3(0, 0, 2)], true);
    expect(g.faces.size).toBe(1);
    closeTo(totalArea(g), 4);

    const g2 = newGeometry();
    drawPolyline(g2, [v3(0, 0, 0), v3(2, 0, 0), v3(2, 2, 2), v3(0, 2, 2)], true);
    expect(g2.faces.size).toBe(1);
    closeTo(totalArea(g2), 2 * Math.sqrt(8));
    expectValid(g2);
  });

  it('la normal almacenada coincide con la normal geométrica del contorno', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 3, 3);
    for (const f of g.faces.values()) {
      const n = faceGeometricNormal(g, f.id)!;
      expect(dot(n, f.plane.n)).toBeGreaterThan(0.999);
    }
  });

  it('orienta las caras nuevas hacia la dirección indicada', () => {
    const g = newGeometry();
    drawPolyline(g, [P(0, 0), P(2, 0), P(2, 2), P(0, 2)], true, { orientToward: v3(0, 0, -1) });
    const f = [...g.faces.values()][0];
    expect(f.plane.n.z).toBeLessThan(0);
    const n = faceGeometricNormal(g, f.id)!;
    expect(dot(n, f.plane.n)).toBeGreaterThan(0.999);
    expectValid(g);
  });

  it('un polígono cóncavo se triangula sin perder área', () => {
    const g = newGeometry();
    // Forma en L
    drawPolyline(g, [
      P(0, 0), P(4, 0), P(4, 1), P(1, 1), P(1, 4), P(0, 4),
    ], true);
    expect(g.faces.size).toBe(1);
    const f = [...g.faces.keys()][0];
    closeTo(faceArea(g, f), 7);
    const t = triangulateFace(g, f)!;
    let area = 0;
    for (let i = 0; i < t.indices.length; i += 3) {
      const a = t.positions[t.indices[i]];
      const b = t.positions[t.indices[i + 1]];
      const c = t.positions[t.indices[i + 2]];
      area += 0.5 * Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    }
    closeTo(area, 7, 1e-9);
    expectValid(g);
  });

  it('mantiene el área al triangular una cara con agujero', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 10, 10);
    drawRect(g, 3, 3, 7, 7);
    let biggest = -1;
    let biggestArea = -1;
    for (const f of g.faces.keys()) {
      const a = faceArea(g, f);
      if (a > biggestArea) {
        biggestArea = a;
        biggest = f;
      }
    }
    const t = triangulateFace(g, biggest)!;
    let area = 0;
    for (let i = 0; i < t.indices.length; i += 3) {
      const a = t.positions[t.indices[i]];
      const b = t.positions[t.indices[i + 1]];
      const c = t.positions[t.indices[i + 2]];
      area += 0.5 * Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    }
    closeTo(area, 84, 1e-9);
  });

  it('conserva el identificador de las caras que no cambian', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 4, 4);
    const id = [...g.faces.keys()][0];
    // Dibujar algo lejano en otro plano no debe recrear la cara.
    drawPolyline(g, [v3(20, 0, 0), v3(20, 2, 0), v3(20, 2, 2), v3(20, 0, 2)], true);
    expect(g.faces.has(id)).toBe(true);
  });

  it('hereda el material al partir una cara', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 4, 4);
    const f = [...g.faces.values()][0];
    f.frontMaterial = 'madera';
    drawSegment(g, P(2, 0), P(2, 4));
    expect(g.faces.size).toBe(2);
    for (const face of g.faces.values()) {
      expect(face.frontMaterial).toBe('madera');
    }
  });
});

describe('robustez numérica', () => {
  it('funciona con magnitudes pequeñas (milímetros)', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 0.001, 0.002); // 1 mm × 2 mm
    expect(g.faces.size).toBe(1);
    closeTo(totalArea(g), 2e-6, 1e-15);
    expectValid(g);
  });

  it('funciona con magnitudes grandes (centenares de metros)', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 500, 300);
    expect(g.faces.size).toBe(1);
    closeTo(totalArea(g), 150000, 1e-6);
    expectValid(g);
  });

  it('no crea caras degeneradas con vértices casi colineales', () => {
    const g = newGeometry();
    drawPolyline(g, [P(0, 0), P(1, 1e-12), P(2, 0)], true);
    // El "triángulo" tiene área despreciable: no debe generar cara.
    expect(g.faces.size).toBe(0);
    expectValid(g);
  });

  it('soporta una malla densa sin romper invariantes', () => {
    const g = newGeometry();
    for (let i = 0; i <= 6; i++) {
      drawSegment(g, P(i, 0), P(i, 6));
    }
    for (let j = 0; j <= 6; j++) {
      drawSegment(g, P(0, j), P(6, j));
    }
    expect(g.faces.size).toBe(36);
    closeTo(totalArea(g), 36, 1e-9);
    expectValid(g);
  });
});
