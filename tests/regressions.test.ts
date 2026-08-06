import { describe, it, expect } from 'vitest';
import { newGeometry, P, drawRect, expectValid, closeTo, totalArea } from './helpers';
import { drawPolyline, drawSegment } from '../src/core/ops/draw';
import { eraseEdges, eraseFaces } from '../src/core/ops/erase';
import { pushPull } from '../src/core/ops/pushpull';
import { moveEntities, scaleEntities } from '../src/core/ops/transform';
import { weldCoincidentVertices } from '../src/core/topology/weld';
import { computeArrangement } from '../src/core/topology/arrangement';
import { findOverlappingEdges, splitEdgesAtInteriorVertices } from '../src/core/topology/repair';
import { shellVolume, isSolid } from '../src/core/topology/orient';
import { pruneSuppressedRegions } from '../src/core/topology/rebuild';
import { faceArea, faceGeometricNormal } from '../src/core/topology/triangulate';
import { planeFromPointNormal } from '../src/core/math/plane';
import { v3, dot } from '../src/core/math/vec';
import { Geometry } from '../src/core/model/geometry';
import { Id } from '../src/core/model/types';

function volume(g: Geometry): number {
  return Math.abs(shellVolume(g, g.faces.keys()));
}

function faceAt(g: Geometry, predicate: (pts: ReturnType<typeof v3>[]) => boolean): Id | null {
  for (const f of g.faces.values()) {
    const pts = f.loops[0].vertices.map((v) => g.vertexPos(v));
    if (predicate(pts)) return f.id;
  }
  return null;
}

function topFace(g: Geometry, z: number): Id | null {
  return faceAt(g, (pts) => pts.every((p) => Math.abs(p.z - z) < 1e-9));
}

/** Ninguna arista puede contener otro vértice en su interior. */
function expectNoOverlaps(g: Geometry): void {
  const bad = findOverlappingEdges(g);
  expect(bad, `aristas solapadas: ${bad.join(', ')}`).toEqual([]);
}

/** Toda cara debe tener su normal alineada con el sentido de su contorno. */
function expectNormalsMatchLoops(g: Geometry): void {
  for (const f of g.faces.values()) {
    const n = faceGeometricNormal(g, f.id);
    if (!n) continue;
    expect(
      dot(n, f.plane.n),
      `cara ${f.id}: la normal almacenada no sigue al contorno`,
    ).toBeGreaterThan(0.99);
  }
}

