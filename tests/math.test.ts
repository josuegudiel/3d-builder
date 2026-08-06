/**
 * Suite ADVERSARIAL para el módulo matemático del kernel (`src/core/math/*`).
 *
 * Objetivo: castigar los casos límite (vectores nulos, magnitudes dispares,
 * matrices singulares, escalados no uniformes, polígonos cóncavos y muy
 * alargados, colinealidades, paralelismos y ángulos envolventes) con
 * tolerancias numéricas EXPLÍCITAS en cada aserción.
 */

import { describe, it, expect } from 'vitest';

import {
  EPS, eq, isZero, sgn, clamp, lerp, quantize, unsignedZero,
} from '../src/core/math/tolerance';

import {
  Vec2, Vec3, v2, v3, ZERO3, AXIS_X, AXIS_Y, AXIS_Z,
  add, sub, mul, neg, dot, cross, length, distance, distance2,
  normalize, normalizeOr, angleBetween, signedAngle, anyPerpendicular,
  rotateAround, isParallel, isPerpendicular, isFiniteV,
} from '../src/core/math/vec';

import {
  Mat4, IDENTITY, isIdentity, matTranslation, matScale, matRotation,
  matFromAxes, matMul, transformPoint, transformVector, transformNormal,
  matDeterminant, matInvert, matScaleFactors, matTranslationOf,
  matFlipsOrientation, matIsRigid,
} from '../src/core/math/mat';

import {
  Plane, planeFromPointNormal, planeFrom3Points, planeFromPolygon, newellNormal,
  planeDistance, planeContains, planeProject, planeOrigin, planeFlip, planeEquals,
  planeCanonical, planeKey, planeBasis, to2D, to3D,
  planePlaneIntersect, linePlaneIntersect, segmentPlaneIntersect,
} from '../src/core/math/plane';

import {
  ray, closestPointsSegmentSegment, segmentSegmentIntersection,
  pointStrictlyInsideSegment, signedArea2, pointInPolygon2,
  pointOnPolygonBoundary2, interiorPoint2, rayTriangle, circleFrom3Points2,
  angleDelta, normalizeAngle, polygonArea3,
} from '../src/core/math/geom';

// ---------------------------------------------------------------------------
// Aserciones con tolerancia explícita
// ---------------------------------------------------------------------------

function cerca(actual: number, esperado: number, tol: number, msg: string): void {
  expect(
    Math.abs(actual - esperado),
    `${msg}: obtenido ${actual}, esperado ${esperado} (tolerancia ${tol})`,
  ).toBeLessThanOrEqual(tol);
}

function txt(v: Vec3): string {
  return `(${v.x}, ${v.y}, ${v.z})`;
}

function cercaV(a: Vec3, b: Vec3, tol: number, msg: string): void {
  expect(
    distance(a, b),
    `${msg}: obtenido ${txt(a)}, esperado ${txt(b)} (tolerancia ${tol})`,
  ).toBeLessThanOrEqual(tol);
}

function cercaV2(a: Vec2, b: Vec2, tol: number, msg: string): void {
  expect(
    distance2(a, b),
    `${msg}: obtenido (${a.x}, ${a.y}), esperado (${b.x}, ${b.y}) (tolerancia ${tol})`,
  ).toBeLessThanOrEqual(tol);
}

function esUnitario(v: Vec3, msg: string, tol = 1e-12): void {
  cerca(length(v), 1, tol, `${msg} debería ser unitario`);
}

function cercaM(a: Mat4, b: Mat4, tol: number, msg: string): void {
  for (let i = 0; i < 16; i++) {
    expect(
      Math.abs(a[i] - b[i]),
      `${msg}: elemento ${i} vale ${a[i]}, se esperaba ${b[i]} (tolerancia ${tol})`,
    ).toBeLessThanOrEqual(tol);
  }
}

/** Matriz compuesta "fea": traslación · rotación · escalado no uniforme. */
function matrizFea(): Mat4 {
  return matMul(
    matTranslation(v3(5, -3, 2)),
    matMul(matRotation(v3(1, 1, 0), 0.9), matScale(v3(4, 0.25, 2))),
  );
}

// ===========================================================================
// tolerance.ts
// ===========================================================================

describe('tolerance.ts', () => {
  it('eq / isZero / sgn respetan la zona muerta EPS', () => {
    expect(eq(1, 1 + EPS / 2), 'diferencia por debajo de EPS ⇒ iguales').toBe(true);
    expect(eq(1, 1 + EPS * 10), 'diferencia muy por encima de EPS ⇒ distintos').toBe(false);
    expect(isZero(EPS), 'exactamente EPS cuenta como cero (<=)').toBe(true);
    expect(isZero(EPS * 2), '2·EPS no es cero').toBe(false);
    expect(sgn(1e-9), 'valor dentro de la zona muerta ⇒ 0').toBe(0);
    expect(sgn(1), 'positivo ⇒ 1').toBe(1);
    expect(sgn(-1), 'negativo ⇒ -1').toBe(-1);
    expect(sgn(-1e-9), 'negativo dentro de la zona muerta ⇒ 0').toBe(0);
  });

  it('clamp y lerp en los extremos', () => {
    cerca(clamp(-5, 0, 1), 0, 0, 'clamp por debajo');
    cerca(clamp(5, 0, 1), 1, 0, 'clamp por encima');
    cerca(clamp(0.5, 0, 1), 0.5, 0, 'clamp dentro');
    cerca(clamp(0, 0, 1), 0, 0, 'clamp en el límite inferior');
    cerca(clamp(1, 0, 1), 1, 0, 'clamp en el límite superior');
    // Documentado: las comparaciones con NaN son falsas, así que el NaN se propaga.
    expect(Number.isNaN(clamp(NaN, 0, 1)), 'clamp propaga NaN (no lo convierte en un límite)').toBe(true);
    cerca(lerp(2, 6, 0.25), 3, 1e-15, 'lerp interior');
    cerca(lerp(2, 6, 0), 2, 0, 'lerp en t=0');
    cerca(lerp(2, 6, 1), 6, 0, 'lerp en t=1');
  });

  it('quantize redondea a múltiplos y unsignedZero elimina el -0', () => {
    cerca(quantize(0.12345678, 1e-3), 0.123, 1e-12, 'quantize a milésimas');
    cerca(quantize(-0.0004, 1e-3), 0, 1e-12, 'quantize de un negativo pequeño');
    expect(Object.is(quantize(-0.0004, 1e-3), -0), 'quantize puede producir -0').toBe(true);
    expect(Object.is(unsignedZero(quantize(-0.0004, 1e-3)), 0), 'unsignedZero normaliza -0 a +0').toBe(true);
    expect(Object.is(unsignedZero(-0), 0), 'unsignedZero(-0) === +0').toBe(true);
    cerca(unsignedZero(-3.5), -3.5, 0, 'unsignedZero no toca valores no nulos');
  });
});

// ===========================================================================
// vec.ts
// ===========================================================================

describe('vec.ts — normalización degenerada', () => {
  it('normalize del vector nulo devuelve el vector nulo (sin NaN)', () => {
    const n = normalize(ZERO3);
    expect(isFiniteV(n), 'normalize(0) no puede producir NaN/Infinity').toBe(true);
    cercaV(n, ZERO3, 0, 'normalize(0)');
  });

  it('normalize de vectores extremos no explota', () => {
    // Por debajo de ~1e-154 el cuadrado de la longitud subdesborda a 0. Lo que
    // devuelva normalize en ese régimen NO es estable: V8 puede reducir
    // Math.sqrt(x·x) a |x| al compilar `length`, con lo que unas veces sale el
    // vector nulo y otras el unitario. Está 148 órdenes de magnitud por debajo de
    // EPS, así que sólo exigimos que el resultado sea finito y bien formado.
    for (const v of [v3(1e-320, 0, 0), v3(0, -1e-200, 0), v3(1e-180, 1e-180, 0)]) {
      const n = normalize(v);
      expect(isFiniteV(n), `normalize de ${txt(v)} debe ser finito, jamás NaN`).toBe(true);
      const l = length(n);
      expect(
        l === 0 || Math.abs(l - 1) <= 1e-12,
        `normalize de ${txt(v)} debe dar el vector nulo o un unitario; dio módulo ${l}`,
      ).toBe(true);
    }

    // 1e-150 sí es representable al cuadrado: debe salir un vector unitario exacto.
    const chico = normalize(v3(0, -1e-150, 0));
    esUnitario(chico, 'normalize(1e-150)');
    cercaV(chico, v3(0, -1, 0), 1e-15, 'dirección conservada en magnitudes diminutas');

    // Y en el otro extremo, magnitudes enormes (sin desbordar el cuadrado).
    const grande = normalize(v3(3e150, 4e150, 0));
    esUnitario(grande, 'normalize(1e150)');
    cercaV(grande, v3(0.6, 0.8, 0), 1e-15, 'dirección conservada en magnitudes enormes');

    // Magnitudes "de CAD" extremas pero razonables: 1 µm y 1000 km.
    esUnitario(normalize(v3(1e-6, 2e-6, -3e-6)), 'normalize a escala de micras');
    esUnitario(normalize(v3(1e6, -2e6, 3e6)), 'normalize a escala de miles de kilómetros');
  });

  it('normalizeOr devuelve el fallback justo por debajo de EPS', () => {
    cercaV(normalizeOr(ZERO3, AXIS_Z), AXIS_Z, 0, 'normalizeOr(0) ⇒ fallback');
    cercaV(normalizeOr(v3(EPS / 2, 0, 0), AXIS_Z), AXIS_Z, 0, 'longitud < EPS ⇒ fallback');
    // Longitud claramente por encima de EPS: normaliza de verdad.
    cercaV(normalizeOr(v3(1e-3, 0, 0), AXIS_Z), AXIS_X, 1e-15, 'longitud > EPS ⇒ normaliza');
  });
});

