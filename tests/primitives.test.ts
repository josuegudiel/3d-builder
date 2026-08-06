import { describe, it, expect } from 'vitest';
import {
  PlaneFrame, frameFromNormal, rectanglePoints, rectangleFromSize,
  rotatedRectanglePoints, circlePoints, polygonPoints, arcPoints,
  arcFrom3Points, bulgeArcPoints, bezierPoints, boxEdges, segmentsPerCircle,
  MIN_CIRCLE_SEGMENTS, MAX_CIRCLE_SEGMENTS,
} from '../src/core/ops/primitives';
import {
  Vec3, v3, add, sub, mul, dot, cross, normalize, length, distance,
  midpoint, AXIS_X, AXIS_Y, AXIS_Z,
} from '../src/core/math/vec';
import { newellNormal } from '../src/core/math/plane';
import { polygonArea3, distanceToLine } from '../src/core/math/geom';
import { closeTo, P } from './helpers';

const TAU = Math.PI * 2;

/** Vectores de los lados del polígono cerrado. */
function edges(pts: readonly Vec3[]): Vec3[] {
  return pts.map((p, i) => sub(pts[(i + 1) % pts.length], p));
}

/** Longitudes de los lados. */
function sideLengths(pts: readonly Vec3[]): number[] {
  return edges(pts).map(length);
}

/** Comprueba que la base es ortonormal y derecha (u × v = n). */
function expectOrthonormal(f: PlaneFrame): void {
  closeTo(length(f.u), 1);
  closeTo(length(f.v), 1);
  closeTo(length(f.n), 1);
  closeTo(dot(f.u, f.v), 0);
  closeTo(dot(f.u, f.n), 0);
  closeTo(dot(f.v, f.n), 0);
  const c = cross(f.u, f.v);
  closeTo(distance(c, f.n), 0);
}

// ---------------------------------------------------------------------------

describe('frameFromNormal', () => {
  it('normal Z usa X global como u y da una base derecha', () => {
    const f = frameFromNormal(P(0, 0, 0), AXIS_Z);
    expectOrthonormal(f);
    closeTo(distance(f.u, AXIS_X), 0);
    closeTo(distance(f.v, AXIS_Y), 0);
  });

  it('normal X usa Y como u', () => {
    const f = frameFromNormal(P(1, 2, 3), AXIS_X);
    expectOrthonormal(f);
    closeTo(distance(f.u, AXIS_Y), 0);
    closeTo(distance(f.v, AXIS_Z), 0);
  });

  it('en planos verticales v apunta hacia arriba', () => {
    for (const n of [AXIS_X, AXIS_Y, v3(1, 1, 0), v3(-2, 3, 0)]) {
      const f = frameFromNormal(P(0, 0, 0), n);
      expectOrthonormal(f);
      closeTo(dot(f.u, AXIS_Z), 0); // u es horizontal
      closeTo(distance(f.v, AXIS_Z), 0); // v es vertical hacia arriba
    }
  });

  it('normales arbitrarias dan bases ortonormales derechas', () => {
    for (const n of [v3(1, 2, 3), v3(-4, 0.5, 2), v3(0, 0, -1), v3(0.001, 0, 1)]) {
      expectOrthonormal(frameFromNormal(P(5, 5, 5), n));
    }
  });

  it('hintU alinea u con la pista proyectada al plano', () => {
    const f = frameFromNormal(P(0, 0, 0), AXIS_Z, v3(1, 1, 7));
    expectOrthonormal(f);
    closeTo(distance(f.u, normalize(v3(1, 1, 0))), 0);
  });

  it('hintU paralelo a la normal se ignora y no lanza', () => {
    const f = frameFromNormal(P(0, 0, 0), AXIS_Z, AXIS_Z);
    expectOrthonormal(f);
    closeTo(distance(f.u, AXIS_X), 0);
  });

  it('normal degenerada no lanza y cae al plano horizontal', () => {
    const f = frameFromNormal(P(0, 0, 0), v3(0, 0, 0));
    expectOrthonormal(f);
    closeTo(distance(f.n, AXIS_Z), 0);
  });
});