describe('regresiones del subdivisor planar', () => {
  it('un solapamiento colineal no borra las caras del plano', () => {
    // A–C cubre a A–B y B–C. Antes, el recorrido de semiaristas producía un
    // único ciclo de área nula y el plano se quedaba sin ninguna cara.
    const g = newGeometry();
    const A = g.addVertex(P(0, 0));
    const B = g.addVertex(P(1, 0));
    const C = g.addVertex(P(2, 0));
    const D = g.addVertex(P(1, 2));
    g.addEdgeByVertices(A, B);
    g.addEdgeByVertices(B, C);
    g.addEdgeByVertices(A, C); // solapa a las dos anteriores
    g.addEdgeByVertices(C, D);
    g.addEdgeByVertices(D, A);

    const arr = computeArrangement(g, planeFromPointNormal(P(0, 0), v3(0, 0, 1)), [...g.edges.keys()]);
    // El arreglo con solapamiento no es fiable; lo que sí debe cumplirse es que
    // la reparación lo elimine y entonces salga el triángulo.
    expect(arr.regions.length).toBeLessThanOrEqual(2);

    splitEdgesAtInteriorVertices(g, [...g.edges.keys()]);
    expectNoOverlaps(g);

    const arr2 = computeArrangement(g, planeFromPointNormal(P(0, 0), v3(0, 0, 1)), [...g.edges.keys()]);
    expect(arr2.regions.length).toBe(1);
    closeTo(Math.abs(arr2.regions[0].outer.area), 2);
  });

  it('deslizar una cara a través de un tabique interior conserva el sólido', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 2, 2);
    pushPull(g, [...g.faces.keys()][0], 2);
    expect(g.faces.size).toBe(6);

    // Tabique horizontal a media altura.
    drawPolyline(g, [v3(0, 0, 1), v3(2, 0, 1), v3(2, 2, 1), v3(0, 2, 1)], true);
    expectValid(g);
    const before = g.faces.size;
    expect(before).toBeGreaterThan(6);

    // Bajar la tapa por debajo del tabique.
    const cap = topFace(g, 2)!;
    pushPull(g, cap, -1.5);

    expectValid(g);
    expectNoOverlaps(g);
    // Debe quedar un volumen real, no una ruina sin laterales.
    expect(g.faces.size).toBeGreaterThanOrEqual(6);
    for (const e of g.edges.keys()) {
      expect(g.edgeFaces.get(e)!.size, `arista ${e} huérfana`).toBeGreaterThan(0);
    }
  });

  it('mover un vértice sobre otro no rompe los invariantes', () => {
    const g = newGeometry();
    drawPolyline(g, [P(0, 0), P(1, 0), P(2, 0)], false);
    const A = g.findVertexAt(P(0, 0))!;
    moveEntities(g, { vertices: [A] }, v3(1, 0, 0));
    expectValid(g);
    // Debe sobrevivir el tramo B–C.
    expect(g.edges.size).toBe(1);
    expect(g.vertices.size).toBe(2);
  });

  it('soldar el vértice destino no lo destruye', () => {
    const g = newGeometry();
    drawPolyline(g, [P(0, 0), P(1, 0), P(2, 0)], false);
    const A = g.findVertexAt(P(0, 0))!;
    g.moveVertex(A, P(1, 0));
    weldCoincidentVertices(g, [A]);
    expectValid(g);
  });

  it('el union-find soporta miles de vértices coplanares sin desbordar la pila', () => {
    const g = newGeometry();
    // Cadena larga: con `find` recursivo esto reventaba la pila.
    const pts = [];
    for (let i = 0; i < 6000; i++) pts.push(P(i * 0.01, (i % 2) * 0.001));
    for (let i = 0; i < pts.length - 1; i++) {
      const a = g.addVertex(pts[i]);
      const b = g.addVertex(pts[i + 1]);
      g.addEdgeByVertices(a, b);
    }
    expect(() => computeArrangement(
      g, planeFromPointNormal(P(0, 0), v3(0, 0, 1)), [...g.edges.keys()],
    )).not.toThrow();
  });
});