describe('vec.ts — ángulos', () => {
  it('angleBetween con vectores idénticos da 0 y nunca NaN', () => {
    const a = v3(3, 4, 12);
    const ang = angleBetween(a, a);
    expect(Number.isNaN(ang), 'angleBetween(a, a) no puede ser NaN').toBe(false);
    cerca(ang, 0, 1e-7, 'ángulo consigo mismo');

    // El caso realmente peligroso: dot/(la·lb) puede salir 1+1e-16 y romper acos.
    const enorme = v3(1e8, 1e8, 1e8);
    const ang2 = angleBetween(enorme, enorme);
    expect(Number.isNaN(ang2), 'clamp debe evitar el NaN de acos(1+ulp)').toBe(false);
    cerca(ang2, 0, 1e-7, 'ángulo consigo mismo (magnitud 1e8)');

    // Mismo sentido, magnitudes muy dispares.
    cerca(angleBetween(v3(1e-6, 0, 0), v3(1e6, 0, 0)), 0, 1e-9, 'paralelos con magnitudes 1e-6 vs 1e6');
  });

  it('angleBetween con vectores opuestos da π y nunca NaN', () => {
    const a = v3(3, 4, 12);
    const ang = angleBetween(a, neg(a));
    expect(Number.isNaN(ang), 'angleBetween(a, -a) no puede ser NaN').toBe(false);
    cerca(ang, Math.PI, 1e-7, 'ángulo con el opuesto');

    const ang2 = angleBetween(v3(1e8, 1e8, 1e8), v3(-1e8, -1e8, -1e8));
    expect(Number.isNaN(ang2), 'clamp debe evitar el NaN de acos(-1-ulp)').toBe(false);
    cerca(ang2, Math.PI, 1e-7, 'ángulo con el opuesto (magnitud 1e8)');

    cerca(angleBetween(v3(1e-6, 0, 0), v3(-1e6, 0, 0)), Math.PI, 1e-9, 'antiparalelos con magnitudes dispares');
  });

  it('angleBetween con un operando nulo devuelve 0 en vez de NaN', () => {
    expect(Number.isNaN(angleBetween(ZERO3, AXIS_X)), 'no debe ser NaN').toBe(false);
    cerca(angleBetween(ZERO3, AXIS_X), 0, 0, 'ángulo con vector nulo');
    cerca(angleBetween(AXIS_X, ZERO3), 0, 0, 'ángulo con vector nulo (invertido)');
  });

  it('angleBetween coincide con los ángulos notables', () => {
    cerca(angleBetween(AXIS_X, AXIS_Y), Math.PI / 2, 1e-15, '90°');
    cerca(angleBetween(AXIS_X, v3(1, 1, 0)), Math.PI / 4, 1e-15, '45°');
    cerca(angleBetween(AXIS_X, v3(-1, 1, 0)), (3 * Math.PI) / 4, 1e-15, '135°');
  });

  it('signedAngle tiene el signo correcto alrededor del eje', () => {
    cerca(signedAngle(AXIS_X, AXIS_Y, AXIS_Z), Math.PI / 2, 1e-15, 'X→Y alrededor de +Z es +90°');
    cerca(signedAngle(AXIS_Y, AXIS_X, AXIS_Z), -Math.PI / 2, 1e-15, 'Y→X alrededor de +Z es -90°');
    cerca(signedAngle(AXIS_X, AXIS_Y, neg(AXIS_Z)), -Math.PI / 2, 1e-15, 'invertir el eje invierte el signo');
    cerca(signedAngle(AXIS_X, AXIS_X, AXIS_Z), 0, 1e-15, 'ángulo consigo mismo');
    cerca(Math.abs(signedAngle(AXIS_X, neg(AXIS_X), AXIS_Z)), Math.PI, 1e-15, 'opuestos ⇒ ±π');
  });

  it('signedAngle proyecta sobre el plano del eje e ignora la escala del eje', () => {
    // Las componentes a lo largo del eje deben desaparecer.
    const a = v3(1, 0, 5);
    const b = v3(0, 1, -3);
    cerca(signedAngle(a, b, v3(0, 0, 7)), Math.PI / 2, 1e-15, 'eje no unitario y componentes axiales');
    // Antisimetría.
    const c = v3(2, 1, 0);
    const d = v3(-1, 3, 0);
    cerca(
      signedAngle(c, d, AXIS_Z) + signedAngle(d, c, AXIS_Z),
      0, 1e-15, 'signedAngle debe ser antisimétrico',
    );
  });

  it('signedAngle devuelve 0 si algún vector es paralelo al eje', () => {
    cerca(signedAngle(AXIS_Z, AXIS_X, AXIS_Z), 0, 0, 'a paralelo al eje ⇒ 0');
    cerca(signedAngle(AXIS_X, AXIS_Z, AXIS_Z), 0, 0, 'b paralelo al eje ⇒ 0');
  });
});

describe('vec.ts — rotateAround', () => {
  it('90° de X alrededor de Z da Y', () => {
    cercaV(rotateAround(AXIS_X, AXIS_Z, Math.PI / 2), AXIS_Y, 1e-15, 'X rotado 90° sobre Z');
    cercaV(rotateAround(AXIS_Y, AXIS_Z, Math.PI / 2), neg(AXIS_X), 1e-15, 'Y rotado 90° sobre Z');
    cercaV(rotateAround(AXIS_Y, AXIS_X, Math.PI / 2), AXIS_Z, 1e-15, 'Y rotado 90° sobre X');
    cercaV(rotateAround(AXIS_Z, AXIS_Y, Math.PI / 2), AXIS_X, 1e-15, 'Z rotado 90° sobre Y');
  });

  it('360° vuelve exactamente al origen (dentro de tolerancia)', () => {
    const casos: Vec3[] = [v3(1, 0, 0), v3(3, -4, 12), v3(1e-6, 2e-6, -3e-6), v3(1e6, -1e6, 5e5)];
    const ejes: Vec3[] = [AXIS_Z, v3(1, 1, 1), v3(0, -2, 5)];
    for (const v of casos) {
      for (const e of ejes) {
        const r = rotateAround(v, e, Math.PI * 2);
        cercaV(r, v, 1e-9 * Math.max(1, length(v)), `giro de 360° sobre ${txt(e)} para ${txt(v)}`);
      }
    }
  });

  it('el eje no necesita ser unitario y la rotación conserva longitud y componente axial', () => {
    const v = v3(3, -4, 12);
    const eje = v3(0, 0, 9); // deliberadamente no unitario
    const r = rotateAround(v, eje, 1.234);
    cerca(length(r), length(v), 1e-12, 'la rotación conserva la longitud');
    cerca(dot(r, normalize(eje)), dot(v, normalize(eje)), 1e-12, 'conserva la componente axial');
    cerca(signedAngle(v, r, eje), 1.234, 1e-12, 'el ángulo girado coincide con el pedido');
  });

  it('rotar θ y luego -θ devuelve el vector original', () => {
    const v = v3(0.3, -7, 2.5);
    const eje = v3(-1, 2, 0.5);
    const ida = rotateAround(v, eje, 0.777);
    const vuelta = rotateAround(ida, eje, -0.777);
    cercaV(vuelta, v, 1e-14, 'ida y vuelta');
  });
});

describe('vec.ts — anyPerpendicular', () => {
  it('devuelve un vector unitario y realmente perpendicular para 20 direcciones', () => {
    const dirs: Vec3[] = [
      // Canónicas y sus opuestas (6).
      AXIS_X, AXIS_Y, AXIS_Z, neg(AXIS_X), neg(AXIS_Y), neg(AXIS_Z),
      // Diagonales de plano (3).
      v3(1, 1, 0), v3(0, 1, 1), v3(1, 0, -1),
      // Diagonales de cubo (2).
      v3(1, 1, 1), v3(-1, 1, -1),
      // Casi-canónicas (ponen a prueba el desempate del eje auxiliar) (3).
      v3(1, 1e-12, 0), v3(1e-12, 1, 1e-13), v3(1e-9, 1e-9, 1),
      // Magnitudes extremas (3).
      v3(1e-6, 2e-6, -3e-6), v3(1e6, -1e6, 1e6), v3(0, 0, 1e8),
      // Genéricas (3).
      v3(0.3, -0.9, 4.2), v3(-7, 0.001, 0.002), v3(2, 3, 6),
    ];
    expect(dirs.length, 'la batería debe tener 20 direcciones').toBe(20);

    for (let i = 0; i < dirs.length; i++) {
      const n = dirs[i];
      const p = anyPerpendicular(n);
      const nu = normalize(n);
      esUnitario(p, `anyPerpendicular #${i} de ${txt(n)}`, 1e-15);
      expect(
        Math.abs(dot(p, nu)),
        `anyPerpendicular #${i} de ${txt(n)} dio ${txt(p)}, dot=${dot(p, nu)} (tolerancia 1e-12)`,
      ).toBeLessThanOrEqual(1e-12);
      expect(isPerpendicular(p, n, 1e-12), `#${i}: isPerpendicular debe confirmarlo`).toBe(true);
    }
  });

  it('es determinista: la misma entrada da siempre la misma salida', () => {
    const n = v3(0.3, -0.9, 4.2);
    cercaV(anyPerpendicular(n), anyPerpendicular(n), 0, 'determinismo');
  });

  it('junto con cross forma una base ortonormal dextrógira', () => {
    for (const n of [AXIS_X, AXIS_Y, AXIS_Z, v3(1, 2, 3), v3(-4, 0.5, 0)]) {
      const nu = normalize(n);
      const u = anyPerpendicular(nu);
      const w = cross(nu, u);
      esUnitario(w, `tercer eje de la base de ${txt(n)}`, 1e-15);
      cercaV(cross(u, w), nu, 1e-14, `base dextrógira para ${txt(n)}`);
    }
  });
});

describe('vec.ts — isParallel / isPerpendicular con magnitudes dispares', () => {
  it('isParallel es cierto para 1e-6 frente a 1e6 en la misma recta', () => {
    expect(isParallel(v3(1e-6, 0, 0), v3(1e6, 0, 0)), 'mismo sentido, 12 órdenes de magnitud').toBe(true);
    expect(isParallel(v3(1e-6, 0, 0), v3(-1e6, 0, 0)), 'antiparalelos también cuentan').toBe(true);
    expect(
      isParallel(v3(1e-6, 2e-6, -3e-6), v3(1e6, 2e6, -3e6)),
      'dirección oblicua con magnitudes 1e-6 y 1e6',
    ).toBe(true);
  });

  it('isParallel es falso para direcciones distintas aunque las magnitudes sean dispares', () => {
    expect(isParallel(v3(1e-6, 0, 0), v3(0, 1e6, 0)), 'perpendiculares no son paralelos').toBe(false);
    // Ángulo ≈ 1e-6 rad: por encima del umbral relativo 1e-9.
    expect(isParallel(v3(1, 0, 0), v3(1e6, 1, 0)), 'desviación de 1e-6 rad ⇒ no paralelos').toBe(false);
    // Ángulo ≈ 1e-10 rad: por debajo del umbral ⇒ sí paralelos.
    expect(isParallel(v3(1, 0, 0), v3(1e6, 1e-4, 0)), 'desviación de 1e-10 rad ⇒ paralelos').toBe(true);
  });

  it('isParallel con un vector nulo o subnormal devuelve false (no NaN)', () => {
    expect(isParallel(ZERO3, AXIS_X), 'vector nulo').toBe(false);
    expect(isParallel(v3(1e-200, 0, 0), v3(1e-200, 0, 0)), 'lengthSq subnormal ⇒ denominador 0').toBe(false);
  });

  it('isPerpendicular es cierto para 1e-6 frente a 1e6 en ejes distintos', () => {
    expect(isPerpendicular(v3(1e-6, 0, 0), v3(0, 1e6, 0)), 'ejes ortogonales, magnitudes dispares').toBe(true);
    expect(
      isPerpendicular(v3(3e-6, 4e-6, 0), v3(-4e6, 3e6, 0)),
      'perpendiculares oblicuos con magnitudes dispares',
    ).toBe(true);
  });

  it('isPerpendicular es falso cuando el coseno relativo supera el umbral', () => {
    // dot = 1e-6, |a||b| ≈ 1 ⇒ coseno 1e-6 > 1e-9.
    expect(isPerpendicular(v3(1e-6, 0, 0), v3(1, 1e6, 0)), 'coseno 1e-6 ⇒ no perpendicular').toBe(false);
    expect(isPerpendicular(v3(1e-6, 0, 0), v3(1e6, 0, 0)), 'paralelos no son perpendiculares').toBe(false);
    expect(isPerpendicular(ZERO3, AXIS_X), 'vector nulo ⇒ false').toBe(false);
  });

  it('el criterio es relativo: escalar los vectores no cambia la respuesta', () => {
    const a = v3(1, 2, 3);
    const b = v3(3, 2, 1);
    for (const [sa, sb] of [[1, 1], [1e-6, 1e6], [1e6, 1e-6], [1e-3, 1e3]] as const) {
      expect(
        isParallel(mul(a, sa), mul(b, sb)),
        `isParallel invariante a la escala (${sa}, ${sb})`,
      ).toBe(false);
      expect(
        isParallel(mul(a, sa), mul(a, sb)),
        `isParallel(a, a) invariante a la escala (${sa}, ${sb})`,
      ).toBe(true);
    }
  });
});

// ===========================================================================
// mat.ts
// ===========================================================================