// ---------------------------------------------------------------------------

describe('rectanglePoints', () => {
  it('4 puntos, área exacta, lados perpendiculares y orientación coherente', () => {
    const f = frameFromNormal(P(0, 0, 0), AXIS_Z);
    const pts = rectanglePoints(f, P(1, 2), P(4, 6));
    expect(pts.length).toBe(4);
    closeTo(polygonArea3(pts), 12); // 3 × 4

    // Lados consecutivos perpendiculares.
    const e = edges(pts);
    for (let i = 0; i < 4; i++) closeTo(dot(e[i], e[(i + 1) % 4]), 0);
    // Lados opuestos iguales.
    const l = sideLengths(pts);
    closeTo(l[0], l[2]);
    closeTo(l[1], l[3]);

    // Antihorario respecto de la normal del marco.
    expect(dot(newellNormal(pts), f.n)).toBeGreaterThan(0);
  });

  it('el orden de las esquinas no cambia la orientación', () => {
    const f = frameFromNormal(P(0, 0, 0), AXIS_Z);
    const combos: Array<[Vec3, Vec3]> = [
      [P(1, 2), P(4, 6)], [P(4, 6), P(1, 2)], [P(4, 2), P(1, 6)], [P(1, 6), P(4, 2)],
    ];
    for (const [a, b] of combos) {
      const pts = rectanglePoints(f, a, b);
      expect(pts.length).toBe(4);
      closeTo(polygonArea3(pts), 12);
      expect(dot(newellNormal(pts), f.n)).toBeGreaterThan(0);
    }
  });

  it('proyecta las esquinas al plano de un marco inclinado', () => {
    const f = frameFromNormal(P(0, 0, 1), v3(1, 1, 1));
    const c0 = add(f.origin, add(mul(f.u, -1), mul(f.v, -2)));
    const c1 = add(add(f.origin, add(mul(f.u, 2), mul(f.v, 3))), mul(f.n, 5)); // fuera del plano
    const pts = rectanglePoints(f, c0, c1);
    expect(pts.length).toBe(4);
    closeTo(polygonArea3(pts), 15); // 3 × 5
    // Todos los puntos están en el plano del marco.
    for (const p of pts) closeTo(dot(sub(p, f.origin), f.n), 0);
  });

  it('devuelve [] si algún lado es nulo', () => {
    const f = frameFromNormal(P(0, 0, 0), AXIS_Z);
    expect(rectanglePoints(f, P(1, 1), P(1, 1))).toEqual([]);
    expect(rectanglePoints(f, P(1, 1), P(1, 5))).toEqual([]);
    expect(rectanglePoints(f, P(1, 1), P(5, 1))).toEqual([]);
  });
});

describe('rectangleFromSize', () => {
  it('genera un rectángulo exacto width × height', () => {
    const f = frameFromNormal(P(0, 0, 0), AXIS_Z);
    const pts = rectangleFromSize(f, P(2, 3), 4, 0.5);
    expect(pts.length).toBe(4);
    closeTo(polygonArea3(pts), 2);
    const l = sideLengths(pts);
    closeTo(l[0], 4);
    closeTo(l[1], 0.5);
    expect(dot(newellNormal(pts), f.n)).toBeGreaterThan(0);
  });

  it('medidas negativas invierten el sentido pero mantienen la orientación', () => {
    const f = frameFromNormal(P(0, 0, 0), AXIS_Z);
    const pts = rectangleFromSize(f, P(2, 3), -4, 0.5);
    expect(pts.length).toBe(4);
    closeTo(polygonArea3(pts), 2);
    expect(dot(newellNormal(pts), f.n)).toBeGreaterThan(0);
  });

  it('devuelve [] con medidas nulas o no finitas', () => {
    const f = frameFromNormal(P(0, 0, 0), AXIS_Z);
    expect(rectangleFromSize(f, P(0, 0), 0, 3)).toEqual([]);
    expect(rectangleFromSize(f, P(0, 0), 3, 0)).toEqual([]);
    expect(rectangleFromSize(f, P(0, 0), NaN, 3)).toEqual([]);
  });
});