describe('regresiones de empujar/tirar', () => {
  it('extruir una de dos caras coplanares no borra la otra', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 4, 4);
    pushPull(g, [...g.faces.keys()][0], 1);
    // Partir la tapa en dos: áreas 4 y 12.
    drawSegment(g, v3(1, 0, 1), v3(1, 4, 1));
    const caras = [...g.faces.keys()].filter((f) => {
      const pts = g.faces.get(f)!.loops[0].vertices.map((v) => g.vertexPos(v));
      return pts.every((p) => Math.abs(p.z - 1) < 1e-9);
    });
    expect(caras.length).toBe(2);
    const pequena = caras.reduce((a, b) => (faceArea(g, a) < faceArea(g, b) ? a : b));
    const grande = caras.find((f) => f !== pequena)!;
    const areaGrande = faceArea(g, grande);
    closeTo(areaGrande, 12);

    pushPull(g, pequena, 1);

    // La cara grande debe seguir ahí, con su área intacta.
    const sigue = faceAt(g, (pts) =>
      pts.every((p) => Math.abs(p.z - 1) < 1e-9) && pts.length === 4);
    expect(sigue, 'la cara coplanar ajena ha desaparecido').not.toBeNull();
    closeTo(faceArea(g, sigue!), 12);
    expectValid(g);
  });

  it('volver a empujar un anillo no tapa el agujero', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 6, 6);
    drawRect(g, 1, 1, 3, 3);
    const anillo = [...g.faces.keys()].reduce((a, b) => (faceArea(g, a) > faceArea(g, b) ? a : b));
    closeTo(faceArea(g, anillo), 36 - 4);

    const r1 = pushPull(g, anillo, 1);
    expect(r1.faceId).not.toBeNull();
    const areaTapa1 = faceArea(g, r1.faceId!);
    closeTo(areaTapa1, 32);

    const r2 = pushPull(g, r1.faceId!, 1);
    expect(r2.faceId).not.toBeNull();

    // En el plano superior no puede haber ninguna cara que cubra el hueco.
    const tapaHueco = faceAt(g, (pts) =>
      pts.every((p) => Math.abs(p.z - 2) < 1e-9)
      && pts.every((p) => p.x >= 1 - 1e-9 && p.x <= 3 + 1e-9 && p.y >= 1 - 1e-9 && p.y <= 3 + 1e-9));
    expect(tapaHueco, 'el agujero ha quedado tapado').toBeNull();
    expectValid(g);
  });

  it('empujar más allá del sólido deja las normales coherentes', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 2, 2);
    pushPull(g, [...g.faces.keys()][0], 2);
    const cap = topFace(g, 2)!;
    pushPull(g, cap, -3); // atraviesa la base

    expectValid(g);
    expectNormalsMatchLoops(g);
    // La caja resultante mide 2 × 2 × 1 (de z = −1 a z = 0).
    closeTo(volume(g), 4, 1e-9);
  });
});

describe('regresiones de transformaciones', () => {
  it('una escala negativa (espejo) deja las normales coherentes', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 2, 2);
    pushPull(g, [...g.faces.keys()][0], 2);
    closeTo(volume(g), 8);

    scaleEntities(g, { faces: [...g.faces.keys()] }, v3(1, 1, -1), v3(0, 0, 0));

    expectValid(g);
    expectNormalsMatchLoops(g);
    expect(isSolid(g, g.faces.keys())).toBe(true);
    closeTo(volume(g), 8, 1e-9);
  });
});

describe('regresiones de regiones suprimidas', () => {
  it('borrar la cara de un anillo no suprime el disco completo', () => {
    const g = newGeometry();
    drawRect(g, 0, 0, 4, 4);
    drawRect(g, 1, 1, 3, 3);
    expect(g.faces.size).toBe(2);

    const anillo = [...g.faces.keys()].reduce((a, b) => (faceArea(g, a) > faceArea(g, b) ? a : b));
    eraseFaces(g, [anillo]);
    expect(g.faces.size).toBe(1);

    // Al quitar el agujero debe aparecer el rectángulo lleno.
    const aristasHueco = [...g.edges.keys()].filter((e) => {
      const edge = g.edges.get(e)!;
      const a = g.vertexPos(edge.a);
      const b = g.vertexPos(edge.b);
      const dentro = (p: { x: number; y: number }) =>
        p.x >= 1 - 1e-9 && p.x <= 3 + 1e-9 && p.y >= 1 - 1e-9 && p.y <= 3 + 1e-9;
      return dentro(a) && dentro(b);
    });
    eraseEdges(g, aristasHueco);

    expect(g.faces.size, 'el disco completo no ha reaparecido').toBe(1);
    closeTo(totalArea(g), 16);
    expectValid(g);
  });

  it('las regiones suprimidas no se acumulan indefinidamente', () => {
    const g = newGeometry();
    for (let i = 0; i < 5; i++) {
      drawRect(g, 0, 0, 2, 2);
      const f = [...g.faces.keys()][0];
      eraseFaces(g, [f]);
      eraseEdges(g, [...g.edges.keys()]);
    }
    expect(g.isEmpty()).toBe(true);
    pruneSuppressedRegions(g);
    expect(g.suppressedRegions.size, 'fuga de regiones suprimidas').toBe(0);
  });
});