describe('mat.ts — álgebra básica', () => {
  const R = matRotation(v3(1, 2, -3), 0.7);
  const S = matScale(v3(2, 3, 0.5));
  const T = matTranslation(v3(1, -2, 3));

  it('matMul es asociativa', () => {
    cercaM(matMul(matMul(R, S), T), matMul(R, matMul(S, T)), 1e-12, '(R·S)·T vs R·(S·T)');
    cercaM(matMul(matMul(T, R), S), matMul(T, matMul(R, S)), 1e-12, '(T·R)·S vs T·(R·S)');
  });

  it('matMul NO es conmutativa (comprobación de que el orden importa)', () => {
    const p = v3(1, 0, 0);
    const rs = transformPoint(matMul(T, S), p);
    const sr = transformPoint(matMul(S, T), p);
    expect(distance(rs, sr), 'T·S y S·T deben diferir claramente').toBeGreaterThan(0.5);
    // Semántica documentada: matMul(a, b) aplica primero b.
    cercaV(transformPoint(matMul(T, S), p), transformPoint(T, transformPoint(S, p)), 1e-14,
      'matMul(a,b)·p == a·(b·p)');
  });

  it('IDENTITY es neutro y isIdentity la reconoce', () => {
    cercaM(matMul(IDENTITY, R), R, 0, 'I·R');
    cercaM(matMul(R, IDENTITY), R, 0, 'R·I');
    expect(isIdentity(IDENTITY), 'isIdentity(I)').toBe(true);
    expect(isIdentity(matMul(R, matInvert(R)!)), 'R·R⁻¹ debe ser la identidad').toBe(true);
    expect(isIdentity(T), 'una traslación no es la identidad').toBe(false);
  });

  it('matDeterminant en los casos conocidos', () => {
    cerca(matDeterminant(IDENTITY), 1, 1e-15, 'det(I)');
    cerca(matDeterminant(T), 1, 1e-15, 'det(traslación)');
    cerca(matDeterminant(R), 1, 1e-12, 'det(rotación)');
    cerca(matDeterminant(matScale(v3(2, 3, 4))), 24, 1e-12, 'det(escalado)');
    cerca(matDeterminant(matScale(v3(-1, 1, 1))), -1, 1e-15, 'det(reflexión)');
    cerca(matDeterminant(matScale(v3(1, 0, 1))), 0, 1e-18, 'det(singular)');
  });
});

describe('mat.ts — matInvert', () => {
  it('m·m⁻¹ = I para rotaciones', () => {
    for (const ang of [0.1, 1.0, Math.PI / 2, Math.PI, 2.9]) {
      const m = matRotation(v3(1, -2, 3), ang);
      const inv = matInvert(m);
      expect(inv, `la rotación de ${ang} rad debe ser invertible`).not.toBeNull();
      cercaM(matMul(m, inv!), IDENTITY, 1e-14, `R(${ang})·R⁻¹`);
      cercaM(matMul(inv!, m), IDENTITY, 1e-14, `R⁻¹·R(${ang})`);
    }
  });

  it('m·m⁻¹ = I para escalados NO uniformes', () => {
    for (const s of [v3(2, 3, 4), v3(1e-3, 1e3, 1), v3(-2, 0.5, 7)]) {
      const m = matScale(s);
      const inv = matInvert(m);
      expect(inv, `escalado ${txt(s)} invertible`).not.toBeNull();
      cercaM(matMul(m, inv!), IDENTITY, 1e-12, `S${txt(s)}·S⁻¹`);
    }
  });

  it('m·m⁻¹ = I para traslaciones y para la composición completa', () => {
    const t = matTranslation(v3(1e4, -7, 0.001));
    cercaM(matMul(t, matInvert(t)!), IDENTITY, 1e-12, 'T·T⁻¹');

    const fea = matrizFea();
    const inv = matInvert(fea);
    expect(inv, 'la matriz compuesta debe ser invertible').not.toBeNull();
    cercaM(matMul(fea, inv!), IDENTITY, 1e-12, 'M·M⁻¹ (traslación·rotación·escalado)');
    cercaM(matMul(inv!, fea), IDENTITY, 1e-12, 'M⁻¹·M');

    // Y la inversa realmente deshace la transformación de puntos.
    const p = v3(-3, 2.5, 11);
    cercaV(transformPoint(inv!, transformPoint(fea, p)), p, 1e-11, 'M⁻¹(M(p)) == p');
  });

  it('matInvert de una matriz singular devuelve null', () => {
    expect(matInvert(matScale(v3(1, 0, 1))), 'escalado con un eje aplastado').toBeNull();
    expect(matInvert(matScale(v3(0, 0, 0))), 'escalado nulo').toBeNull();
    // Dos ejes locales iguales ⇒ columnas linealmente dependientes.
    expect(
      matInvert(matFromAxes(AXIS_X, AXIS_X, AXIS_Z, ZERO3)),
      'dos ejes idénticos ⇒ singular',
    ).toBeNull();
    // Un eje que es combinación lineal de los otros dos.
    expect(
      matInvert(matFromAxes(v3(1, 0, 0), v3(0, 1, 0), v3(1, 1, 0), ZERO3)),
      'tercer eje coplanar con los otros dos ⇒ singular',
    ).toBeNull();
    // Todo ceros.
    expect(matInvert(new Array<number>(16).fill(0)), 'matriz de ceros').toBeNull();
  });
});

describe('mat.ts — transformNormal (prueba clave con escalado no uniforme)', () => {
  it('mantiene la perpendicularidad frente a los vectores del plano', () => {
    const n = normalize(v3(1, 2, 3));
    const t1 = anyPerpendicular(n);
    const t2 = cross(n, t1);

    const casos: [string, Mat4][] = [
      ['escalado no uniforme puro', matScale(v3(4, 0.25, 2))],
      ['escalado extremo', matScale(v3(1e3, 1e-3, 1))],
      ['traslación·rotación·escalado', matrizFea()],
      ['escalado con reflexión', matScale(v3(-3, 0.5, 2))],
    ];

    for (const [nombre, m] of casos) {
      const nT = transformNormal(m, n);
      esUnitario(nT, `transformNormal (${nombre})`, 1e-12);

      const t1T = normalize(transformVector(m, t1));
      const t2T = normalize(transformVector(m, t2));
      expect(
        Math.abs(dot(nT, t1T)),
        `${nombre}: la normal transformada debe seguir ⟂ al tangente 1 (dot=${dot(nT, t1T)})`,
      ).toBeLessThanOrEqual(1e-12);
      expect(
        Math.abs(dot(nT, t2T)),
        `${nombre}: la normal transformada debe seguir ⟂ al tangente 2 (dot=${dot(nT, t2T)})`,
      ).toBeLessThanOrEqual(1e-12);
    }
  });

  it('la transformación ingenua (transformVector) SÍ rompe la perpendicularidad', () => {
    // Si esta prueba fallase, la anterior sería trivial y no probaría nada.
    const n = normalize(v3(1, 2, 3));
    const t1 = normalize(transformVector(matScale(v3(4, 0.25, 2)), anyPerpendicular(n)));
    const ingenua = normalize(transformVector(matScale(v3(4, 0.25, 2)), n));
    expect(
      Math.abs(dot(ingenua, t1)),
      'con escalado no uniforme, transformVector(n) deja de ser perpendicular',
    ).toBeGreaterThan(1e-2);
  });

  it('coincide con transformVector cuando la transformación es rígida', () => {
    const m = matMul(matTranslation(v3(3, 1, -2)), matRotation(v3(0, 1, 1), 1.1));
    const n = normalize(v3(-2, 5, 1));
    cercaV(transformNormal(m, n), normalize(transformVector(m, n)), 1e-13,
      'en una isometría la inversa traspuesta coincide con la propia matriz');
  });

  it('mantiene planos: todos los puntos del plano transformado siguen equidistantes', () => {
    const pl = planeFromPointNormal(v3(0.5, -1, 2), v3(1, 2, 3));
    const b = planeBasis(pl);
    const m = matrizFea();
    const nT = transformNormal(m, pl.n);
    const puntos = [v2(0, 0), v2(3, -2), v2(-5, 7), v2(120, 40)].map((q) => transformPoint(m, to3D(b, q)));
    const d0 = dot(nT, puntos[0]);
    for (let i = 1; i < puntos.length; i++) {
      cerca(dot(nT, puntos[i]), d0, 1e-9, `el punto ${i} debe seguir en el plano transformado`);
    }
  });
});

describe('mat.ts — rotación, orientación y escalas', () => {
  it('matRotation alrededor de un origen distinto del global', () => {
    const o = v3(2, 0, 0);
    const m = matRotation(AXIS_Z, Math.PI / 2, o);
    cercaV(transformPoint(m, o), o, 1e-14, 'el origen de la rotación es un punto fijo');
    cercaV(transformPoint(m, v3(3, 0, 0)), v3(2, 1, 0), 1e-14, '(3,0,0) gira 90° hasta (2,1,0)');
    cercaV(transformPoint(m, v3(2, 0, 5)), v3(2, 0, 5), 1e-14, 'los puntos del eje quedan fijos');

    // Cuatro cuartos de vuelta = identidad.
    const cuatro = matMul(matMul(m, m), matMul(m, m));
    cercaM(cuatro, IDENTITY, 1e-13, 'cuatro rotaciones de 90° son la identidad');

    // Con un eje oblicuo y un origen cualquiera: la distancia al eje se conserva.
    const o2 = v3(-1, 4, 2);
    const m2 = matRotation(v3(1, 1, 1), 1.234, o2);
    const p = v3(5, -2, 0);
    const q = transformPoint(m2, p);
    const eje = normalize(v3(1, 1, 1));
    const rel = sub(p, o2);
    const relQ = sub(q, o2);
    cerca(length(rel), length(relQ), 1e-13, 'la rotación conserva la distancia al origen de giro');
    cerca(dot(rel, eje), dot(relQ, eje), 1e-13, 'conserva la componente sobre el eje');
    cercaV(transformPoint(m2, o2), o2, 1e-13, 'o2 es punto fijo');
  });

  it('matTranslationOf extrae la traslación de una composición', () => {
    const t = v3(7, -3, 0.25);
    cercaV(matTranslationOf(matTranslation(t)), t, 0, 'traslación pura');
    // T·R deja la traslación intacta en la última columna.
    cercaV(matTranslationOf(matMul(matTranslation(t), matRotation(AXIS_Z, 1.0))), t, 1e-15, 'T·R');
  });

  it('matFlipsOrientation detecta las reflexiones', () => {
    expect(matFlipsOrientation(IDENTITY), 'identidad no invierte').toBe(false);
    expect(matFlipsOrientation(matTranslation(v3(9, 9, 9))), 'traslación no invierte').toBe(false);
    expect(matFlipsOrientation(matRotation(v3(1, 2, 3), 2.0)), 'rotación no invierte').toBe(false);
    expect(matFlipsOrientation(matScale(v3(3, 4, 5))), 'escalado positivo no invierte').toBe(false);

    expect(matFlipsOrientation(matScale(v3(-1, 1, 1))), 'reflexión en X invierte').toBe(true);
    expect(matFlipsOrientation(matScale(v3(1, -1, 1))), 'reflexión en Y invierte').toBe(true);
    expect(matFlipsOrientation(matScale(v3(1, 1, -1))), 'reflexión en Z invierte').toBe(true);
    expect(matFlipsOrientation(matScale(v3(-1, -1, 1))), 'doble reflexión = rotación, no invierte').toBe(false);
    expect(matFlipsOrientation(matScale(v3(-1, -1, -1))), 'triple reflexión sí invierte').toBe(true);

    // Rotación compuesta con reflexión: sigue invirtiendo.
    expect(
      matFlipsOrientation(matMul(matRotation(v3(1, 1, 0), 0.6), matScale(v3(-2, 3, 4)))),
      'rotación·reflexión invierte',
    ).toBe(true);
    // Base explícitamente levógira.
    expect(matFlipsOrientation(matFromAxes(AXIS_X, AXIS_Z, AXIS_Y, ZERO3)), 'base levógira').toBe(true);
    expect(matFlipsOrientation(matFromAxes(AXIS_X, AXIS_Y, AXIS_Z, ZERO3)), 'base dextrógira').toBe(false);
  });

  it('matScaleFactors y matIsRigid', () => {
    cercaV(matScaleFactors(IDENTITY), v3(1, 1, 1), 0, 'identidad');
    cercaV(matScaleFactors(matScale(v3(2, 3, 4))), v3(2, 3, 4), 1e-15, 'escalado puro');
    cercaV(matScaleFactors(matScale(v3(-2, 3, -4))), v3(2, 3, 4), 1e-15, 'las escalas negativas dan módulo');
    cercaV(matScaleFactors(matRotation(v3(1, 2, 3), 1.1)), v3(1, 1, 1), 1e-14, 'rotación pura');
    cercaV(matScaleFactors(matTranslation(v3(100, 0, 0))), v3(1, 1, 1), 0, 'traslación pura');
    // R·S: las columnas son los ejes escalados y luego rotados ⇒ módulos preservados.
    cercaV(
      matScaleFactors(matMul(matRotation(v3(1, 2, 3), 1.1), matScale(v3(2, 3, 4)))),
      v3(2, 3, 4), 1e-13, 'rotación·escalado',
    );

    expect(matIsRigid(matMul(matTranslation(v3(4, 5, 6)), matRotation(AXIS_Y, 0.3))), 'isometría').toBe(true);
    expect(matIsRigid(matScale(v3(1, 1, 1.001))), 'escalado del 0.1% no es rígido').toBe(false);
    expect(matIsRigid(matScale(v3(-1, 1, 1))), 'una reflexión pura conserva longitudes').toBe(true);
  });
});

