/**
 * Exportación a Wavefront OBJ (+ su fichero .mtl).
 *
 * Se recorre toda la jerarquía de definiciones acumulando las transformaciones
 * (`matMul(padre, instancia.transform)`), se triangula cada cara con
 * `triangulateFace` y se emiten `v` / `vn` / `f` con índices 1-based agrupados
 * por material (`usemtl`).
 *
 * Convenios:
 *  - El modelo está en METROS; `opts.scale` multiplica todas las coordenadas y
 *    vale 1 por defecto (es decir, se exporta en metros).
 *  - Se omiten las caras y las instancias marcadas como ocultas.
 *  - El material de una cara es su `frontMaterial`; si es nulo, hereda el
 *    `materialId` de la instancia que la contiene (como en SketchUp).
 */

import { Model } from '../model/model';
import { Geometry } from '../model/geometry';
import { Id, Material } from '../model/types';
import { Vec3, v3, cross, sub, normalizeOr } from '../math/vec';
import {
  Mat4,
  IDENTITY,
  matMul,
  matScale,
  matFlipsOrientation,
  transformPoint,
  transformNormal,
} from '../math/mat';
import { triangulateFace } from '../topology/triangulate';

/** Triángulo ya transformado al espacio global, listo para exportar. */
export interface ExportTriangle {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  /** Normal unitaria, coherente con el orden a→b→c (regla de la mano derecha). */
  n: Vec3;
  /** Id del material efectivo, o null si la cara no tiene ninguno. */
  material: string | null;
}

export interface ObjExport {
  obj: string;
  mtl: string;
}

export interface ObjOptions {
  /** Factor aplicado a todas las coordenadas. 1 = metros (por defecto). */
  scale?: number;
  /** Nombre del .mtl referenciado con `mtllib`. */
  mtlFileName?: string;
}

/** Nombre del material usado por las caras sin material asignado. */
export const DEFAULT_MTL_NAME = 'Form3D_predeterminado';

// ---------------------------------------------------------------------------
// Recorrido de la jerarquía
// ---------------------------------------------------------------------------

function walkDefinition(
  model: Model,
  defId: Id,
  transform: Mat4,
  inherited: string | null,
  visiting: Set<Id>,
  out: ExportTriangle[],
): void {
  const def = model.definitions.get(defId);
  // El `visiting` evita bucles infinitos si un componente se contiene a sí mismo.
  if (!def || visiting.has(defId)) return;
  visiting.add(defId);

  const geo: Geometry = def.geometry;
  // Un determinante 3x3 negativo (espejo) invierte el sentido de los triángulos.
  const flip = matFlipsOrientation(transform);

  for (const face of geo.faces.values()) {
    if (face.hidden) continue;
    const tri = triangulateFace(geo, face.id);
    if (!tri) continue;
    const material = face.frontMaterial ?? inherited;
    const fallbackNormal = transformNormal(transform, face.plane.n);
    for (let i = 0; i < tri.indices.length; i += 3) {
      const pa = transformPoint(transform, tri.positions[tri.indices[i]]);
      let pb = transformPoint(transform, tri.positions[tri.indices[i + 1]]);
      let pc = transformPoint(transform, tri.positions[tri.indices[i + 2]]);
      if (flip) {
        const t = pb;
        pb = pc;
        pc = t;
      }
      const n = normalizeOr(cross(sub(pb, pa), sub(pc, pa)), fallbackNormal);
      out.push({ a: pa, b: pb, c: pc, n, material });
    }
  }

  for (const inst of geo.instances.values()) {
    if (inst.hidden) continue;
    walkDefinition(
      model,
      inst.definitionId,
      matMul(transform, inst.transform),
      inst.materialId ?? inherited,
      visiting,
      out,
    );
  }

  visiting.delete(defId);
}

/**
 * Aplana todo el modelo en una lista de triángulos en coordenadas globales.
 * Es la base común de la exportación OBJ y de la STL.
 */
export function collectTriangles(model: Model, scale = 1): ExportTriangle[] {
  const out: ExportTriangle[] = [];
  const base: Mat4 = scale === 1 ? IDENTITY : matScale(v3(scale, scale, scale));
  walkDefinition(model, model.rootId, base, null, new Set<Id>(), out);
  return out;
}

// ---------------------------------------------------------------------------
// Utilidades de formato
// ---------------------------------------------------------------------------

/** Número con 6 decimales, sin ceros negativos ni notación exponencial. */
export function fmt(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const s = v.toFixed(6);
  return s === '-0.000000' ? '0.000000' : s;
}