describe('rotatedRectanglePoints', () => {
  it('los 4 ángulos son rectos con puntos arbitrarios', () => {
    const f = frameFromNormal(P(0, 0, 0), v3(2, -1, 3));
    // Puntos "sucios" dentro del plano y un tercer punto no alineado.
    const p0 = add(f.origin, add(mul(f.u, 0.7), mul(f.v, -1.3)));
    const p1 = add(f.origin, add(mul(f.u, 3.1), mul(f.v, 2.2)));
    const p2 = add(f.origin, add(mul(f.u, -1.5), mul(f.v, 4.4)));
    const pts = rotatedRectanglePoints(f, p0, p1, p2);
    expect(pts.length).toBe(4);

    const e = edges(pts);
    for (let i = 0; i < 4; i++) {
      const a = e[i];
      const b = e[(i + 1) % 4];
      closeTo(dot(a, b) / (length(a) * length(b)), 0);
    }
    const l = sideLengths(pts);
    closeTo(l[0], l[2]);
    closeTo(l[1], l[3]);
    // El primer lado va de p0 a p1.
    closeTo(distance(pts[0], p0), 0);
    closeTo(distance(pts[1], p1), 0);
    // Sigue siendo plano.
    for (const p of pts) closeTo(dot(sub(p, p0), f.n), 0);
    // Área = |p0p1| × profundidad.
    closeTo(polygonArea3(pts), l[0] * l[1]);
  });

  it('devuelve [] si el primer lado o la profundidad son nulos', () => {
    const f = frameFromNormal(P(0, 0, 0), AXIS_Z);
    expect(rotatedRectanglePoints(f, P(1, 1), P(1, 1), P(3, 3))).toEqual([]);
    // p2 sobre la recta p0p1 ⇒ profundidad 0.
    expect(rotatedRectanglePoints(f, P(0, 0), P(2, 0), P(5, 0))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('circlePoints', () => {
  it('radio 1 con 24 segmentos: vértices a distancia exacta 1 del centro', () => {
    const center = P(3, -2, 5);
    const pts = circlePoints(center, AXIS_Z, 1, 24);
    expect(pts.length).toBe(24);
    for (const p of pts) closeTo(distance(p, center), 1);
  });

  it('el área del polígono es 0.5·n·r²·sin(2π/n) y menor que π·r²', () => {
    const n = 24;
    const r = 1;
    const pts = circlePoints(P(0, 0, 0), AXIS_Z, r, n);
    const area = polygonArea3(pts);
    closeTo(area, 0.5 * n * r * r * Math.sin(TAU / n));
    expect(area).toBeLessThan(Math.PI * r * r);
    // El radio dado es el del círculo CIRCUNSCRITO: el polígono queda dentro.
    expect(Math.PI * r * r - area).toBeLessThan(0.15);
  });

  it('los vértices están repartidos con paso angular uniforme', () => {
    const n = 12;
    const pts = circlePoints(P(0, 0, 0), AXIS_Z, 2, n);
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      closeTo(distance(a, b), 2 * 2 * Math.sin(Math.PI / n));
    }
  });

  it('startDir fija el primer vértice y el círculo es plano', () => {
    const center = P(0, 0, 0);
    const normal = normalize(v3(1, 2, -1));
    const start = normalize(cross(normal, AXIS_X));
    const pts = circlePoints(center, normal, 3, 16, start);
    expect(pts.length).toBe(16);
    closeTo(distance(pts[0], mul(start, 3)), 0);
    for (const p of pts) {
      closeTo(dot(p, normal), 0);
      closeTo(distance(p, center), 3);
    }
  });

  it('es determinista', () => {
    const a = circlePoints(P(1, 1, 1), v3(1, 1, 1), 2, 20);
    const b = circlePoints(P(1, 1, 1), v3(1, 1, 1), 2, 20);
    expect(a).toEqual(b);
  });

  it('degenerados devuelven []', () => {
    expect(circlePoints(P(0, 0, 0), AXIS_Z, 0, 24)).toEqual([]);
    expect(circlePoints(P(0, 0, 0), AXIS_Z, -1, 24)).toEqual([]);
    expect(circlePoints(P(0, 0, 0), AXIS_Z, 1, 2)).toEqual([]);
    expect(circlePoints(P(0, 0, 0), AXIS_Z, 1, 0)).toEqual([]);
    expect(circlePoints(P(0, 0, 0), v3(0, 0, 0), 1, 24)).toEqual([]);
    expect(circlePoints(P(0, 0, 0), AXIS_Z, NaN, 24)).toEqual([]);
    expect(circlePoints(P(0, 0, 0), AXIS_Z, 1, Infinity)).toEqual([]);
  });
});

describe('polygonPoints', () => {
  it('inscrito: el radio es la distancia a los vértices', () => {
    const n = 6;
    const r = 1;
    const pts = polygonPoints(P(0, 0, 0), AXIS_Z, r, n, true);
    expect(pts.length).toBe(n);
    for (const p of pts) closeTo(length(p), r);
    // Apotema = R·cos(π/n).
    for (let i = 0; i < n; i++) {
      closeTo(length(midpoint(pts[i], pts[(i + 1) % n])), r * Math.cos(Math.PI / n));
    }
    closeTo(polygonArea3(pts), 0.5 * n * r * r * Math.sin(TAU / n));
  });

  it('circunscrito: el radio es la apotema (puntos medios de los lados)', () => {
    const n = 6;
    const a = 1;
    const pts = polygonPoints(P(0, 0, 0), AXIS_Z, a, n, false);
    expect(pts.length).toBe(n);
    // Los puntos medios de los lados están justo a la distancia pedida.
    for (let i = 0; i < n; i++) {
      closeTo(length(midpoint(pts[i], pts[(i + 1) % n])), a);
    }
    // Y los vértices, más lejos: R = a / cos(π/n).
    const R = a / Math.cos(Math.PI / n);
    for (const p of pts) closeTo(length(p), R);
    // El polígono circunscribe el círculo: su área es mayor que π·a².
    expect(polygonArea3(pts)).toBeGreaterThan(Math.PI * a * a);
    closeTo(polygonArea3(pts), n * a * a * Math.tan(Math.PI / n));
  });

  it('un cuadrado circunscrito de apotema 1 mide exactamente 2×2', () => {
    const pts = polygonPoints(P(0, 0, 0), AXIS_Z, 1, 4, false, AXIS_X);
    closeTo(polygonArea3(pts), 4);
  });

  it('menos de 3 lados o radio nulo devuelven []', () => {
    expect(polygonPoints(P(0, 0, 0), AXIS_Z, 1, 2, true)).toEqual([]);
    expect(polygonPoints(P(0, 0, 0), AXIS_Z, 1, 0, false)).toEqual([]);
    expect(polygonPoints(P(0, 0, 0), AXIS_Z, 0, 6, true)).toEqual([]);
    expect(polygonPoints(P(0, 0, 0), AXIS_Z, 1, -5, true)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('arcPoints', () => {
  it('un cuarto de círculo con 6 tramos da 7 puntos sobre el radio', () => {
    const center = P(1, 1, 0);
    const start = P(3, 1, 0);
    const pts = arcPoints(center, AXIS_Z, start, Math.PI / 2, 6);
    expect(pts.length).toBe(7);
    for (const p of pts) closeTo(distance(p, center), 2);
    closeTo(distance(pts[0], start), 0);
    closeTo(distance(pts[6], P(1, 3, 0)), 0); // giro antihorario alrededor de +Z
  });

  it('el barrido negativo gira en sentido horario', () => {
    const pts = arcPoints(P(0, 0, 0), AXIS_Z, P(1, 0, 0), -Math.PI / 2, 4);
    expect(pts.length).toBe(5);
    closeTo(distance(pts[4], P(0, -1, 0)), 0);
  });

  it('degenerados devuelven []', () => {
    expect(arcPoints(P(0, 0, 0), AXIS_Z, P(1, 0, 0), Math.PI, 0)).toEqual([]);
    expect(arcPoints(P(0, 0, 0), AXIS_Z, P(1, 0, 0), 0, 8)).toEqual([]);
    expect(arcPoints(P(0, 0, 0), AXIS_Z, P(0, 0, 0), Math.PI, 8)).toEqual([]);
    expect(arcPoints(P(0, 0, 0), v3(0, 0, 0), P(1, 0, 0), Math.PI, 8)).toEqual([]);
    expect(arcPoints(P(0, 0, 0), AXIS_Z, P(1, 0, 0), NaN, 8)).toEqual([]);
  });
});

describe('arcFrom3Points', () => {
  it('el centro equidista de los 3 puntos y todos los puntos están a "radius"', () => {
    const p1 = P(0, 0, 0);
    const p2 = P(1, 1, 0);
    const p3 = P(2, 0, 0);
    const arc = arcFrom3Points(p1, p2, p3, 8);
    expect(arc).not.toBeNull();
    if (!arc) return;
    expect(arc.points.length).toBe(9);
    closeTo(distance(arc.center, p1), arc.radius);
    closeTo(distance(arc.center, p2), arc.radius);
    closeTo(distance(arc.center, p3), arc.radius);
    for (const p of arc.points) closeTo(distance(p, arc.center), arc.radius);
    // Semicircunferencia de radio 1 centrada en (1,0,0).
    closeTo(arc.radius, 1);
    closeTo(distance(arc.center, P(1, 0, 0)), 0);
    // Empieza y acaba en los extremos, y pasa por el punto intermedio.
    closeTo(distance(arc.points[0], p1), 0);
    closeTo(distance(arc.points[8], p3), 0);
    closeTo(distance(arc.points[4], p2), 0);
  });

  it('funciona en un plano inclinado cualquiera', () => {
    const n = normalize(v3(1, -2, 3));
    const f = frameFromNormal(P(2, 0, 1), n);
    const at = (ang: number, r = 1.7) =>
      add(f.origin, add(mul(f.u, r * Math.cos(ang)), mul(f.v, r * Math.sin(ang))));
    const p1 = at(0.3);
    const p2 = at(1.9);
    const p3 = at(2.6);
    const arc = arcFrom3Points(p1, p2, p3, 12);
    expect(arc).not.toBeNull();
    if (!arc) return;
    expect(arc.points.length).toBe(13);
    closeTo(arc.radius, 1.7);
    closeTo(distance(arc.center, f.origin), 0);
    for (const p of arc.points) {
      closeTo(distance(p, arc.center), arc.radius);
      closeTo(dot(sub(p, f.origin), n), 0); // sigue en el plano
    }
    // La normal devuelta es la del plano (con signo del recorrido p1→p2→p3).
    closeTo(Math.abs(dot(arc.normal, n)), 1);
  });

  it('elige el arco mayor si el punto intermedio está al otro lado', () => {
    // p1 y p3 casi juntos, p2 al otro lado: hay que recorrer casi todo el círculo.
    const p1 = P(1, 0, 0);
    const p2 = P(-1, 0, 0);
    const p3 = P(Math.cos(-0.2), Math.sin(-0.2), 0);
    const arc = arcFrom3Points(p1, p2, p3, 32);
    expect(arc).not.toBeNull();
    if (!arc) return;
    closeTo(arc.radius, 1);
    // Longitud de la poligonal ≈ arco de (2π - 0.2) radianes.
    let len = 0;
    for (let i = 1; i < arc.points.length; i++) len += distance(arc.points[i - 1], arc.points[i]);
    expect(len).toBeGreaterThan(TAU - 0.2 - 0.05);
    expect(len).toBeLessThan(TAU - 0.2 + 0.001);
  });

  it('devuelve null con puntos colineales, coincidentes o sin tramos', () => {
    expect(arcFrom3Points(P(0, 0, 0), P(1, 0, 0), P(2, 0, 0), 8)).toBeNull();
    expect(arcFrom3Points(P(0, 0, 0), P(0, 0, 0), P(2, 0, 0), 8)).toBeNull();
    expect(arcFrom3Points(P(0, 0, 0), P(1, 1, 0), P(2, 0, 0), 0)).toBeNull();
    expect(arcFrom3Points(P(0, 0, 0), P(1, 1, 0), P(2, 0, 0), NaN)).toBeNull();
    // Colineales en 3D, no solo sobre un eje.
    expect(arcFrom3Points(P(0, 0, 0), P(1, 2, 3), P(3, 6, 9), 8)).toBeNull();
  });
});

describe('bulgeArcPoints', () => {
  it('el punto medio del arco está a distancia "bulge" de la cuerda', () => {
    const start = P(0, 0, 0);
    const end = P(2, 0, 0);
    const bulge = 0.5;
    const pts = bulgeArcPoints(start, end, bulge, AXIS_Z, 8);
    expect(pts.length).toBe(9);
    closeTo(distance(pts[0], start), 0);
    closeTo(distance(pts[8], end), 0);
    // El punto central de la poligonal es el vértice del arco.
    closeTo(distanceToLine(start, end, pts[4]), bulge);
    closeTo(distance(pts[4], P(1, bulge, 0)), 0);
    // Radio teórico: R = (a² + s²) / 2s con a = 1, s = 0.5 ⇒ 1.25.
    const center = P(1, bulge - 1.25, 0);
    for (const p of pts) closeTo(distance(p, center), 1.25);
  });

  it('el signo de la comba elige el lado', () => {
    const a = bulgeArcPoints(P(0, 0, 0), P(2, 0, 0), 0.5, AXIS_Z, 4);
    const b = bulgeArcPoints(P(0, 0, 0), P(2, 0, 0), -0.5, AXIS_Z, 4);
    expect(a[2].y).toBeGreaterThan(0);
    expect(b[2].y).toBeLessThan(0);
    closeTo(distanceToLine(P(0, 0, 0), P(2, 0, 0), b[2]), 0.5);
  });

  it('admite combas mayores que la semicuerda (arco mayor)', () => {
    const start = P(0, 0, 0);
    const end = P(2, 0, 0);
    const bulge = 1.8; // s > a ⇒ más de media circunferencia
    const pts = bulgeArcPoints(start, end, bulge, AXIS_Z, 16);
    expect(pts.length).toBe(17);
    closeTo(distanceToLine(start, end, pts[8]), bulge);
    const r = (1 * 1 + bulge * bulge) / (2 * bulge);
    const center = P(1, bulge - r, 0);
    for (const p of pts) closeTo(distance(p, center), r);
  });

  it('funciona en un plano vertical', () => {
    const start = P(0, 0, 0);
    const end = P(0, 0, 2);
    const pts = bulgeArcPoints(start, end, 0.4, AXIS_X, 6);
    expect(pts.length).toBe(7);
    closeTo(distanceToLine(start, end, pts[3]), 0.4);
    for (const p of pts) closeTo(p.x, 0);
  });

  it('degenerados devuelven [] sin lanzar', () => {
    expect(bulgeArcPoints(P(0, 0, 0), P(0, 0, 0), 0.5, AXIS_Z, 8)).toEqual([]);
    expect(bulgeArcPoints(P(0, 0, 0), P(2, 0, 0), 0, AXIS_Z, 8)).toEqual([]);
    expect(bulgeArcPoints(P(0, 0, 0), P(2, 0, 0), 0.5, AXIS_Z, 0)).toEqual([]);
    expect(bulgeArcPoints(P(0, 0, 0), P(2, 0, 0), NaN, AXIS_Z, 8)).toEqual([]);
    // Normal paralela a la cuerda: se elige una perpendicular estable.
    const pts = bulgeArcPoints(P(0, 0, 0), P(2, 0, 0), 0.5, AXIS_X, 8);
    expect(pts.length).toBe(9);
    closeTo(distanceToLine(P(0, 0, 0), P(2, 0, 0), pts[4]), 0.5);
  });
});

// ---------------------------------------------------------------------------

describe('bezierPoints', () => {
  it('empieza en el primer control y acaba en el último', () => {
    const ctrl = [P(0, 0, 0), P(1, 3, 0), P(3, -1, 2), P(4, 0, 0)];
    const pts = bezierPoints(ctrl, 10);
    expect(pts.length).toBe(11);
    expect(pts[0]).toEqual(ctrl[0]);
    expect(pts[10]).toEqual(ctrl[3]);
  });

  it('una Bézier de 2 controles es el segmento recto', () => {
    const a = P(0, 0, 0);
    const b = P(3, 3, 3);
    const pts = bezierPoints([a, b], 4);
    expect(pts.length).toBe(5);
    for (let i = 0; i <= 4; i++) {
      closeTo(distance(pts[i], mul(b, i / 4)), 0);
    }
  });

  it('una cuadrática pasa por el punto esperado en t = 0.5', () => {
    const c = [P(0, 0, 0), P(1, 2, 0), P(2, 0, 0)];
    const pts = bezierPoints(c, 2);
    // B(0.5) = (P0 + 2·P1 + P2) / 4
    closeTo(distance(pts[1], P(1, 1, 0)), 0);
  });

  it('es determinista y no muta los controles', () => {
    const ctrl = [P(0, 0, 0), P(1, 1, 0), P(2, 0, 0)];
    const copy = ctrl.map((p) => v3(p.x, p.y, p.z));
    const a = bezierPoints(ctrl, 7);
    const b = bezierPoints(ctrl, 7);
    expect(a).toEqual(b);
    expect(ctrl).toEqual(copy);
  });

  it('degenerados devuelven []', () => {
    expect(bezierPoints([], 5)).toEqual([]);
    expect(bezierPoints([P(0, 0, 0)], 5)).toEqual([]);
    expect(bezierPoints([P(0, 0, 0), P(1, 0, 0)], 0)).toEqual([]);
    expect(bezierPoints([P(0, 0, 0), P(1, 0, 0)], NaN)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('boxEdges', () => {
  it('devuelve 12 aristas con la longitud total correcta', () => {
    const es = boxEdges(P(0, 0, 0), P(2, 3, 4));
    expect(es.length).toBe(12);
    const total = es.reduce((s, [a, b]) => s + distance(a, b), 0);
    closeTo(total, 4 * (2 + 3 + 4));
    // Cada esquina aparece en exactamente 3 aristas.
    const counts = new Map<string, number>();
    for (const [a, b] of es) {
      for (const p of [a, b]) {
        const k = `${p.x},${p.y},${p.z}`;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(8);
    for (const c of counts.values()) expect(c).toBe(3);
  });

  it('acepta las esquinas en cualquier orden', () => {
    expect(boxEdges(P(2, 3, 4), P(0, 0, 0))).toEqual(boxEdges(P(0, 0, 0), P(2, 3, 4)));
  });

  it('una caja plana no lanza y sigue dando 12 aristas', () => {
    expect(boxEdges(P(0, 0, 0), P(1, 1, 0)).length).toBe(12);
  });
});

describe('segmentsPerCircle', () => {
  it('respeta el valor por defecto para un radio de 1 m', () => {
    expect(segmentsPerCircle(1, 24)).toBe(24);
  });

  it('crece con el radio pero se mantiene dentro de [8, 128]', () => {
    expect(segmentsPerCircle(8, 24)).toBe(48);
    expect(segmentsPerCircle(0.001, 24)).toBe(MIN_CIRCLE_SEGMENTS);
    expect(segmentsPerCircle(1e6, 24)).toBe(MAX_CIRCLE_SEGMENTS);
    let prev = 0;
    for (const r of [0.01, 0.1, 1, 10, 100]) {
      const n = segmentsPerCircle(r, 24);
      expect(n).toBeGreaterThanOrEqual(prev);
      expect(n).toBeGreaterThanOrEqual(MIN_CIRCLE_SEGMENTS);
      expect(n).toBeLessThanOrEqual(MAX_CIRCLE_SEGMENTS);
      expect(Number.isInteger(n)).toBe(true);
      prev = n;
    }
  });

  it('tolera entradas absurdas', () => {
    expect(segmentsPerCircle(NaN, 24)).toBe(24);
    expect(segmentsPerCircle(-5, 24)).toBe(24);
    expect(segmentsPerCircle(1, NaN)).toBe(24);
    expect(segmentsPerCircle(1, 0)).toBe(24);
    expect(segmentsPerCircle(1, 1000)).toBe(MAX_CIRCLE_SEGMENTS);
  });
});