// ===========================================================================
// plane.ts
// ===========================================================================

describe('plane.ts — construcción', () => {
  it('planeFrom3Points con puntos colineales devuelve null', () => {
    expect(planeFrom3Points(v3(0, 0, 0), v3(1, 1, 1), v3(2, 2, 2)), 'colineales exactos').toBeNull();
    expect(planeFrom3Points(v3(0, 0, 0), v3(1, 0, 0), v3(-5, 0, 0)), 'colineales sobre X').toBeNull();
    expect(planeFrom3Points(v3(1, 2, 3), v3(1, 2, 3), v3(4, 5, 6)), 'dos puntos coincidentes').toBeNull();
    expect(planeFrom3Points(v3(1, 2, 3), v3(1, 2, 3), v3(1, 2, 3)), 'tres puntos coincidentes').toBeNull();
    // Casi colineal por debajo del umbral relativo (desviación 1e-12 en una base de 1).
    expect(planeFrom3Points(v3(0, 0, 0), v3(1, 0, 0), v3(2, 1e-12, 0)), 'casi colineal ⇒ null').toBeNull();
  });

  it('planeFrom3Points sí construye el plano cuando la desviación es apreciable', () => {
    const pl = planeFrom3Points(v3(0, 0, 0), v3(1, 0, 0), v3(2, 1e-3, 0));
    expect(pl, 'desviación 1e-3 ⇒ plano válido').not.toBeNull();
    cercaV(pl!.n, AXIS_Z, 1e-9, 'normal del plano casi colineal');
  });

  it('planeFrom3Points respeta la regla de la mano derecha', () => {
    const pl = planeFrom3Points(v3(0, 0, 0), v3(1, 0, 0), v3(0, 1, 0))!;
    cercaV(pl.n, AXIS_Z, 1e-15, 'normal +Z para orden antihorario');
    cerca(pl.d, 0, 1e-15, 'plano por el origen');
    const inv = planeFrom3Points(v3(0, 0, 0), v3(0, 1, 0), v3(1, 0, 0))!;
    cercaV(inv.n, neg(AXIS_Z), 1e-15, 'invertir el orden invierte la normal');

    const desp = planeFrom3Points(v3(0, 0, 5), v3(1, 0, 5), v3(0, 1, 5))!;
    cerca(desp.d, 5, 1e-15, 'd es la altura con signo del plano');
  });

  it('newellNormal: su módulo es el área (no el doble) y el sentido sigue el giro', () => {
    const cuadrado = [v3(0, 0, 0), v3(1, 0, 0), v3(1, 1, 0), v3(0, 1, 0)];
    const n = newellNormal(cuadrado);
    cercaV(n, AXIS_Z, 1e-15, 'normal del cuadrado unidad antihorario');
    cerca(length(n), 1, 1e-15, '|newellNormal| == área del polígono');
    cerca(polygonArea3(cuadrado), 1, 1e-15, 'polygonArea3 coincide');
    cercaV(newellNormal([...cuadrado].reverse()), neg(AXIS_Z), 1e-15, 'giro invertido ⇒ normal invertida');
    cercaV(newellNormal([v3(0, 0, 0), v3(1, 0, 0), v3(2, 0, 0)]), ZERO3, 1e-15, 'polígono degenerado ⇒ 0');
  });

  it('planeFromPolygon (Newell) ajusta 8 vértices casi coplanares mejor que 3 puntos', () => {
    // Octógono "ondulado": los vértices alternan ±1e-7 en Z.
    const pts: Vec3[] = [];
    for (let i = 0; i < 8; i++) {
      const th = (i / 8) * Math.PI * 2;
      pts.push(v3(Math.cos(th) * 3, Math.sin(th) * 3, ((i % 2) - 0.5) * 2e-7));
    }
    const pl = planeFromPolygon(pts);
    expect(pl, 'el octógono debe producir un plano').not.toBeNull();
    cercaV(pl!.n, AXIS_Z, 1e-9, 'la normal ajustada es ~+Z');
    cerca(pl!.d, 0, 1e-9, 'el plano pasa por el centro');

    const maxNewell = Math.max(...pts.map((p) => Math.abs(planeDistance(pl!, p))));
    expect(
      maxNewell,
      `la desviación máxima (${maxNewell}) no debe superar la amplitud de la ondulación (1e-7)`,
    ).toBeLessThanOrEqual(1.5e-7);

    // Referencia: el plano por los tres primeros vértices es peor o igual.
    const pl3 = planeFrom3Points(pts[0], pts[1], pts[2])!;
    const max3 = Math.max(...pts.map((p) => Math.abs(planeDistance(pl3, p))));
    expect(
      maxNewell,
      `Newell (${maxNewell}) debe ajustar al menos tan bien como 3 puntos (${max3})`,
    ).toBeLessThanOrEqual(max3 + 1e-15);

    // Todos los vértices "pertenecen" al plano con la tolerancia del kernel.
    for (let i = 0; i < pts.length; i++) {
      expect(planeContains(pl!, pts[i], 1e-6), `el vértice ${i} debe estar en el plano`).toBe(true);
    }
  });

  it('planeFromPolygon coincide con planeFrom3Points en un triángulo exacto', () => {
    const a = v3(1, 0, 0);
    const b = v3(0, 2, 0);
    const c = v3(0, 0, 3);
    const p1 = planeFromPolygon([a, b, c])!;
    const p2 = planeFrom3Points(a, b, c)!;
    cercaV(p1.n, p2.n, 1e-15, 'normales iguales');
    cerca(p1.d, p2.d, 1e-15, 'distancias iguales');
  });

  it('planeFromPolygon devuelve null en polígonos degenerados', () => {
    expect(planeFromPolygon([v3(0, 0, 0), v3(1, 0, 0), v3(2, 0, 0), v3(3, 0, 0)]), 'colineales').toBeNull();
    expect(planeFromPolygon([v3(1, 1, 1), v3(1, 1, 1), v3(1, 1, 1)]), 'todos iguales').toBeNull();
    expect(planeFromPolygon([v3(0, 0, 0), v3(1, 0, 0)]), 'menos de 3 vértices').toBeNull();
  });
});

describe('plane.ts — distancias, proyección y canonicalización', () => {
  const zEq2: Plane = { n: AXIS_Z, d: 2 };

  it('planeDistance tiene el signo correcto', () => {
    cerca(planeDistance(zEq2, v3(0, 0, 5)), 3, 1e-15, 'por encima ⇒ positivo');
    cerca(planeDistance(zEq2, v3(0, 0, -1)), -3, 1e-15, 'por debajo ⇒ negativo');
    cerca(planeDistance(zEq2, v3(100, -100, 2)), 0, 1e-13, 'sobre el plano ⇒ 0');
    // Invertir el plano invierte el signo de todas las distancias.
    const flip = planeFlip(zEq2);
    cerca(planeDistance(flip, v3(0, 0, 5)), -3, 1e-15, 'plano invertido ⇒ signo opuesto');

    const obl = planeFromPointNormal(v3(1, 1, 1), v3(1, 1, 1));
    cerca(planeDistance(obl, v3(1, 1, 1)), 0, 1e-15, 'el punto de apoyo está en el plano');
    cerca(
      planeDistance(obl, add(v3(1, 1, 1), mul(normalize(v3(1, 1, 1)), 4))),
      4, 1e-14, 'desplazamiento de 4 a lo largo de la normal',
    );
  });

  it('planeProject es idempotente y deja el punto en el plano', () => {
    const pl = planeFromPointNormal(v3(0.5, -1, 2), v3(1, 2, 3));
    for (const p of [v3(0, 0, 0), v3(1000, -2000, 500), v3(-1e-6, 1e-6, 1e-6), v3(1e4, 1e4, 1e4)]) {
      const q = planeProject(pl, p);
      const q2 = planeProject(pl, q);
      cercaV(q2, q, 1e-9, `planeProject debe ser idempotente para ${txt(p)}`);
      expect(
        Math.abs(planeDistance(pl, q)),
        `la proyección de ${txt(p)} debe caer en el plano`,
      ).toBeLessThanOrEqual(1e-9);
      // El desplazamiento es paralelo a la normal.
      const delta = sub(q, p);
      if (length(delta) > 1e-12) {
        expect(isParallel(delta, pl.n, 1e-9), `el desplazamiento de ${txt(p)} debe ir por la normal`).toBe(true);
      }
    }
    // Un punto ya en el plano no se mueve.
    const o = planeOrigin(pl);
    cercaV(planeProject(pl, o), o, 1e-14, 'planeOrigin es un punto fijo de la proyección');
    cerca(planeDistance(pl, o), 0, 1e-15, 'planeOrigin está en el plano');
  });

  it('planeCanonical fuerza el primer componente significativo a positivo', () => {
    cercaV(planeCanonical({ n: v3(0, 0, -1), d: -2 }).n, AXIS_Z, 0, 'normal -Z se voltea');
    cercaV(planeCanonical({ n: v3(0, -1, 0), d: 3 }).n, AXIS_Y, 0, 'normal -Y se voltea');
    cercaV(planeCanonical({ n: v3(-1, 0, 0), d: 3 }).n, AXIS_X, 0, 'normal -X se voltea');
    cercaV(planeCanonical({ n: AXIS_Y, d: 3 }).n, AXIS_Y, 0, 'normal +Y se conserva');
    // x despreciable ⇒ decide y; y despreciable ⇒ decide z.
    cercaV(planeCanonical({ n: v3(1e-12, -1, 0), d: 1 }).n, v3(-1e-12, 1, 0), 0, 'x despreciable, y negativa');
    cercaV(planeCanonical({ n: v3(1e-12, 1e-12, -1), d: 1 }).n, v3(-1e-12, -1e-12, 1), 0, 'x,y despreciables, z negativa');
    // La canonicalización es idempotente.
    const c = planeCanonical({ n: normalize(v3(-1, 2, -3)), d: -4 });
    cercaV(planeCanonical(c).n, c.n, 0, 'planeCanonical es idempotente');
  });

  it('planeKey da la MISMA clave para un plano y su opuesto', () => {
    const casos: Plane[] = [
      { n: AXIS_Z, d: 2 },
      { n: AXIS_X, d: -3 },
      planeFromPointNormal(v3(1.5, 0, 0), v3(1, 2, 2)),
      planeFromPointNormal(v3(0, 0, 0), v3(0, -1, 0)),
      planeFromPointNormal(v3(-4, 7, 1), v3(-3, 0, 4)),
    ];
    for (const pl of casos) {
      expect(
        planeKey(pl),
        `el plano ${txt(pl.n)}·p=${pl.d} y su opuesto deben compartir clave`,
      ).toBe(planeKey(planeFlip(pl)));
      expect(planeEquals(pl, planeFlip(pl), false), 'planeEquals no orientado los considera iguales').toBe(true);
      expect(planeEquals(pl, planeFlip(pl), true), 'planeEquals orientado los distingue').toBe(false);
    }
  });

  it('planeKey absorbe las perturbaciones por debajo de la tolerancia', () => {
    // Base: valores que son múltiplos exactos del paso 1e-6 (lejos de la frontera de redondeo).
    const base: Plane = { n: AXIS_Z, d: 2 };
    const perturbado: Plane = { n: normalize(v3(1e-10, -2e-10, 1)), d: 2 + 1e-10 };
    expect(planeKey(perturbado), 'perturbación de 1e-10 ⇒ misma clave').toBe(planeKey(base));
    expect(planeKey(planeFlip(perturbado)), 'perturbación + volteo ⇒ misma clave').toBe(planeKey(base));

    const obl = planeFromPointNormal(v3(1.5, 0, 0), v3(1, 2, 2)); // n = (1/3, 2/3, 2/3), d = 0.5
    const oblPert = planeFromPointNormal(
      v3(1.5 + 1e-11, 0, 0),
      v3(1 + 1e-9, 2, 2 - 1e-9),
    );
    expect(planeKey(oblPert), 'plano oblicuo perturbado 1e-9 ⇒ misma clave').toBe(planeKey(obl));
    expect(planeKey(planeFlip(oblPert)), 'plano oblicuo perturbado y volteado ⇒ misma clave').toBe(planeKey(obl));

    // Y planos realmente distintos NO deben colisionar.
    expect(planeKey({ n: AXIS_Z, d: 2 })).not.toBe(planeKey({ n: AXIS_Z, d: 2.001 }));
    expect(planeKey({ n: AXIS_Z, d: 2 })).not.toBe(planeKey({ n: AXIS_Y, d: 2 }));
    expect(planeKey(planeFromPointNormal(ZERO3, v3(1, 0, 0.001))))
      .not.toBe(planeKey(planeFromPointNormal(ZERO3, AXIS_X)));
  });

  it('planeEquals distingue planos paralelos separados', () => {
    expect(planeEquals({ n: AXIS_Z, d: 2 }, { n: AXIS_Z, d: 2 + 1e-9 }, false), 'diferencia 1e-9 < PLANE_EPS').toBe(true);
    expect(planeEquals({ n: AXIS_Z, d: 2 }, { n: AXIS_Z, d: 2.001 }, false), 'diferencia 1e-3 ⇒ distintos').toBe(false);
  });
});

