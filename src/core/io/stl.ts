/**
 * Exportación a STL (ASCII y binario).
 *
 * ESCALA: el modelo se guarda en METROS, pero el formato STL no lleva unidades
 * y prácticamente todo el software de impresión 3D y CAD interpreta los números
 * como MILÍMETROS. Por eso `opts.scale` vale 1000 por defecto (metros → mm).
 * Pásale 1 si quieres exportar en metros, o 100 para centímetros.
 *
 * Se reutiliza el aplanado de la jerarquía de `obj.ts` (`collectTriangles`),
 * que ya aplica las transformaciones de las instancias, omite lo oculto y
 * calcula la normal de cada triángulo con la regla de la mano derecha.
 */

import { Model } from '../model/model';
import { collectTriangles, ExportTriangle, fmt } from './obj';

/** Escala por defecto: metros → milímetros. */
export const STL_DEFAULT_SCALE = 1000;

export interface StlOptions {
  /** Factor aplicado a las coordenadas. Por defecto 1000 (metros → mm). */
  scale?: number;
  /** Nombre del sólido (sólo en el formato ASCII). */
  name?: string;
}

/** Sanea el nombre del sólido: STL ASCII no admite saltos de línea. */
function solidName(s: string): string {
  const t = s.replace(/[\r\n]+/g, ' ').trim().replace(/\s+/g, '_');
  return t.length > 0 ? t : 'Form3D';
}

/**
 * STL en texto plano.
 *
 * Cada triángulo se emite como `facet normal` + `outer loop` con tres
 * `vertex`, en el orden a→b→c que ya respeta la orientación frontal de la cara.
 */
export function exportSTLAscii(model: Model, opts: StlOptions = {}): string {
  const scale = opts.scale ?? STL_DEFAULT_SCALE;
  const name = solidName(opts.name ?? model.name);
  const tris = collectTriangles(model, scale);

  const out: string[] = [];
  out.push(`solid ${name}`);
  for (const t of tris) {
    out.push(`  facet normal ${fmt(t.n.x)} ${fmt(t.n.y)} ${fmt(t.n.z)}`);
    out.push('    outer loop');
    out.push(`      vertex ${fmt(t.a.x)} ${fmt(t.a.y)} ${fmt(t.a.z)}`);
    out.push(`      vertex ${fmt(t.b.x)} ${fmt(t.b.y)} ${fmt(t.b.z)}`);
    out.push(`      vertex ${fmt(t.c.x)} ${fmt(t.c.y)} ${fmt(t.c.z)}`);
    out.push('    endloop');
    out.push('  endfacet');
  }
  out.push(`endsolid ${name}`);
  return out.join('\n') + '\n';
}

/**
 * STL binario: cabecera de 80 bytes + uint32 con el número de triángulos +
 * 50 bytes por triángulo (12 float32 little-endian y un uint16 de atributos).
 * Tamaño total = 84 + 50 * n.
 *
 * La cabecera NO empieza por "solid" para que los lectores no confundan el
 * archivo con la variante ASCII.
 */
export function exportSTLBinary(model: Model, opts: StlOptions = {}): ArrayBuffer {
  const scale = opts.scale ?? STL_DEFAULT_SCALE;
  const tris: ExportTriangle[] = collectTriangles(model, scale);

  const buffer = new ArrayBuffer(84 + 50 * tris.length);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Cabecera de 80 bytes (ASCII, rellenada con ceros).
  const header = `Form3D STL binario - escala ${scale} (1 = metros)`;
  for (let i = 0; i < 80 && i < header.length; i++) {
    const code = header.charCodeAt(i);
    bytes[i] = code < 128 ? code : 63; // '?' para lo no ASCII
  }

  view.setUint32(80, tris.length, true);

  let off = 84;
  for (const t of tris) {
    view.setFloat32(off, t.n.x, true);
    view.setFloat32(off + 4, t.n.y, true);
    view.setFloat32(off + 8, t.n.z, true);
    view.setFloat32(off + 12, t.a.x, true);
    view.setFloat32(off + 16, t.a.y, true);
    view.setFloat32(off + 20, t.a.z, true);
    view.setFloat32(off + 24, t.b.x, true);
    view.setFloat32(off + 28, t.b.y, true);
    view.setFloat32(off + 32, t.b.z, true);
    view.setFloat32(off + 36, t.c.x, true);
    view.setFloat32(off + 40, t.c.y, true);
    view.setFloat32(off + 44, t.c.z, true);
    view.setUint16(off + 48, 0, true);
    off += 50;
  }

  return buffer;
}

/** Número de triángulos que produciría la exportación (para diagnósticos). */
export function stlTriangleCount(model: Model): number {
  return collectTriangles(model, 1).length;
}
