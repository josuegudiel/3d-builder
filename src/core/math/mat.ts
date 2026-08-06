import { Vec3, v3, normalize, cross, dot, sub, length } from './vec';
import { EPS } from './tolerance';

/**
 * Matriz 4x4 en orden COLUMN-MAJOR, igual que three.js y OpenGL.
 *
 *   m[0] m[4] m[8]  m[12]
 *   m[1] m[5] m[9]  m[13]
 *   m[2] m[6] m[10] m[14]
 *   m[3] m[7] m[11] m[15]
 *
 * Las columnas 0..2 son los ejes X, Y, Z del sistema local; la columna 3 es la
 * traslación. Esto permite pasar el array directamente a `Matrix4.fromArray`.
 */
export type Mat4 = readonly number[];

export const IDENTITY: Mat4 = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

export function isIdentity(m: Mat4): boolean {
  for (let i = 0; i < 16; i++) {
    if (Math.abs(m[i] - IDENTITY[i]) > 1e-12) return false;
  }
  return true;
}

export function matTranslation(t: Vec3): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t.x, t.y, t.z, 1];
}

export function matScale(s: Vec3, origin?: Vec3): Mat4 {
  const m: Mat4 = [s.x, 0, 0, 0, 0, s.y, 0, 0, 0, 0, s.z, 0, 0, 0, 0, 1];
  if (!origin) return m;
  return matMul(matTranslation(origin), matMul(m, matTranslation({ x: -origin.x, y: -origin.y, z: -origin.z })));
}

/** Rotación alrededor de un eje arbitrario que pasa por `origin`. */
export function matRotation(axis: Vec3, angle: number, origin?: Vec3): Mat4 {
  const a = normalize(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const { x, y, z } = a;
  const r: Mat4 = [
    t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
    t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
    t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
    0, 0, 0, 1,
  ];
  if (!origin) return r;
  return matMul(matTranslation(origin), matMul(r, matTranslation({ x: -origin.x, y: -origin.y, z: -origin.z })));
}

/**
 * Construye una matriz a partir de un sistema de coordenadas local.
 * Los ejes NO se ortonormalizan: se usan tal cual (permite escalados y sesgos
 * controlados, igual que las transformaciones de SketchUp).
 */
export function matFromAxes(xAxis: Vec3, yAxis: Vec3, zAxis: Vec3, origin: Vec3): Mat4 {
  return [
    xAxis.x, xAxis.y, xAxis.z, 0,
    yAxis.x, yAxis.y, yAxis.z, 0,
    zAxis.x, zAxis.y, zAxis.z, 0,
    origin.x, origin.y, origin.z, 1,
  ];
}

/** Multiplicación a·b (aplica primero `b`, después `a`). */
export function matMul(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4];
    const b1 = b[c * 4 + 1];
    const b2 = b[c * 4 + 2];
    const b3 = b[c * 4 + 3];
    out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

/** Transforma un punto (aplica la traslación). */
export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const x = m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12];
  const y = m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13];
  const z = m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14];
  const w = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
  if (w !== 1 && Math.abs(w) > 1e-12) {
    return v3(x / w, y / w, z / w);
  }
  return v3(x, y, z);
}

/** Transforma una dirección (ignora la traslación). */
export function transformVector(m: Mat4, v: Vec3): Vec3 {
  return v3(
    m[0] * v.x + m[4] * v.y + m[8] * v.z,
    m[1] * v.x + m[5] * v.y + m[9] * v.z,
    m[2] * v.x + m[6] * v.y + m[10] * v.z,
  );
}

/**
 * Transforma una normal con la traspuesta de la inversa; es la única forma
 * correcta cuando hay escalados no uniformes.
 */
export function transformNormal(m: Mat4, n: Vec3): Vec3 {
  const inv = matInvert(m);
  if (!inv) return transformVector(m, n);
  // Traspuesta de la inversa aplicada a n.
  return normalize(
    v3(
      inv[0] * n.x + inv[1] * n.y + inv[2] * n.z,
      inv[4] * n.x + inv[5] * n.y + inv[6] * n.z,
      inv[8] * n.x + inv[9] * n.y + inv[10] * n.z,
    ),
  );
}