describe('plane.ts — base local to2D/to3D', () => {
  const planos: Plane[] = [
    { n: AXIS_Z, d: 0 },
    { n: AXIS_Z, d: 7 },
    { n: AXIS_X, d: -2 },
    planeFromPointNormal(v3(1, 2, 3), v3(1, 1, 1)),
    planeFromPointNormal(v3(-5, 0, 2), v3(0.3, -0.9, 4.2)),
  ];

  it('la base es ortonormal y dextrógira', () => {
    for (const pl of planos) {
      const b = planeBasis(pl);
      esUnitario(b.u, `u de ${txt(pl.n)}`, 1e-15);
      esUnitario(b.v, `v de ${txt(pl.n)}`, 1e-15);
      esUnitario(b.n, `n de ${txt(pl.n)}`, 1e-14);
      cerca(dot(b.u, b.v), 0, 1e-15, 'u ⟂ v');
      cerca(dot(b.u, b.n), 0, 1e-15, 'u ⟂ n');
      cerca(dot(b.v, b.n), 0, 1e-15, 'v ⟂ n');
      cercaV(cross(b.u, b.v), b.n, 1e-14, 'u × v == n (dextrógira)');
      cerca(planeDistance(pl, b.origin), 0, 1e-14, 'el origen de la base está en el plano');
    }
  });

  it('to2D y to3D son inversas la una de la otra', () => {
    const uvs: Vec2[] = [v2(0, 0), v2(1, 0), v2(0, 1), v2(-3.5, 12.25), v2(1e-6, -1e-6), v2(1e5, -1e5)];
    for (const pl of planos) {
      const b = planeBasis(pl);
      for (const uv of uvs) {
        const p = to3D(b, uv);
        cerca(planeDistance(pl, p), 0, 1e-9, `to3D(${uv.x},${uv.y}) debe caer en el plano`);
        cercaV2(to2D(b, p), uv, 1e-9, `to2D∘to3D en ${txt(pl.n)}`);
      }
      // Ida y vuelta desde 3D, para puntos que ya están en el plano.
      for (const uv of uvs) {
        const p = to3D(b, uv);
        cercaV(to3D(b, to2D(b, p)), p, 1e-9, `to3D∘to2D en ${txt(pl.n)}`);
      }
      // Para puntos fuera del plano, to3D∘to2D equivale a la proyección ortogonal.
      const fuera = add(to3D(b, v2(2, -3)), mul(pl.n, 9));
      cercaV(to3D(b, to2D(b, fuera)), planeProject(pl, fuera), 1e-12, 'to3D∘to2D == planeProject');
    }
  });

  it('to2D conserva distancias (isometría plano↔2D)', () => {
    const pl = planeFromPointNormal(v3(1, 2, 3), v3(1, 1, 1));
    const b = planeBasis(pl);
    const a3 = to3D(b, v2(-2, 5));
    const b3 = to3D(b, v2(7, -1));
    cerca(distance(a3, b3), distance2(v2(-2, 5), v2(7, -1)), 1e-12, 'las distancias se conservan');
  });
});

describe('plane.ts — intersecciones', () => {
  it('planePlaneIntersect de dos planos perpendiculares da la recta correcta', () => {
    const a: Plane = { n: AXIS_Z, d: 2 }; // z = 2
    const b: Plane = { n: AXIS_X, d: 3 }; // x = 3
    const r = planePlaneIntersect(a, b);
    expect(r, 'dos planos perpendiculares se cortan').not.toBeNull();

    esUnitario(r!.dir, 'dirección de la recta', 1e-15);
    cerca(dot(r!.dir, a.n), 0, 1e-15, 'la dirección es ⟂ a la normal del plano A');
    cerca(dot(r!.dir, b.n), 0, 1e-15, 'la dirección es ⟂ a la normal del plano B');
    expect(isParallel(r!.dir, AXIS_Y, 1e-12), 'la recta va a lo largo de Y').toBe(true);

    // El punto devuelto DEBE pertenecer a ambos planos (esto detectaba un signo invertido).
    cerca(planeDistance(a, r!.p), 0, 1e-12, 'el punto está en el plano z=2');
    cerca(planeDistance(b, r!.p), 0, 1e-12, 'el punto está en el plano x=3');
    cercaV(r!.p, v3(3, 0, 2), 1e-12, 'es además el punto de la recta más cercano al origen');

    // Y cualquier punto de la recta debe seguir en ambos planos.
    for (const t of [-100, -1, 0, 1, 100]) {
      const q = add(r!.p, mul(r!.dir, t));
      cerca(planeDistance(a, q), 0, 1e-11, `t=${t} sigue en A`);
      cerca(planeDistance(b, q), 0, 1e-11, `t=${t} sigue en B`);
    }
  });

  it('planePlaneIntersect en configuraciones oblicuas', () => {
    const casos: [Plane, Plane][] = [
      [planeFromPointNormal(v3(1, 0, 0), v3(1, 1, 0)), planeFromPointNormal(v3(0, 0, 4), v3(0, 1, 3))],
      [planeFromPointNormal(v3(-2, 5, 1), v3(2, -3, 6)), planeFromPointNormal(v3(0, 0, 0), v3(1, 4, -2))],
      [{ n: AXIS_X, d: -7 }, { n: AXIS_Y, d: 11 }],
    ];
    for (const [a, b] of casos) {
      const r = planePlaneIntersect(a, b);
      expect(r, `los planos ${txt(a.n)} y ${txt(b.n)} deben cortarse`).not.toBeNull();
      cerca(planeDistance(a, r!.p), 0, 1e-12, `punto en A (${txt(a.n)})`);
      cerca(planeDistance(b, r!.p), 0, 1e-12, `punto en B (${txt(b.n)})`);
      cerca(dot(r!.dir, a.n), 0, 1e-14, 'dir ⟂ n_A');
      cerca(dot(r!.dir, b.n), 0, 1e-14, 'dir ⟂ n_B');
      esUnitario(r!.dir, 'dir', 1e-14);
    }
  });

  it('planePlaneIntersect devuelve null para planos paralelos o coincidentes', () => {
    expect(planePlaneIntersect({ n: AXIS_Z, d: 0 }, { n: AXIS_Z, d: 5 }), 'paralelos separados').toBeNull();
    expect(planePlaneIntersect({ n: AXIS_Z, d: 0 }, { n: neg(AXIS_Z), d: 0 }), 'coincidentes opuestos').toBeNull();
    expect(planePlaneIntersect({ n: AXIS_Z, d: 1 }, { n: AXIS_Z, d: 1 }), 'idénticos').toBeNull();
    const casi = planeFromPointNormal(ZERO3, v3(1e-10, 0, 1));
    expect(planePlaneIntersect({ n: AXIS_Z, d: 0 }, casi), 'ángulo 1e-10 rad ⇒ paralelos').toBeNull();
  });

  it('linePlaneIntersect: paralelo ⇒ null, incluso si la recta está contenida', () => {
    const pl: Plane = { n: AXIS_Z, d: 2 };
    expect(linePlaneIntersect(pl, v3(0, 0, 5), AXIS_X), 'recta paralela fuera del plano').toBeNull();
    expect(linePlaneIntersect(pl, v3(0, 0, 2), AXIS_X), 'recta contenida en el plano también da null').toBeNull();
    expect(linePlaneIntersect(pl, ZERO3, v3(1, 1, 0)), 'dirección oblicua pero paralela al plano').toBeNull();

    const r = linePlaneIntersect(pl, v3(1, 1, 0), AXIS_Z);
    expect(r, 'recta perpendicular ⇒ corte').not.toBeNull();
    cerca(r!.t, 2, 1e-15, 'parámetro t');
    cercaV(r!.p, v3(1, 1, 2), 1e-15, 'punto de corte');

    // t puede ser negativo: es una RECTA, no un rayo.
    const atras = linePlaneIntersect(pl, v3(0, 0, 10), neg(AXIS_Z))!;
    cerca(atras.t, 8, 1e-15, 't hacia -Z');
    const detras = linePlaneIntersect(pl, v3(0, 0, 10), AXIS_Z)!;
    cerca(detras.t, -8, 1e-15, 't negativo (el plano queda detrás)');

    // Dirección no unitaria: t escala en consecuencia.
    const noUnit = linePlaneIntersect(pl, ZERO3, v3(0, 0, 4))!;
    cerca(noUnit.t, 0.5, 1e-15, 't con dirección de módulo 4');
    cercaV(noUnit.p, v3(0, 0, 2), 1e-15, 'punto correcto pese a la dirección no unitaria');
  });

  it('segmentPlaneIntersect: coplanar ⇒ null', () => {
    const pl: Plane = { n: AXIS_Z, d: 0 };
    expect(segmentPlaneIntersect(pl, v3(-1, 0, 0), v3(1, 0, 0)), 'segmento contenido en el plano').toBeNull();
    expect(
      segmentPlaneIntersect(pl, v3(-1, 0, 1e-9), v3(1, 0, -1e-9)),
      'segmento dentro de PLANE_EPS ⇒ coplanar ⇒ null',
    ).toBeNull();
  });

  it('segmentPlaneIntersect: mismo lado ⇒ null; cruce ⇒ punto correcto', () => {
    const pl: Plane = { n: AXIS_Z, d: 1 };
    expect(segmentPlaneIntersect(pl, v3(0, 0, 2), v3(1, 1, 5)), 'ambos por encima').toBeNull();
    expect(segmentPlaneIntersect(pl, v3(0, 0, -2), v3(1, 1, 0.5)), 'ambos por debajo').toBeNull();

    const p = segmentPlaneIntersect(pl, v3(0, 0, 0), v3(0, 0, 4));
    expect(p, 'el segmento cruza el plano').not.toBeNull();
    cercaV(p!, v3(0, 0, 1), 1e-15, 'punto de corte a 1/4 del segmento');

    const q = segmentPlaneIntersect(pl, v3(-2, -2, -3), v3(2, 2, 5));
    expect(q, 'segmento oblicuo cruza el plano').not.toBeNull();
    cercaV(q!, v3(0, 0, 1), 1e-14, 'corte oblicuo');
    cerca(planeDistance(pl, q!), 0, 1e-15, 'el corte está en el plano');

    // Un extremo justo sobre el plano: se devuelve ese extremo.
    const e = segmentPlaneIntersect(pl, v3(3, 4, 1), v3(3, 4, 6));
    expect(e, 'extremo sobre el plano ⇒ corte en el extremo').not.toBeNull();
    cercaV(e!, v3(3, 4, 1), 1e-15, 'el corte es el propio extremo');
  });
});

