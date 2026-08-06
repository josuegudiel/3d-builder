import { Vec3 } from '../math/vec';

/**
 * Claves estables de región.
 *
 * Se usan para recordar qué caras ha borrado el usuario a mano y para
 * identificar la tapa que hay que retirar sobre un agujero al extruir. Todos
 * los productores y consumidores deben construirlas exactamente igual, así que
 * viven en un único sitio.
 *
 * La clave incluye los agujeros: sin ellos, borrar la cara de un anillo
 * suprimiría también el disco completo que aparecería al eliminar el hueco.
 */

const SEP_LOOP = '||';

function quantize(n: number): string {
  const r = Math.round(n * 1e6) / 1e6;
  return (r === 0 ? 0 : r).toFixed(6);
}

/** Clave de un conjunto de puntos, independiente del orden y del sentido. */
export function pointSetKey(points: readonly Vec3[]): string {
  const parts = points.map((p) => `${quantize(p.x)},${quantize(p.y)},${quantize(p.z)}`);
  parts.sort();
  return parts.join(';');
}

/** Clave de una región: contorno exterior y agujeros. */
export function regionKeyOf(
  outer: readonly Vec3[],
  holes: readonly (readonly Vec3[])[] = [],
): string {
  const holeKeys = holes.map(pointSetKey).sort();
  return [pointSetKey(outer), ...holeKeys].join(SEP_LOOP);
}

/** Puntos cuantizados que aparecen en una clave, para poder podarla. */
export function keyPoints(key: string): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (const loop of key.split(SEP_LOOP)) {
    for (const item of loop.split(';')) {
      if (!item) continue;
      const parts = item.split(',');
      if (parts.length !== 3) continue;
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      const z = Number(parts[2]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) out.push([x, y, z]);
    }
  }
  return out;
}