/** Sanea un nombre para que sea un token válido en OBJ/MTL (sin espacios). */
function safeName(s: string): string {
  const t = s.trim().replace(/\s+/g, '_').replace(/[#\\]/g, '_');
  return t.length > 0 ? t : DEFAULT_MTL_NAME;
}

/** Convierte "#rrggbb" (o "#rgb") a componentes 0..1. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0.8, 0.8, 0.8];
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/** Clave numérica estable para deduplicar vértices y normales. */
function key3(p: Vec3): string {
  return `${fmt(p.x)}|${fmt(p.y)}|${fmt(p.z)}`;
}

// ---------------------------------------------------------------------------
// Exportación
// ---------------------------------------------------------------------------

/**
 * Genera el par (.obj, .mtl) del modelo completo.
 * El .obj referencia al .mtl mediante `mtllib`.
 */
export function exportOBJ(model: Model, opts: ObjOptions = {}): ObjExport {
  const scale = opts.scale ?? 1;
  const mtlFileName = opts.mtlFileName ?? 'form3d.mtl';
  const tris = collectTriangles(model, scale);

  const positions: Vec3[] = [];
  const posIndex = new Map<string, number>();
  const normals: Vec3[] = [];
  const normIndex = new Map<string, number>();

  /** Devuelve el índice 1-based del vértice, reutilizando los repetidos. */
  const vIndex = (p: Vec3): number => {
    const k = key3(p);
    const found = posIndex.get(k);
    if (found !== undefined) return found;
    positions.push(p);
    const idx = positions.length;
    posIndex.set(k, idx);
    return idx;
  };

  const nIndex = (n: Vec3): number => {
    const k = key3(n);
    const found = normIndex.get(k);
    if (found !== undefined) return found;
    normals.push(n);
    const idx = normals.length;
    normIndex.set(k, idx);
    return idx;
  };

  // Caras agrupadas por material, en orden de primera aparición.
  const groups = new Map<string, string[]>();
  const usedMaterials: string[] = [];

  for (const t of tris) {
    const matKey = t.material ?? '';
    let lines = groups.get(matKey);
    if (!lines) {
      lines = [];
      groups.set(matKey, lines);
      usedMaterials.push(matKey);
    }
    const ni = nIndex(t.n);
    const ia = vIndex(t.a);
    const ib = vIndex(t.b);
    const ic = vIndex(t.c);
    lines.push(`f ${ia}//${ni} ${ib}//${ni} ${ic}//${ni}`);
  }

  const out: string[] = [];
  out.push('# Form3D - exportación Wavefront OBJ');
  out.push(`# modelo: ${model.name}`);
  out.push(`# escala: ${scale} (1 = metros)`);
  out.push(`# triángulos: ${tris.length}`);
  out.push(`mtllib ${mtlFileName}`);
  out.push(`o ${safeName(model.name)}`);
  for (const p of positions) out.push(`v ${fmt(p.x)} ${fmt(p.y)} ${fmt(p.z)}`);
  for (const n of normals) out.push(`vn ${fmt(n.x)} ${fmt(n.y)} ${fmt(n.z)}`);
  for (const matKey of usedMaterials) {
    out.push(`usemtl ${materialName(model, matKey)}`);
    const lines = groups.get(matKey)!;
    for (const l of lines) out.push(l);
  }

  return { obj: out.join('\n') + '\n', mtl: buildMTL(model, usedMaterials) };
}

/** Nombre MTL de un material del modelo ('' = material predeterminado). */
function materialName(model: Model, matKey: string): string {
  if (matKey === '') return DEFAULT_MTL_NAME;
  const m = model.materials.get(matKey);
  return safeName(m ? m.name : matKey);
}

/** Construye el contenido del .mtl con los materiales realmente usados. */
function buildMTL(model: Model, usedMaterials: readonly string[]): string {
  const out: string[] = [];
  out.push('# Form3D - biblioteca de materiales');
  for (const matKey of usedMaterials) {
    const m: Material | null = matKey === '' ? null : model.materials.get(matKey) ?? null;
    const [r, g, b] = hexToRgb(m ? m.color : '#cccccc');
    const opacity = m ? Math.min(1, Math.max(0, m.opacity)) : 1;
    out.push('');
    out.push(`newmtl ${materialName(model, matKey)}`);
    out.push(`Ka ${fmt(r * 0.2)} ${fmt(g * 0.2)} ${fmt(b * 0.2)}`);
    out.push(`Kd ${fmt(r)} ${fmt(g)} ${fmt(b)}`);
    out.push('Ks 0.000000 0.000000 0.000000');
    out.push('Ns 10.000000');
    out.push(`d ${fmt(opacity)}`);
    out.push(`Tr ${fmt(1 - opacity)}`);
    out.push(opacity < 1 ? 'illum 4' : 'illum 2');
  }
  return out.join('\n') + '\n';
}