// ===========================================================================
// geom.ts — segmentos
// ===========================================================================

describe('geom.ts — closestPointsSegmentSegment', () => {
  it('caso cruzado: se cortan de verdad', () => {
    const r = closestPointsSegmentSegment(v3(0, 0, 0), v3(2, 0, 0), v3(1, -1, 0), v3(1, 1, 0));
    expect(r.parallel, 'no son paralelos').toBe(false);
    cerca(r.dist, 0, 1e-15, 'distancia mínima nula');
    cerca(r.s, 0.5, 1e-15, 'parámetro s');
    cerca(r.t, 0.5, 1e-15, 'parámetro t');
    cercaV(r.p1, v3(1, 0, 0), 1e-15, 'punto sobre el primer segmento');
    cercaV(r.p2, v3(1, 0, 0), 1e-15, 'punto sobre el segundo segmento');
  });

  it('caso cruzado alabeado (skew): la mínima distancia es la separación', () => {
    const r = closestPointsSegmentSegment(v3(0, 0, 0), v3(2, 0, 0), v3(1, -1, 0.5), v3(1, 1, 0.5));
    expect(r.parallel, 'no paralelos').toBe(false);
    cerca(r.dist, 0.5, 1e-15, 'distancia mínima');
    cercaV(r.p1, v3(1, 0, 0), 1e-15, 'pie sobre el primero');
    cercaV(r.p2, v3(1, 0, 0.5), 1e-15, 'pie sobre el segundo');
    cerca(dot(sub(r.p2, r.p1), sub(v3(2, 0, 0), v3(0, 0, 0))), 0, 1e-14, 'la perpendicular común es ⟂ al primero');
  });

  it('caso paralelo: solapado y disjunto', () => {
    const solap = closestPointsSegmentSegment(v3(0, 0, 0), v3(1, 0, 0), v3(0.25, 0, 0), v3(0.75, 0, 0));
    expect(solap.parallel, 'colineales ⇒ marcados como paralelos').toBe(true);
    cerca(solap.dist, 0, 1e-15, 'colineales solapados ⇒ distancia 0');

    const desp = closestPointsSegmentSegment(v3(0, 0, 0), v3(1, 0, 0), v3(0.25, 3, 0), v3(0.75, 3, 0));
    expect(desp.parallel, 'paralelos separados').toBe(true);
    cerca(desp.dist, 3, 1e-15, 'la distancia es la separación entre rectas');

    const disj = closestPointsSegmentSegment(v3(0, 0, 0), v3(1, 0, 0), v3(2, 0, 1), v3(3, 0, 1));
    expect(disj.parallel, 'paralelos y sin solape').toBe(true);
    cerca(disj.dist, Math.SQRT2, 1e-15, 'distancia entre los extremos más próximos');
    cercaV(disj.p1, v3(1, 0, 0), 1e-15, 'extremo del primero');
    cercaV(disj.p2, v3(2, 0, 1), 1e-15, 'extremo del segundo');

    const anti = closestPointsSegmentSegment(v3(0, 0, 0), v3(1, 0, 0), v3(1, 0, 0), v3(0, 0, 0));
    expect(anti.parallel, 'antiparalelos también son paralelos').toBe(true);
    cerca(anti.dist, 0, 1e-15, 'segmentos idénticos invertidos');
  });

  it('caso disjunto no paralelo: el mínimo está en los extremos', () => {
    const r = closestPointsSegmentSegment(v3(0, 0, 0), v3(1, 0, 0), v3(5, 5, 0), v3(5, 6, 0));
    expect(r.parallel, 'no son paralelos').toBe(false);
    cercaV(r.p1, v3(1, 0, 0), 1e-14, 'extremo del primero');
    cercaV(r.p2, v3(5, 5, 0), 1e-14, 'extremo del segundo');
    cerca(r.dist, Math.hypot(4, 5), 1e-14, 'distancia esquina-esquina');
    cerca(r.s, 1, 1e-14, 's recortado a 1');
    cerca(r.t, 0, 1e-14, 't recortado a 0');
  });

  it('casos degenerados: segmentos de longitud cero', () => {
    const pp = closestPointsSegmentSegment(v3(1, 2, 3), v3(1, 2, 3), v3(0, 0, 0), v3(0, 0, 0));
    cerca(pp.s, 0, 0, 's = 0');
    cerca(pp.t, 0, 0, 't = 0');
    cerca(pp.dist, Math.sqrt(14), 1e-14, 'distancia punto-punto');
    cercaV(pp.p1, v3(1, 2, 3), 0, 'p1 es el propio punto');
    cercaV(pp.p2, ZERO3, 0, 'p2 es el propio punto');

    // Punto vs segmento (el punto se proyecta dentro).
    const ps = closestPointsSegmentSegment(v3(0, 0, 0), v3(2, 0, 0), v3(1, 1, 0), v3(1, 1, 0));
    cerca(ps.dist, 1, 1e-15, 'distancia punto-segmento');
    cerca(ps.s, 0.5, 1e-15, 'proyección en el centro');
    cercaV(ps.p1, v3(1, 0, 0), 1e-15, 'pie de la perpendicular');

    // Segmento vs punto (orden invertido), con el punto fuera del rango.
    const sp = closestPointsSegmentSegment(v3(5, 5, 0), v3(5, 5, 0), v3(0, 0, 0), v3(2, 0, 0));
    cerca(sp.s, 0, 0, 's = 0 en el degenerado');
    cerca(sp.t, 1, 1e-15, 't recortado al extremo');
    cerca(sp.dist, Math.hypot(3, 5), 1e-14, 'distancia al extremo más cercano');

    // Ambos degenerados y coincidentes.
    const igual = closestPointsSegmentSegment(v3(4, 4, 4), v3(4, 4, 4), v3(4, 4, 4), v3(4, 4, 4));
    cerca(igual.dist, 0, 0, 'puntos coincidentes');
  });

  it('es simétrico al intercambiar los segmentos', () => {
    const a1 = v3(0, 0, 0);
    const b1 = v3(3, 1, -2);
    const a2 = v3(-1, 4, 1);
    const b2 = v3(2, 2, 5);
    const r1 = closestPointsSegmentSegment(a1, b1, a2, b2);
    const r2 = closestPointsSegmentSegment(a2, b2, a1, b1);
    cerca(r1.dist, r2.dist, 1e-13, 'la distancia mínima no depende del orden');
    cercaV(r1.p1, r2.p2, 1e-12, 'los pies se intercambian');
    cercaV(r1.p2, r2.p1, 1e-12, 'los pies se intercambian (2)');
  });
});

describe('geom.ts — segmentSegmentIntersection', () => {
  it('dos segmentos que se cruzan realmente en 3D', () => {
    // A: (0,0,0)→(1,1,1) ; B: (1,0,0)→(0,1,1). Se cortan en (0.5, 0.5, 0.5).
    const r = segmentSegmentIntersection(v3(0, 0, 0), v3(1, 1, 1), v3(1, 0, 0), v3(0, 1, 1));
    expect(r, 'los segmentos se cortan').not.toBeNull();
    cercaV(r!.point, v3(0.5, 0.5, 0.5), 1e-14, 'punto de corte');
    cerca(r!.s, 0.5, 1e-14, 'parámetro sobre A');
    cerca(r!.t, 0.5, 1e-14, 'parámetro sobre B');

    // Cruce en un punto no central.
    const r2 = segmentSegmentIntersection(v3(0, 0, 0), v3(4, 0, 0), v3(1, -2, 0), v3(1, 6, 0));
    expect(r2, 'cruce en T').not.toBeNull();
    cercaV(r2!.point, v3(1, 0, 0), 1e-14, 'punto de corte en x=1');
    cerca(r2!.s, 0.25, 1e-14, 's = 1/4');
    cerca(r2!.t, 0.25, 1e-14, 't = 1/4');
  });

  it('cruce "casi": a 1e-9 sí, a 1e-3 no (tolerancia por defecto EPS = 1e-6)', () => {
    const casi = segmentSegmentIntersection(v3(0, 0, 0), v3(2, 0, 0), v3(1, -1, 1e-9), v3(1, 1, 1e-9));
    expect(casi, 'separación de 1e-9 está dentro de EPS ⇒ hay intersección').not.toBeNull();
    cercaV(casi!.point, v3(1, 0, 5e-10), 1e-12, 'el punto es el medio de la perpendicular común');

    const lejos = segmentSegmentIntersection(v3(0, 0, 0), v3(2, 0, 0), v3(1, -1, 1e-3), v3(1, 1, 1e-3));
    expect(lejos, 'separación de 1e-3 excede EPS ⇒ null').toBeNull();

    // Justo en el umbral: 1e-6 pasa (dist <= eps), 2e-6 no.
    expect(
      segmentSegmentIntersection(v3(0, 0, 0), v3(2, 0, 0), v3(1, -1, 1e-6), v3(1, 1, 1e-6)),
      'separación exactamente EPS ⇒ intersección',
    ).not.toBeNull();
    expect(
      segmentSegmentIntersection(v3(0, 0, 0), v3(2, 0, 0), v3(1, -1, 2e-6), v3(1, 1, 2e-6)),
      'separación 2·EPS ⇒ null',
    ).toBeNull();

    // Con eps explícito el criterio se mueve.
    expect(
      segmentSegmentIntersection(v3(0, 0, 0), v3(2, 0, 0), v3(1, -1, 1e-3), v3(1, 1, 1e-3), 1e-2),
      'con eps=1e-2 la separación de 1e-3 sí cuenta',
    ).not.toBeNull();
  });

  it('no devuelve nada para segmentos paralelos ni para cruces fuera del rango', () => {
    expect(
      segmentSegmentIntersection(v3(0, 0, 0), v3(1, 0, 0), v3(0.25, 0, 0), v3(0.75, 0, 0)),
      'solape colineal ⇒ null (lo trata el partidor de aristas)',
    ).toBeNull();
    expect(
      segmentSegmentIntersection(v3(0, 0, 0), v3(1, 0, 0), v3(0, 1, 0), v3(1, 1, 0)),
      'paralelos separados ⇒ null',
    ).toBeNull();
    expect(
      segmentSegmentIntersection(v3(0, 0, 0), v3(1, 0, 0), v3(5, -1, 0), v3(5, 1, 0)),
      'las rectas se cortan en x=5, fuera del primer segmento ⇒ null',
    ).toBeNull();
  });

  it('detecta el contacto en un extremo (unión en T)', () => {
    const r = segmentSegmentIntersection(v3(0, 0, 0), v3(2, 0, 0), v3(2, 0, 0), v3(2, 3, 0));
    expect(r, 'los extremos coinciden').not.toBeNull();
    cercaV(r!.point, v3(2, 0, 0), 1e-14, 'punto de contacto');
    cerca(r!.s, 1, 1e-14, 's = 1');
    cerca(r!.t, 0, 1e-14, 't = 0');
  });
});

