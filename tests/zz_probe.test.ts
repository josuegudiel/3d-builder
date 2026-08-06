import { describe, it } from 'vitest';
import { v3, normalize, length, lengthSq } from '../src/core/math/vec';

describe('probe subnormal', () => {
  it('repite', () => {
    const raros: string[] = [];
    for (let i = 0; i < 200000; i++) {
      const v = v3(1e-320, 0, 0);
      const n = normalize(v);
      if (n.x !== 0) raros.push(`${i}: lengthSq=${lengthSq(v)} length=${length(v)} n.x=${n.x}`);
      if (raros.length > 3) break;
    }
    console.log('anomalias:', raros.slice(0, 4), 'total muestreado 200000');
  });
});