export function matDeterminant(m: Mat4): number {
  const [
    m00, m10, m20, m30,
    m01, m11, m21, m31,
    m02, m12, m22, m32,
    m03, m13, m23, m33,
  ] = m as number[];

  return (
    m30 * (
      m03 * m12 * m21 - m02 * m13 * m21 - m03 * m11 * m22 +
      m01 * m13 * m22 + m02 * m11 * m23 - m01 * m12 * m23
    ) +
    m31 * (
      m00 * m12 * m23 - m00 * m13 * m22 + m03 * m10 * m22 -
      m02 * m10 * m23 + m02 * m13 * m20 - m03 * m12 * m20
    ) +
    m32 * (
      m00 * m13 * m21 - m00 * m11 * m23 - m03 * m10 * m21 +
      m01 * m10 * m23 + m03 * m11 * m20 - m01 * m13 * m20
    ) +
    m33 * (
      -m02 * m11 * m20 - m00 * m12 * m21 + m00 * m11 * m22 +
      m02 * m10 * m21 - m01 * m10 * m22 + m01 * m12 * m20
    )
  );
}

/** Inversa general 4x4. Devuelve null si la matriz es singular. */
export function matInvert(m: Mat4): Mat4 | null {
  const te = new Array<number>(16);
  const n11 = m[0], n21 = m[1], n31 = m[2], n41 = m[3];
  const n12 = m[4], n22 = m[5], n32 = m[6], n42 = m[7];
  const n13 = m[8], n23 = m[9], n33 = m[10], n43 = m[11];
  const n14 = m[12], n24 = m[13], n34 = m[14], n44 = m[15];

  const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
  const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
  const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
  const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;

  const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
  if (Math.abs(det) < 1e-18) return null;
  const d = 1 / det;

  te[0] = t11 * d;
  te[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d;
  te[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d;
  te[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d;

  te[4] = t12 * d;
  te[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d;
  te[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d;
  te[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d;

  te[8] = t13 * d;
  te[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d;
  te[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d;
  te[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d;

  te[12] = t14 * d;
  te[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d;
  te[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d;
  te[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d;

  return te;
}

/** Longitudes de las columnas 0..2: el factor de escala en cada eje local. */
export function matScaleFactors(m: Mat4): Vec3 {
  return v3(
    length(v3(m[0], m[1], m[2])),
    length(v3(m[4], m[5], m[6])),
    length(v3(m[8], m[9], m[10])),
  );
}

export function matTranslationOf(m: Mat4): Vec3 {
  return v3(m[12], m[13], m[14]);
}

/** ¿La transformación invierte la orientación (determinante 3x3 negativo)? */
export function matFlipsOrientation(m: Mat4): boolean {
  const x = v3(m[0], m[1], m[2]);
  const y = v3(m[4], m[5], m[6]);
  const z = v3(m[8], m[9], m[10]);
  return dot(cross(x, y), z) < 0;
}

/** ¿La transformación es una isometría (rotación + traslación, sin escala)? */
export function matIsRigid(m: Mat4): boolean {
  const s = matScaleFactors(m);
  return Math.abs(s.x - 1) < EPS && Math.abs(s.y - 1) < EPS && Math.abs(s.z - 1) < EPS;
}

/**
 * Matriz que lleva el sistema global al sistema local de un plano definido por
 * `origin`, `xAxis` y `normal`. Útil para dibujar sobre una cara.
 */
export function matPlaneBasis(origin: Vec3, xAxis: Vec3, normal: Vec3): Mat4 {
  const z = normalize(normal);
  let x = sub(xAxis, { x: z.x * dot(xAxis, z), y: z.y * dot(xAxis, z), z: z.z * dot(xAxis, z) });
  x = normalize(x);
  const y = cross(z, x);
  return matFromAxes(x, y, z, origin);
}