describe('geom.ts — pointStrictlyInsideSegment', () => {
  const a = v3(0, 0, 0);
  const b = v3(10, 0, 0);

  it('acepta los puntos interiores', () => {
    expect(pointStrictlyInsideSegment(a, b, v3(5, 0, 0)), 'punto medio').toBe(true);
    expect(pointStrictlyInsideSegment(a, b, v3(0.001, 0, 0)), 'muy cerca de A pero fuera de EPS').toBe(true);
    expect(pointStrictlyInsideSegment(a, b, v3(9.999, 0, 0)), 'muy cerca de B pero fuera de EPS').toBe(true);
    expect(pointStrictlyInsideSegment(a, b, v3(5, 1e-9, 0)), 'desviado 1e-9 (dentro de EPS)').toBe(true);
  });

  it('excluye los extremos', () => {
    expect(pointStrictlyInsideSegment(a, b, a), 'extremo A exacto').toBe(false);
    expect(pointStrictlyInsideSegment(a, b, b), 'extremo B exacto').toBe(false);
    expect(pointStrictlyInsideSegment(a, b, v3(1e-9, 0, 0)), 'a 1e-9 de A ⇒ es A').toBe(false);
    expect(pointStrictlyInsideSegment(a, b, v3(10 - 1e-9, 0, 0)), 'a 1e-9 de B ⇒ es B').toBe(false);
    expect(pointStrictlyInsideSegment(a, b, v3(0, 1e-9, 0)), 'a 1e-9 de A en perpendicular ⇒ es A').toBe(false);
  });

  it('rechaza puntos fuera del segmento o fuera de la recta', () => {
    expect(pointStrictlyInsideSegment(a, b, v3(-1, 0, 0)), 'antes de A').toBe(false);
    expect(pointStrictlyInsideSegment(a, b, v3(11, 0, 0)), 'después de B').toBe(false);
    expect(pointStrictlyInsideSegment(a, b, v3(5, 0.001, 0)), 'a 1 mm de la recta ⇒ fuera').toBe(false);
    expect(pointStrictlyInsideSegment(a, b, v3(5, 0, 1e-5)), 'a 10 µm de la recta ⇒ fuera').toBe(false);
    expect(pointStrictlyInsideSegment(a, a, v3(0, 0, 0)), 'segmento degenerado ⇒ false').toBe(false);
  });

  it('funciona en un segmento oblicuo', () => {
    const p = v3(0, 0, 0);
    const q = v3(3, 4, 12); // longitud 13
    expect(pointStrictlyInsideSegment(p, q, mul(q, 0.5)), 'punto medio oblicuo').toBe(true);
    expect(pointStrictlyInsideSegment(p, q, mul(q, 1.0)), 'extremo').toBe(false);
    expect(pointStrictlyInsideSegment(p, q, mul(q, 1.5)), 'prolongación').toBe(false);
    expect(pointStrictlyInsideSegment(p, q, add(mul(q, 0.5), v3(0, 0, 1e-4))), 'desviado 1e-4').toBe(false);
  });
});

// ===========================================================================
// geom.ts — polígonos 2D
// ===========================================================================

/** Polígono en L (área 7): franja horizontal de 4×1 más franja vertical de 1×3. */
const L: Vec2[] = [v2(0, 0), v2(4, 0), v2(4, 1), v2(1, 1), v2(1, 4), v2(0, 4)];
/** Polígono en U (área 12). */
const U: Vec2[] = [v2(0, 0), v2(4, 0), v2(4, 5), v2(3, 5), v2(3, 1), v2(1, 1), v2(1, 5), v2(0, 5)];

describe('geom.ts — signedArea2', () => {
  it('el signo sigue el sentido de recorrido', () => {
    const ccw: Vec2[] = [v2(0, 0), v2(2, 0), v2(2, 3), v2(0, 3)];
    cerca(signedArea2(ccw), 6, 1e-14, 'rectángulo antihorario ⇒ +6');
    cerca(signedArea2([...ccw].reverse()), -6, 1e-14, 'rectángulo horario ⇒ -6');
    cerca(signedArea2([v2(0, 0), v2(1, 0), v2(0, 1)]), 0.5, 1e-15, 'triángulo antihorario');
    cerca(signedArea2([v2(0, 0), v2(0, 1), v2(1, 0)]), -0.5, 1e-15, 'triángulo horario');
  });

  it('polígonos cóncavos y degenerados', () => {
    cerca(signedArea2(L), 7, 1e-14, 'área de la L');
    cerca(signedArea2([...L].reverse()), -7, 1e-14, 'L recorrida al revés');
    cerca(signedArea2(U), 12, 1e-14, 'área de la U');
    cerca(signedArea2([v2(0, 0), v2(1, 0), v2(2, 0)]), 0, 1e-15, 'polígono colineal ⇒ 0');
    cerca(signedArea2([v2(0, 0), v2(1, 1)]), 0, 1e-15, 'dos vértices ⇒ 0');
    cerca(signedArea2([]), 0, 0, 'vacío ⇒ 0');
    // Invariante bajo traslación.
    const desp = L.map((p) => v2(p.x + 1000, p.y - 500));
    cerca(signedArea2(desp), 7, 1e-9, 'el área no cambia al trasladar 1000 unidades');
  });
});

describe('geom.ts — pointInPolygon2 sobre un polígono en L', () => {
  it('detecta los puntos interiores', () => {
    const dentro: Vec2[] = [v2(0.5, 0.5), v2(3.5, 0.5), v2(0.5, 3.5), v2(0.9, 0.9), v2(2, 0.25)];
    for (const p of dentro) {
      expect(pointInPolygon2(L, p), `(${p.x}, ${p.y}) debería estar DENTRO de la L`).toBe(true);
    }
  });

  it('detecta los puntos exteriores', () => {
    const fuera: Vec2[] = [v2(-1, -1), v2(5, 0.5), v2(0.5, 5), v2(4.5, 4.5), v2(2, -0.5)];
    for (const p of fuera) {
      expect(pointInPolygon2(L, p), `(${p.x}, ${p.y}) debería estar FUERA de la L`).toBe(false);
    }
  });

  it('la muesca (esquina que falta) queda fuera', () => {
    const muesca: Vec2[] = [v2(2, 2), v2(3, 3), v2(1.5, 1.5), v2(3.9, 1.1), v2(1.1, 3.9), v2(2.5, 2.5)];
    for (const p of muesca) {
      expect(pointInPolygon2(L, p), `(${p.x}, ${p.y}) está en la muesca ⇒ FUERA`).toBe(false);
    }
  });

  it('el resultado no depende del sentido de recorrido', () => {
    const Lrev = [...L].reverse();
    for (const p of [v2(0.5, 0.5), v2(3.5, 0.5), v2(2, 2), v2(-1, -1), v2(0.5, 3.5)]) {
      expect(
        pointInPolygon2(Lrev, p),
        `(${p.x}, ${p.y}): el sentido de recorrido no debe cambiar el resultado`,
      ).toBe(pointInPolygon2(L, p));
    }
  });

  it('también funciona en la U (dos brazos separados por el hueco)', () => {
    expect(pointInPolygon2(U, v2(0.5, 4)), 'brazo izquierdo').toBe(true);
    expect(pointInPolygon2(U, v2(3.5, 4)), 'brazo derecho').toBe(true);
    expect(pointInPolygon2(U, v2(2, 0.5)), 'base de la U').toBe(true);
    expect(pointInPolygon2(U, v2(2, 3)), 'hueco entre los brazos ⇒ fuera').toBe(false);
    expect(pointInPolygon2(U, v2(2, 6)), 'por encima ⇒ fuera').toBe(false);
  });
});

describe('geom.ts — interiorPoint2', () => {
  /** Comprueba que el punto devuelto es realmente interior (y no roza el borde). */
  function esInterior(poly: readonly Vec2[], nombre: string, margen = 1e-9): Vec2 {
    const p = interiorPoint2(poly);
    expect(p, `${nombre}: debe encontrarse un punto interior`).not.toBeNull();
    expect(pointInPolygon2(poly, p!), `${nombre}: (${p!.x}, ${p!.y}) debe estar dentro`).toBe(true);
    expect(
      pointOnPolygonBoundary2(poly, p!, margen),
      `${nombre}: (${p!.x}, ${p!.y}) no debe caer sobre el borde`,
    ).toBe(false);
    return p!;
  }

  it('polígono convexo: sirve el centroide', () => {
    const cuadrado: Vec2[] = [v2(0, 0), v2(2, 0), v2(2, 2), v2(0, 2)];
    cercaV2(esInterior(cuadrado, 'cuadrado'), v2(1, 1), 1e-12, 'centroide del cuadrado');
  });

  it('polígono en L (cóncavo), en ambos sentidos', () => {
    esInterior(L, 'L antihoraria');
    esInterior([...L].reverse(), 'L horaria');
  });

  it('polígono en U (el centroide puede caer en el hueco), en ambos sentidos', () => {
    esInterior(U, 'U antihoraria');
    esInterior([...U].reverse(), 'U horaria');
    // Una U más profunda, con el centroide claramente dentro del hueco.
    const Uprof: Vec2[] = [
      v2(0, 0), v2(10, 0), v2(10, 20), v2(9, 20), v2(9, 1), v2(1, 1), v2(1, 20), v2(0, 20),
    ];
    esInterior(Uprof, 'U profunda');
    esInterior([...Uprof].reverse(), 'U profunda horaria');
  });

  it('polígono muy alargado (relación de aspecto 1e6)', () => {
    const finoX: Vec2[] = [v2(0, 0), v2(1000, 0), v2(1000, 0.001), v2(0, 0.001)];
    const p = esInterior(finoX, 'rectángulo 1000 × 0.001', 1e-12);
    expect(p.y > 0 && p.y < 0.001, `y=${p.y} debe estar dentro de la banda`).toBe(true);

    const finoY: Vec2[] = [v2(0, 0), v2(0.001, 0), v2(0.001, 1000), v2(0, 1000)];
    esInterior(finoY, 'rectángulo 0.001 × 1000', 1e-12);

    // Alargado Y cóncavo a la vez: aquí el centroide cae fuera.
    const Lfina: Vec2[] = [
      v2(0, 0), v2(100, 0), v2(100, 0.01), v2(0.01, 0.01), v2(0.01, 100), v2(0, 100),
    ];
    esInterior(Lfina, 'L muy fina', 1e-12);
    esInterior([...Lfina].reverse(), 'L muy fina horaria', 1e-12);

    // Muy alargado y oblicuo (no alineado con los ejes).
    const obl: Vec2[] = [v2(0, 0), v2(700, 700), v2(700 - 0.0007, 700 + 0.0007), v2(-0.0007, 0.0007)];
    esInterior(obl, 'banda diagonal muy fina', 1e-12);
  });

  it('devuelve null con menos de 3 vértices', () => {
    expect(interiorPoint2([]), 'polígono vacío').toBeNull();
    expect(interiorPoint2([v2(0, 0)]), 'un vértice').toBeNull();
    expect(interiorPoint2([v2(0, 0), v2(1, 1)]), 'dos vértices').toBeNull();
  });
});

// ===========================================================================
// geom.ts — rayos y círculos
// ===========================================================================

describe('geom.ts — rayTriangle', () => {
  const a = v3(0, 0, 0);
  const b = v3(1, 0, 0);
  const c = v3(0, 1, 0); // normal +Z

  it('acierta el interior del triángulo', () => {
    const t = rayTriangle(ray(v3(0.25, 0.25, 1), v3(0, 0, -1)), a, b, c);
    expect(t, 'el rayo debe atravesar el triángulo').not.toBeNull();
    cerca(t!, 1, 1e-12, 'distancia hasta el plano z=0');

    const t2 = rayTriangle(ray(v3(0.1, 0.1, 5), v3(0, 0, -1)), a, b, c);
    cerca(t2!, 5, 1e-12, 'origen más lejano');

    // Rayo oblicuo.
    const t3 = rayTriangle(ray(v3(0.25, 0.25, 2), v3(0, 0, -2)), a, b, c);
    cerca(t3!, 2, 1e-12, 't se mide con la dirección normalizada');
  });

  it('falla fuera del triángulo y por detrás del origen', () => {
    expect(rayTriangle(ray(v3(2, 2, 1), v3(0, 0, -1)), a, b, c), 'fuera del triángulo').toBeNull();
    expect(rayTriangle(ray(v3(0.6, 0.6, 1), v3(0, 0, -1)), a, b, c), 'fuera de la hipotenusa (u+v>1)').toBeNull();
    expect(rayTriangle(ray(v3(-0.1, 0.5, 1), v3(0, 0, -1)), a, b, c), 'u negativo').toBeNull();
    expect(rayTriangle(ray(v3(0.5, -0.1, 1), v3(0, 0, -1)), a, b, c), 'v negativo').toBeNull();
    expect(rayTriangle(ray(v3(0.25, 0.25, -1), v3(0, 0, -1)), a, b, c), 'el triángulo queda detrás').toBeNull();
    expect(rayTriangle(ray(v3(0.25, 0.25, 0), v3(0, 0, -1)), a, b, c), 'origen sobre el plano ⇒ t≈0 ⇒ null').toBeNull();
  });

  it('el rayo PARALELO al triángulo devuelve null', () => {
    expect(rayTriangle(ray(v3(0.25, 0.25, 1), AXIS_X), a, b, c), 'paralelo por encima').toBeNull();
    expect(rayTriangle(ray(v3(-1, 0.25, 0), AXIS_X), a, b, c), 'paralelo Y COPLANAR').toBeNull();
    expect(rayTriangle(ray(v3(-1, -1, 1), v3(1, 1, 0)), a, b, c), 'paralelo oblicuo').toBeNull();
  });

  it('cull descarta la cara trasera', () => {
    const desdeAbajo = ray(v3(0.25, 0.25, -1), v3(0, 0, 1));
    cerca(rayTriangle(desdeAbajo, a, b, c, false)!, 1, 1e-12, 'sin cull la cara trasera se ve');
    expect(rayTriangle(desdeAbajo, a, b, c, true), 'con cull la cara trasera se descarta').toBeNull();

    const desdeArriba = ray(v3(0.25, 0.25, 1), v3(0, 0, -1));
    cerca(rayTriangle(desdeArriba, a, b, c, true)!, 1, 1e-12, 'la cara frontal pasa el cull');
  });

  it('los bordes y vértices se aceptan (tolerancia 1e-9 en coordenadas baricéntricas)', () => {
    cerca(rayTriangle(ray(v3(0.5, 0, 1), v3(0, 0, -1)), a, b, c)!, 1, 1e-12, 'punto medio de la arista AB');
    cerca(rayTriangle(ray(v3(0.5, 0.5, 1), v3(0, 0, -1)), a, b, c)!, 1, 1e-12, 'punto medio de la hipotenusa');
    cerca(rayTriangle(ray(v3(0, 0, 1), v3(0, 0, -1)), a, b, c)!, 1, 1e-12, 'vértice A');
    expect(rayTriangle(ray(v3(0.5, 0.5 + 1e-3, 1), v3(0, 0, -1)), a, b, c), 'a 1e-3 fuera de la hipotenusa').toBeNull();
  });

  it('funciona con un triángulo oblicuo y lejos del origen', () => {
    const p = v3(10, 10, 10);
    const q = v3(12, 10, 11);
    const s = v3(10, 13, 12);
    const centro = mul(add(add(p, q), s), 1 / 3);
    const n = normalize(cross(sub(q, p), sub(s, p)));
    const r = ray(add(centro, mul(n, 4)), neg(n));
    const t = rayTriangle(r, p, q, s);
    expect(t, 'el rayo lanzado desde la normal debe acertar').not.toBeNull();
    cerca(t!, 4, 1e-12, 'la distancia es la altura de lanzamiento');
    // Desplazado lateralmente lo suficiente, falla.
    const fuera = ray(add(add(centro, mul(n, 4)), mul(normalize(sub(q, p)), 50)), neg(n));
    expect(rayTriangle(fuera, p, q, s), 'desplazado 50 unidades ⇒ falla').toBeNull();
  });
});

describe('geom.ts — circleFrom3Points2', () => {
  it('colineales ⇒ null', () => {
    expect(circleFrom3Points2(v2(0, 0), v2(1, 1), v2(2, 2)), 'colineales en diagonal').toBeNull();
    expect(circleFrom3Points2(v2(-5, 3), v2(0, 3), v2(7, 3)), 'colineales horizontales').toBeNull();
    expect(circleFrom3Points2(v2(2, -1), v2(2, 0), v2(2, 100)), 'colineales verticales').toBeNull();
    expect(circleFrom3Points2(v2(1, 1), v2(1, 1), v2(3, 3)), 'dos puntos coincidentes').toBeNull();
    expect(circleFrom3Points2(v2(0, 0), v2(0, 0), v2(0, 0)), 'tres coincidentes').toBeNull();
  });

  it('recupera el círculo unidad y otros círculos conocidos', () => {
    const c1 = circleFrom3Points2(v2(1, 0), v2(0, 1), v2(-1, 0));
    expect(c1, 'tres puntos del círculo unidad').not.toBeNull();
    cercaV2(c1!.center, v2(0, 0), 1e-14, 'centro en el origen');
    cerca(c1!.radius, 1, 1e-14, 'radio 1');

    const c2 = circleFrom3Points2(v2(13, 4), v2(3, 14), v2(3, -6));
    expect(c2, 'círculo de radio 10 centrado en (3,4)').not.toBeNull();
    cercaV2(c2!.center, v2(3, 4), 1e-12, 'centro (3,4)');
    cerca(c2!.radius, 10, 1e-12, 'radio 10');

    // Verificación genérica: los tres puntos equidistan del centro.
    const pts: [Vec2, Vec2, Vec2] = [v2(-2.5, 7), v2(11, -3), v2(4, 9.25)];
    const c3 = circleFrom3Points2(...pts)!;
    expect(c3, 'tres puntos genéricos definen un círculo').not.toBeNull();
    for (const p of pts) {
      cerca(distance2(c3.center, p), c3.radius, 1e-11, `(${p.x}, ${p.y}) debe estar sobre el círculo`);
    }
  });

  it('casi colineales ⇒ círculo enorme, no null', () => {
    const c = circleFrom3Points2(v2(0, 0), v2(1, 0), v2(2, 1e-9));
    expect(c, 'a 1e-9 de la colinealidad todavía hay solución').not.toBeNull();
    expect(c!.radius, `el radio (${c!.radius}) debe ser enorme`).toBeGreaterThan(1e7);
    // El determinante 2e-9 sigue muy por encima de 1e-18.
    const cc = circleFrom3Points2(v2(0, 0), v2(1, 0), v2(2, 1e-19));
    expect(cc, 'a 1e-19 el determinante cae bajo 1e-18 ⇒ null').toBeNull();
  });
});

describe('geom.ts — ángulos', () => {
  const TAU = Math.PI * 2;

  it('normalizeAngle cierra siempre a [0, 2π)', () => {
    cerca(normalizeAngle(0), 0, 0, '0');
    cerca(normalizeAngle(Math.PI), Math.PI, 1e-15, 'π');
    cerca(normalizeAngle(-Math.PI / 2), (3 * Math.PI) / 2, 1e-15, '-π/2 ⇒ 3π/2');
    cerca(normalizeAngle(TAU), 0, 1e-15, '2π ⇒ 0');
    cerca(normalizeAngle(-TAU), 0, 1e-15, '-2π ⇒ 0');
    cerca(normalizeAngle(5 * Math.PI), Math.PI, 1e-14, '5π ⇒ π');
    cerca(normalizeAngle(-0.5), TAU - 0.5, 1e-15, '-0.5 ⇒ 2π-0.5');
    cerca(normalizeAngle(TAU * 1000 + 1), 1, 1e-11, 'mil vueltas + 1');

    for (const a of [-100, -7.3, -TAU, -1e-9, 0, 1e-9, 3.2, 7.5, 1000]) {
      const r = normalizeAngle(a);
      expect(r >= 0, `normalizeAngle(${a}) = ${r} debe ser >= 0`).toBe(true);
      expect(r < TAU, `normalizeAngle(${a}) = ${r} debe ser < 2π`).toBe(true);
    }
  });

  it('angleDelta devuelve la diferencia mínima en (-π, π]', () => {
    cerca(angleDelta(0.1, 0.2), 0.1, 1e-15, 'avance pequeño');
    cerca(angleDelta(0.2, 0.1), -0.1, 1e-15, 'retroceso pequeño');
    cerca(angleDelta(0.1, -0.1), -0.2, 1e-15, 'cruce por cero');
    cerca(angleDelta(3.0, -3.0), TAU - 6.0, 1e-14, 'atajo por el otro lado de ±π');
    cerca(angleDelta(-3.0, 3.0), 6.0 - TAU, 1e-14, 'atajo simétrico');
    cerca(angleDelta(0, Math.PI), Math.PI, 1e-15, '+π se mantiene (intervalo semiabierto por la derecha)');
    cerca(angleDelta(0, -Math.PI), Math.PI, 1e-15, '-π se normaliza a +π');
    cerca(angleDelta(0, TAU), 0, 1e-15, 'vuelta completa ⇒ 0');
    cerca(angleDelta(1, 1 + TAU * 3), 0, 1e-14, 'tres vueltas ⇒ 0');

    for (const [f, t] of [[0, 1], [5, -5], [-2.9, 2.9], [10, -10], [0.5, 0.5]] as const) {
      const d = angleDelta(f, t);
      expect(d > -Math.PI - 1e-15, `angleDelta(${f}, ${t}) = ${d} debe ser > -π`).toBe(true);
      expect(d <= Math.PI + 1e-15, `angleDelta(${f}, ${t}) = ${d} debe ser <= π`).toBe(true);
      cerca(normalizeAngle(f + d), normalizeAngle(t), 1e-12, `f + delta debe llevar a t (${f} → ${t})`);
    }
  });

  it('angleDelta es coherente con signedAngle en el plano XY', () => {
    for (const [f, t] of [[0.3, 1.7], [2.9, -2.9], [-1, 1]] as const) {
      const a = v3(Math.cos(f), Math.sin(f), 0);
      const b = v3(Math.cos(t), Math.sin(t), 0);
      cerca(signedAngle(a, b, AXIS_Z), angleDelta(f, t), 1e-12, `coherencia para ${f} → ${t}`);
    }
  });
});
