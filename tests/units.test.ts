import { describe, it, expect } from 'vitest';
import {
  DEFAULT_UNITS,
  METERS_PER,
  UNIT_LABEL,
  UNIT_NAME,
  isImperial,
  fromMeters,
  toMeters,
  parseLength,
  parseLengthList,
  parseAngle,
  formatLength,
  formatLengthBare,
  formatArea,
  formatVolume,
  formatAngle,
  formatVector,
  niceGridStep,
  type LengthFormat,
  type LengthUnit,
  type ParseLengthOptions,
  type UnitSettings,
} from '../src/core/units';

// ---------------------------------------------------------------------------
// Utilidades locales (esta suite no depende del kernel geométrico)
// ---------------------------------------------------------------------------

const MM: ParseLengthOptions = { defaultUnit: 'mm' };
const M: ParseLengthOptions = { defaultUnit: 'm' };
const IN: ParseLengthOptions = { defaultUnit: 'in' };

const ALL_UNITS: LengthUnit[] = ['mm', 'cm', 'm', 'km', 'in', 'ft', 'yd'];
const ALL_FORMATS: LengthFormat[] = ['decimal', 'architectural', 'engineering', 'fractional'];

/** Igualdad numérica con tolerancia absoluta (el kernel trabaja con EPS = 1e-6). */
function nearly(actual: number | null, expected: number, eps = 1e-12): void {
  expect(actual).not.toBeNull();
  expect(
    Math.abs((actual as number) - expected),
    `esperado ${expected}, obtenido ${actual}`,
  ).toBeLessThanOrEqual(eps);
}

/** Ajustes de unidades partiendo de los valores por defecto. */
function settings(over: Partial<UnitSettings> = {}): UnitSettings {
  return { ...DEFAULT_UNITS, ...over };
}

/** Longitud (en metros) del último dígito/fracción que muestra un formato. */
function displayStep(u: UnitSettings): number {
  switch (u.format) {
    case 'architectural':
    case 'fractional':
      return METERS_PER.in / u.fractionDenominator;
    case 'engineering':
      return METERS_PER.ft * Math.pow(10, -u.precision);
    default:
      return METERS_PER[u.unit] * Math.pow(10, -u.precision);
  }
}

/** Unidad que hay que asumir al releer lo que produjo `formatLength`. */
function readbackUnit(u: UnitSettings): LengthUnit {
  switch (u.format) {
    case 'architectural':
    case 'fractional':
      return 'in';
    case 'engineering':
      return 'ft';
    default:
      return u.unit;
  }
}

// ---------------------------------------------------------------------------
// Conversiones básicas
// ---------------------------------------------------------------------------

describe('units: conversiones y tablas', () => {
  it('METERS_PER tiene los factores exactos del SI y del sistema imperial', () => {
    expect(METERS_PER.mm).toBe(0.001);
    expect(METERS_PER.cm).toBe(0.01);
    expect(METERS_PER.m).toBe(1);
    expect(METERS_PER.km).toBe(1000);
    expect(METERS_PER.in).toBe(0.0254);
    expect(METERS_PER.ft).toBe(0.3048);
    expect(METERS_PER.yd).toBe(0.9144);
    // Coherencia interna del sistema imperial.
    nearly(METERS_PER.ft, METERS_PER.in * 12);
    nearly(METERS_PER.yd, METERS_PER.ft * 3);
  });

  it('cada unidad tiene etiqueta y nombre', () => {
    for (const u of ALL_UNITS) {
      expect(UNIT_LABEL[u], `falta etiqueta de ${u}`).toBeTruthy();
      expect(UNIT_NAME[u], `falta nombre de ${u}`).toBeTruthy();
    }
  });

  it('isImperial distingue los dos sistemas', () => {
    expect(isImperial('in')).toBe(true);
    expect(isImperial('ft')).toBe(true);
    expect(isImperial('yd')).toBe(true);
    expect(isImperial('mm')).toBe(false);
    expect(isImperial('cm')).toBe(false);
    expect(isImperial('m')).toBe(false);
    expect(isImperial('km')).toBe(false);
  });

  it('toMeters y fromMeters son inversas', () => {
    for (const u of ALL_UNITS) {
      for (const v of [0, 1, 3.7, -12.5, 1e-4, 12345]) {
        nearly(fromMeters(toMeters(v, u), u), v, 1e-9);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// parseLength: métrico
// ---------------------------------------------------------------------------

describe('parseLength: números sin unidad (usa la unidad por defecto)', () => {
  it('"1200" con mm da exactamente 1.2 m', () => {
    expect(parseLength('1200', MM)).toBe(1.2);
  });

  it('"0" da 0 y "-25" da -0.025', () => {
    expect(parseLength('0', MM)).toBe(0);
    expect(parseLength('-25', MM)).toBe(-0.025);
  });

  it('la unidad por defecto se respeta', () => {
    expect(parseLength('1200', M)).toBe(1200);
    nearly(parseLength('12', IN), 0.3048);
    nearly(parseLength('1', { defaultUnit: 'yd' }), 0.9144);
    nearly(parseLength('2', { defaultUnit: 'km' }), 2000);
  });

  it('acepta signo +, decimales sueltos y notación científica', () => {
    expect(parseLength('+5', MM)).toBe(0.005);
    expect(parseLength('.5', MM)).toBe(0.0005);
    expect(parseLength('1e3', MM)).toBe(1);
    nearly(parseLength('1e-3', M), 0.001);
  });

  it('ignora espacios sobrantes, tabuladores y espacios duros', () => {
    expect(parseLength('  1200  ', MM)).toBe(1.2);
    expect(parseLength('1200\tmm', MM)).toBe(1.2);
    expect(parseLength('1200 mm', MM)).toBe(1.2);
  });
});

describe('parseLength: sufijos métricos', () => {
  it('convierte cada sufijo a metros', () => {
    expect(parseLength('1200mm', MM)).toBe(1.2);
    expect(parseLength('120 cm', MM)).toBe(1.2);
    expect(parseLength('1.2m', MM)).toBe(1.2);
    expect(parseLength('0.0012km', MM)).toBe(1.2);
  });

  it('admite la coma decimal en un valor único', () => {
    expect(parseLength('1,2m', MM)).toBe(1.2);
    expect(parseLength('12,5', MM)).toBe(0.0125);
    nearly(parseLength('+1,5m', MM), 1.5);
  });

  it('el sufijo no distingue mayúsculas y admite nombres en español', () => {
    expect(parseLength('1200MM', MM)).toBe(1.2);
    expect(parseLength('1.2 M', MM)).toBe(1.2);
    expect(parseLength('1 metro', MM)).toBe(1);
    expect(parseLength('2 metros', MM)).toBe(2);
    expect(parseLength('5 centimetros', MM)).toBe(0.05);
    expect(parseLength('5 centímetros', MM)).toBe(0.05);
    expect(parseLength('10 milimetros', MM)).toBe(0.01);
    expect(parseLength('10 milímetros', MM)).toBe(0.01);
    nearly(parseLength('2 kilometros', MM), 2000);
    nearly(parseLength('2 kilómetros', MM), 2000);
    nearly(parseLength('2 Kilómetros', MM), 2000);
  });

  it('el sufijo gana a la unidad por defecto', () => {
    expect(parseLength('1200mm', M)).toBe(1.2);
    expect(parseLength('1200mm', IN)).toBe(1.2);
  });
});

// ---------------------------------------------------------------------------
// parseLength: imperial y notación arquitectónica
// ---------------------------------------------------------------------------

describe('parseLength: sistema imperial', () => {
  it('48 pulgadas son 1.2192 m', () => {
    nearly(parseLength('48in', MM), 1.2192);
    nearly(parseLength('48"', MM), 1.2192);
    nearly(parseLength('48 pulgadas', MM), 1.2192);
    nearly(parseLength('48″', MM), 1.2192); // comilla doble tipográfica
  });

  it('4 pies son 1.2192 m', () => {
    nearly(parseLength('4ft', MM), 1.2192);
    nearly(parseLength("4'", MM), 1.2192);
    nearly(parseLength('4 pies', MM), 1.2192);
    nearly(parseLength('4 feet', MM), 1.2192);
    nearly(parseLength('4′', MM), 1.2192); // prima tipográfica
  });

  it('5 pies 6 pulgadas son 1.6764 m en todas sus escrituras', () => {
    for (const s of ["5' 6\"", "5'6", "5' 6", '5 ft 6 in', '5 pies 6 pulgadas', '5′ 6″']) {
      nearly(parseLength(s, MM), 1.6764, 1e-9);
    }
  });

  it('acepta fracciones de pulgada', () => {
    nearly(parseLength('6 1/2"', MM), 0.1651);
    nearly(parseLength('1/2"', MM), 0.0127);
    nearly(parseLength('3-1/2"', MM), 0.0889, 1e-9);
    nearly(parseLength('5\' 6 1/2"', MM), 1.6891, 1e-9);
    // Sin unidad, la fracción usa la unidad por defecto.
    expect(parseLength('1/2', MM)).toBe(0.0005);
    nearly(parseLength('3 1/2', MM), 0.0035);
  });

  it('mezcla de pies y pulgadas con nombres largos', () => {
    nearly(parseLength('3ft 2in', MM), 0.9652, 1e-9);
    nearly(parseLength('3 pies 2 pulgadas', MM), 0.9652, 1e-9);
    nearly(parseLength('3 foot 2 inches', MM), 0.9652, 1e-9);
  });

  it('yardas', () => {
    nearly(parseLength('2yd', MM), 1.8288);
    nearly(parseLength('2 yardas', MM), 1.8288);
    nearly(parseLength('1 yard', MM), 0.9144);
  });

  it('valores imperiales negativos y fraccionarios', () => {
    nearly(parseLength('-1/2"', MM), -0.0127);
    nearly(parseLength('-5\'6"', MM), -1.6764, 1e-9);
    nearly(parseLength("0.5'", MM), 0.1524);
  });

  it('no distingue mayúsculas en la notación arquitectónica', () => {
    nearly(parseLength('5 Pies 6 Pulgadas', MM), 1.6764, 1e-9);
    nearly(parseLength('4 FT', MM), 1.2192);
  });
});

// ---------------------------------------------------------------------------
// parseLength: entradas inválidas
// ---------------------------------------------------------------------------

describe('parseLength: entradas inválidas devuelven null y nunca lanzan', () => {
  const INVALIDAS = [
    '', '   ', '\t', 'abc', '12xy', '1/0', '--3', '1 2 3', 'mm', '"', "'",
    'in', 'ft', '1.2.3m', 'NaN', 'Infinity', '-Infinity', '1200mm2', 'mm1200',
    '12 mm mm', '1 m 2', '1,2,3', '1.2,3', '3/0"', '+-3', '- -3', '1/', '/2',
    '·', '∞', '1 000', '0x10', '1_000', '${x}', '<script>', '1e', 'e3',
  ];

  for (const s of INVALIDAS) {
    it(`rechaza ${JSON.stringify(s)}`, () => {
      let r: number | null = 0;
      expect(() => {
        r = parseLength(s, MM);
      }).not.toThrow();
      expect(r, `${JSON.stringify(s)} debería ser null`).toBeNull();
    });
  }

  it('el doble signo no se colapsa en positivo', () => {
    // Regresión: "--3" llegaba a interpretarse como +3.
    expect(parseLength('--3', MM)).toBeNull();
    expect(parseLength('--3mm', MM)).toBeNull();
    expect(parseLength('+-3', MM)).toBeNull();
  });

  it('no lanza con entradas aleatorias', () => {
    const chars = ' 0123456789.,-+/\'"mcikftydeg°′″ abcXYZ()[]{}\\|';
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 2000; i++) {
      const n = 1 + Math.floor(rnd() * 12);
      let s = '';
      for (let j = 0; j < n; j++) s += chars[Math.floor(rnd() * chars.length)];
      let r: number | null = null;
      expect(() => {
        r = parseLength(s, MM);
      }, `lanzó con ${JSON.stringify(s)}`).not.toThrow();
      if (r !== null) {
        expect(Number.isFinite(r), `valor no finito para ${JSON.stringify(s)}`).toBe(true);
      }
    }
  });
});

describe('parseLength: opción allowNegative', () => {
  it('por defecto acepta negativos', () => {
    expect(parseLength('-25', MM)).toBe(-0.025);
  });

  it('con allowNegative:false los rechaza', () => {
    expect(parseLength('-25', { defaultUnit: 'mm', allowNegative: false })).toBeNull();
    expect(parseLength('-1/2"', { defaultUnit: 'mm', allowNegative: false })).toBeNull();
    expect(parseLength('25', { defaultUnit: 'mm', allowNegative: false })).toBe(0.025);
    expect(parseLength('0', { defaultUnit: 'mm', allowNegative: false })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// parseLengthList
// ---------------------------------------------------------------------------

describe('parseLengthList', () => {
  it('separa por punto y coma', () => {
    expect(parseLengthList('2000;1000', MM)).toEqual([2, 1]);
    expect(parseLengthList('3000;2000;1500', MM)).toEqual([3, 2, 1.5]);
    expect(parseLengthList('2000; 1000', MM)).toEqual([2, 1]);
    expect(parseLengthList('  2000 ; 1000  ', MM)).toEqual([2, 1]);
  });

  it('separa por coma cuando no hay punto y coma', () => {
    expect(parseLengthList('2000,1000', MM)).toEqual([2, 1]);
    expect(parseLengthList('1000,2000,3000', MM)).toEqual([1, 2, 3]);
  });

  it('"1,5m" es un único valor con coma decimal', () => {
    const r = parseLengthList('1,5m', MM);
    expect(r).not.toBeNull();
    expect(r).toHaveLength(1);
    nearly(r![0], 1.5);
    nearly(parseLengthList('1,5 m', MM)![0], 1.5);
    nearly(parseLengthList('1,25m', MM)![0], 1.25);
    nearly(parseLengthList('1,5cm', MM)![0], 0.015);
  });

  it('un valor suelto devuelve una lista de un elemento', () => {
    expect(parseLengthList('1200', MM)).toEqual([1.2]);
    expect(parseLengthList('1.2m', MM)).toEqual([1.2]);
  });

  it('admite valores imperiales en la lista', () => {
    const r = parseLengthList("4'; 2'", MM);
    expect(r).not.toBeNull();
    nearly(r![0], 1.2192);
    nearly(r![1], 0.6096);
    const r2 = parseLengthList('5\' 6"; 3ft 2in', MM);
    expect(r2).not.toBeNull();
    nearly(r2![0], 1.6764, 1e-9);
    nearly(r2![1], 0.9652, 1e-9);
  });

  it('devuelve null con listas inválidas', () => {
    for (const s of ['', '   ', ';', '2000;', ';2000', '2000;;1000', '2000;abc', 'a;b', '2000,abc', 'abc']) {
      let r: number[] | null = [];
      expect(() => {
        r = parseLengthList(s, MM);
      }).not.toThrow();
      expect(r, `${JSON.stringify(s)} debería ser null`).toBeNull();
    }
  });

  it('el punto y coma tiene prioridad sobre la coma', () => {
    // "1,5;2,5" → dos valores con coma decimal ambigua, pero nunca 4 elementos.
    const r = parseLengthList('1000;2,5m', MM);
    expect(r).not.toBeNull();
    expect(r).toHaveLength(2);
    nearly(r![0], 1);
    nearly(r![1], 2.5);
  });
});

// ---------------------------------------------------------------------------
// parseAngle
// ---------------------------------------------------------------------------

describe('parseAngle', () => {
  it('interpreta grados por defecto', () => {
    nearly(parseAngle('45'), Math.PI / 4);
    nearly(parseAngle('90'), Math.PI / 2);
    nearly(parseAngle('180'), Math.PI);
    nearly(parseAngle('360'), Math.PI * 2);
    expect(parseAngle('0')).toBe(0);
  });

  it('acepta el símbolo de grado y los nombres en español', () => {
    nearly(parseAngle('45°'), Math.PI / 4);
    nearly(parseAngle('45 °'), Math.PI / 4);
    nearly(parseAngle('90 grados'), Math.PI / 2);
    nearly(parseAngle('90 grado'), Math.PI / 2);
    nearly(parseAngle('45 deg'), Math.PI / 4);
    nearly(parseAngle('45DEG'), Math.PI / 4);
  });

  it('acepta radianes', () => {
    nearly(parseAngle('1.5708rad'), 1.5708);
    nearly(parseAngle('1.5708 rad'), 1.5708);
    nearly(parseAngle('0.5 radianes'), 0.5);
    nearly(parseAngle('2r'), 2);
    nearly(parseAngle('3.14159265358979rad'), Math.PI, 1e-13);
  });

  it('acepta negativos, coma decimal y fracciones', () => {
    nearly(parseAngle('-30'), -Math.PI / 6);
    nearly(parseAngle('-30°'), -Math.PI / 6);
    nearly(parseAngle('1,5'), (1.5 * Math.PI) / 180);
    nearly(parseAngle('1/2'), (0.5 * Math.PI) / 180);
  });

  it('devuelve null con basura y nunca lanza', () => {
    for (const s of ['', '   ', 'abc', 'deg', '°', 'rad', '45 45', '--3', '4x5', '1.2.3']) {
      let r: number | null = 0;
      expect(() => {
        r = parseAngle(s);
      }).not.toThrow();
      expect(r, `${JSON.stringify(s)} debería ser null`).toBeNull();
    }
  });

  it('ida y vuelta con formatAngle', () => {
    for (const deg of [0, 1, 30, 45, 90, 135, 180, 270, 359.9, -45]) {
      const rad = (deg * Math.PI) / 180;
      const txt = formatAngle(rad, settings({ anglePrecision: 4 }));
      nearly(parseAngle(txt), rad, 1e-6);
    }
  });
});

// ---------------------------------------------------------------------------
// formatLength: decimal
// ---------------------------------------------------------------------------

describe('formatLength: formato decimal', () => {
  it('mm con precisión 1', () => {
    expect(formatLength(1.2, DEFAULT_UNITS)).toBe('1200 mm');
    expect(formatLength(0.0015, DEFAULT_UNITS)).toBe('1.5 mm');
    expect(formatLength(0, DEFAULT_UNITS)).toBe('0 mm');
    expect(formatLength(-0.0254, DEFAULT_UNITS)).toBe('-25.4 mm');
  });

  it('showUnit:false quita el sufijo', () => {
    expect(formatLength(1.2, settings({ showUnit: false }))).toBe('1200');
    expect(formatLengthBare(1.2)).toBe('1200');
    expect(formatLengthBare(0.0015)).toBe('1.5');
  });

  it('recorta los ceros finales', () => {
    expect(formatLength(1.2, settings({ unit: 'm', precision: 4 }))).toBe('1.2 m');
    expect(formatLength(1, settings({ unit: 'm', precision: 4 }))).toBe('1 m');
    expect(formatLength(0.1, settings({ unit: 'm', precision: 4 }))).toBe('0.1 m');
    expect(formatLength(100, settings({ unit: 'm', precision: 0 }))).toBe('100 m');
  });

  it('cada unidad usa su etiqueta; pulgadas y pies van pegados al número', () => {
    expect(formatLength(1.2, settings({ unit: 'mm', precision: 2 }))).toBe('1200 mm');
    expect(formatLength(1.2, settings({ unit: 'cm', precision: 2 }))).toBe('120 cm');
    expect(formatLength(1.2, settings({ unit: 'm', precision: 2 }))).toBe('1.2 m');
    expect(formatLength(1200, settings({ unit: 'km', precision: 2 }))).toBe('1.2 km');
    expect(formatLength(1.2, settings({ unit: 'in', precision: 2 }))).toBe('47.24"');
    expect(formatLength(1.2, settings({ unit: 'ft', precision: 2 }))).toBe("3.94'");
    expect(formatLength(1.2, settings({ unit: 'yd', precision: 2 }))).toBe('1.31 yd');
  });

  it('no produce "-0"', () => {
    expect(formatLength(-1e-9, DEFAULT_UNITS)).toBe('0 mm');
    expect(formatLength(-0, DEFAULT_UNITS)).toBe('0 mm');
    expect(formatLength(-1e-12, settings({ unit: 'm', precision: 3 }))).toBe('0 m');
  });

  it('valores no finitos dan un marcador y no lanzan', () => {
    expect(formatLength(NaN)).toBe('—');
    expect(formatLength(Infinity)).toBe('—');
    expect(formatLength(-Infinity)).toBe('—');
  });

  it('precisiones extremas no lanzan', () => {
    for (const p of [-5, 0, 1, 12, 30]) {
      expect(() => formatLength(1.2345, settings({ precision: p }))).not.toThrow();
      expect(typeof formatLength(1.2345, settings({ precision: p }))).toBe('string');
    }
  });

  it('magnitudes grandes y pequeñas', () => {
    expect(formatLength(1234.5678, DEFAULT_UNITS)).toBe('1234567.8 mm');
    expect(formatLength(1e-9, DEFAULT_UNITS)).toBe('0 mm');
    expect(formatLength(1e6, settings({ unit: 'km', precision: 1 }))).toBe('1000 km');
  });
});

// ---------------------------------------------------------------------------
// formatLength: arquitectónico
// ---------------------------------------------------------------------------

describe('formatLength: formato arquitectónico', () => {
  const arch = settings({ format: 'architectural' });

  it('pies y pulgadas', () => {
    expect(formatLength(1.6764, arch)).toBe('5\' 6"');
    expect(formatLength(0.0254, arch)).toBe('1"');
    expect(formatLength(0.3048, arch)).toBe("1'");
    expect(formatLength(0.9144, arch)).toBe("3'");
    expect(formatLength(3.048, arch)).toBe("10'");
  });

  it('fracciones de pulgada', () => {
    expect(formatLength(0.1651, arch)).toBe('6 1/2"');
    expect(formatLength(0.0127, arch)).toBe('1/2"');
    expect(formatLength(0.0254 * 11.875, arch)).toBe('11 7/8"');
    expect(formatLength(0.0254 * (12 + 3.25), arch)).toBe('1\' 3 1/4"');
  });

  it('acarreo: lo que redondea a 12" pasa al pie siguiente', () => {
    // 0.30479 m = 11.9996" → 12" → 1'
    expect(formatLength(0.30479, arch)).toBe("1'");
    expect(formatLength(0.0254 * 11.99, arch)).toBe("1'");
    expect(formatLength(0.0254 * 11.97, arch)).toBe("1'");
    // Un pelo por debajo del umbral de redondeo sigue en pulgadas.
    expect(formatLength(0.0254 * 11.9, arch)).toBe('11 7/8"');
    // Acarreo dentro del pie: 23.99" → 2'
    expect(formatLength(0.0254 * 23.99, arch)).toBe("2'");
  });

  it('cero y negativos', () => {
    expect(formatLength(0, arch)).toBe('0"');
    expect(formatLength(-1.6764, arch)).toBe('-5\' 6"');
    expect(formatLength(-0.0127, arch)).toBe('-1/2"');
    // No debe salir "-0"".
    expect(formatLength(-1e-9, arch)).toBe('0"');
    expect(formatLength(-0.0001, arch)).toBe('0"');
  });

  it('el denominador de fracción configurado se respeta', () => {
    const v = 0.0254 * (1 + 5 / 64);
    expect(formatLength(v, settings({ format: 'architectural', fractionDenominator: 64 }))).toBe('1 5/64"');
    expect(formatLength(v, settings({ format: 'architectural', fractionDenominator: 32 }))).toBe('1 3/32"');
    expect(formatLength(v, settings({ format: 'architectural', fractionDenominator: 8 }))).toBe('1 1/8"');
    expect(formatLength(v, settings({ format: 'architectural', fractionDenominator: 2 }))).toBe('1"');
  });

  it('nunca lanza y siempre devuelve texto', () => {
    for (const v of [0, 1e-12, -1e-12, 1e6, -1e6, 0.3048, 12.7]) {
      expect(typeof formatLength(v, arch)).toBe('string');
      expect(formatLength(v, arch).length).toBeGreaterThan(0);
    }
    expect(formatLength(NaN, arch)).toBe('—');
  });
});

// ---------------------------------------------------------------------------
// formatLength: fraccionario
// ---------------------------------------------------------------------------

describe('formatLength: formato fraccionario', () => {
  const fr = settings({ format: 'fractional' });
  const inch = METERS_PER.in;

  it('reduce las fracciones', () => {
    expect(formatLength(inch * (3 + 8 / 16), fr)).toBe('3 1/2"'); // 8/16 → 1/2
    expect(formatLength(inch * (3 + 4 / 16), fr)).toBe('3 1/4"'); // 4/16 → 1/4
    expect(formatLength(inch * (3 + 2 / 16), fr)).toBe('3 1/8"'); // 2/16 → 1/8
    expect(formatLength(inch * (3 + 12 / 16), fr)).toBe('3 3/4"'); // 12/16 → 3/4
    expect(formatLength(inch * (3 + 1 / 16), fr)).toBe('3 1/16"');
    expect(formatLength(inch * (3 + 6 / 16), fr)).toBe('3 3/8"');
  });

  it('sin parte entera y sin fracción', () => {
    expect(formatLength(inch * 0.5, fr)).toBe('1/2"');
    expect(formatLength(inch, fr)).toBe('1"');
    expect(formatLength(0, fr)).toBe('0"');
  });

  it('no convierte a pies: 66 pulgadas siguen siendo pulgadas', () => {
    expect(formatLength(1.6764, fr)).toBe('66"');
    expect(formatLength(12.7, fr)).toBe('500"');
  });

  it('negativos y showUnit', () => {
    expect(formatLength(-inch * 2.25, fr)).toBe('-2 1/4"');
    expect(formatLength(inch * 3.5, settings({ format: 'fractional', showUnit: false }))).toBe('3 1/2');
    expect(formatLength(-inch * 2.25, settings({ format: 'fractional', showUnit: false }))).toBe('-2 1/4');
    // No debe salir "-0"".
    expect(formatLength(-1e-9, fr)).toBe('0"');
    expect(formatLength(-0.0001, fr)).toBe('0"');
  });

  it('el redondeo al denominador nunca deja numerador == denominador', () => {
    for (const den of [2, 4, 8, 16, 32, 64] as const) {
      const s = settings({ format: 'fractional', fractionDenominator: den });
      for (let i = 0; i < 400; i++) {
        const v = inch * (i * 0.0117);
        const txt = formatLength(v, s);
        const m = /(\d+)\/(\d+)"$/.exec(txt);
        if (m) {
          const num = parseInt(m[1], 10);
          const d = parseInt(m[2], 10);
          expect(num, `${txt} tiene numerador >= denominador`).toBeLessThan(d);
          expect(num % 2 === 1 || d === 1, `${txt} no está reducida`).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// formatLength: ingeniería
// ---------------------------------------------------------------------------

describe('formatLength: formato ingeniería (pies decimales)', () => {
  it('muestra pies decimales', () => {
    expect(formatLength(0.3048, settings({ format: 'engineering', precision: 2 }))).toBe("1'");
    expect(formatLength(1.6764, settings({ format: 'engineering', precision: 2 }))).toBe("5.5'");
    expect(formatLength(30.48, settings({ format: 'engineering', precision: 2 }))).toBe("100'");
    expect(formatLength(12.7, settings({ format: 'engineering', precision: 4 }))).toBe("41.6667'");
  });

  it('cero, negativos y showUnit', () => {
    expect(formatLength(0, settings({ format: 'engineering' }))).toBe("0'");
    expect(formatLength(-0.3048, settings({ format: 'engineering' }))).toBe("-1'");
    expect(formatLength(1.6764, settings({ format: 'engineering', showUnit: false }))).toBe('5.5');
    expect(formatLength(-1e-12, settings({ format: 'engineering', precision: 3 }))).toBe("0'");
  });
});

// ---------------------------------------------------------------------------
// Ida y vuelta
// ---------------------------------------------------------------------------

describe('ida y vuelta: parseLength(formatLength(v)) ≈ v', () => {
  const VALORES = [0, 0.001, 0.0127, 0.0254, 0.1, 0.3048, 1, 1.2, 1.2345, 1.6764, 12.7, 123.456, -1.6764, -0.05];

  it('formato decimal, todas las unidades y precisiones', () => {
    for (const unit of ALL_UNITS) {
      for (const precision of [0, 1, 2, 3, 4]) {
        const u = settings({ format: 'decimal', unit, precision });
        const tol = displayStep(u) * 0.5 * (1 + 1e-9) + 1e-12;
        for (const v of VALORES) {
          const txt = formatLength(v, u);
          const back = parseLength(txt, { defaultUnit: readbackUnit(u) });
          expect(back, `no se pudo releer ${JSON.stringify(txt)} (${unit}/${precision})`).not.toBeNull();
          expect(
            Math.abs((back as number) - v),
            `v=${v} → ${JSON.stringify(txt)} → ${back} (unit=${unit}, p=${precision})`,
          ).toBeLessThanOrEqual(tol);
        }
      }
    }
  });

  it('formato decimal sin unidad, releído con la unidad por defecto correcta', () => {
    for (const unit of ALL_UNITS) {
      const u = settings({ format: 'decimal', unit, precision: 4, showUnit: false });
      const tol = displayStep(u) * 0.5 * (1 + 1e-9) + 1e-12;
      for (const v of VALORES) {
        const txt = formatLength(v, u);
        const back = parseLength(txt, { defaultUnit: unit });
        expect(back, `no se pudo releer ${JSON.stringify(txt)}`).not.toBeNull();
        expect(Math.abs((back as number) - v), `v=${v} → ${JSON.stringify(txt)}`).toBeLessThanOrEqual(tol);
      }
    }
  });

  it('formatos imperiales con todos los denominadores', () => {
    for (const format of ['architectural', 'fractional'] as LengthFormat[]) {
      for (const den of [2, 4, 8, 16, 32, 64] as const) {
        const u = settings({ format, fractionDenominator: den });
        const tol = displayStep(u) * 0.5 * (1 + 1e-9) + 1e-12;
        for (const v of VALORES) {
          const txt = formatLength(v, u);
          const back = parseLength(txt, { defaultUnit: 'in' });
          expect(back, `no se pudo releer ${JSON.stringify(txt)} (${format}/${den})`).not.toBeNull();
          expect(
            Math.abs((back as number) - v),
            `v=${v} → ${JSON.stringify(txt)} → ${back} (${format}, 1/${den})`,
          ).toBeLessThanOrEqual(tol);
        }
      }
    }
  });

  it('formato ingeniería', () => {
    for (const precision of [1, 2, 3, 4, 6]) {
      const u = settings({ format: 'engineering', precision });
      const tol = displayStep(u) * 0.5 * (1 + 1e-9) + 1e-12;
      for (const v of VALORES) {
        const txt = formatLength(v, u);
        const back = parseLength(txt, { defaultUnit: 'ft' });
        expect(back, `no se pudo releer ${JSON.stringify(txt)}`).not.toBeNull();
        expect(Math.abs((back as number) - v), `v=${v} → ${JSON.stringify(txt)} → ${back}`).toBeLessThanOrEqual(tol);
      }
    }
  });

  it('muestreo pseudoaleatorio sobre todas las configuraciones', () => {
    let seed = 987654321;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (const format of ALL_FORMATS) {
      for (const unit of ALL_UNITS) {
        const u = settings({ format, unit, precision: 3 });
        const tol = displayStep(u) * 0.5 * (1 + 1e-9) + 1e-12;
        for (let i = 0; i < 60; i++) {
          const v = (rnd() * 2 - 1) * Math.pow(10, Math.floor(rnd() * 5) - 2);
          const txt = formatLength(v, u);
          const back = parseLength(txt, { defaultUnit: readbackUnit(u) });
          expect(back, `no se pudo releer ${JSON.stringify(txt)} (${format}/${unit})`).not.toBeNull();
          expect(
            Math.abs((back as number) - v),
            `v=${v} → ${JSON.stringify(txt)} → ${back} (${format}/${unit})`,
          ).toBeLessThanOrEqual(tol);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Áreas, volúmenes, ángulos y vectores
// ---------------------------------------------------------------------------

describe('formatArea / formatVolume', () => {
  it('área métrica usa la unidad activa al cuadrado', () => {
    expect(formatArea(1, settings({ unit: 'm' }))).toBe('1 m²');
    expect(formatArea(1, settings({ unit: 'mm' }))).toBe('1000000 mm²');
    expect(formatArea(1, settings({ unit: 'cm' }))).toBe('10000 cm²');
    expect(formatArea(1, settings({ unit: 'km' }))).toBe('0 km²');
  });

  it('área imperial o formatos imperiales usan pies cuadrados', () => {
    expect(formatArea(1, settings({ unit: 'ft' }))).toBe('10.76 ft²');
    expect(formatArea(1, settings({ unit: 'in' }))).toBe('10.76 ft²');
    expect(formatArea(1, settings({ format: 'architectural' }))).toBe('10.76 ft²');
    expect(formatArea(1, settings({ format: 'fractional' }))).toBe('10.76 ft²');
    expect(formatArea(1, settings({ format: 'engineering' }))).toBe('10.76 ft²');
    nearly(parseFloat(formatArea(1, settings({ unit: 'ft' }))), 1 / (0.3048 * 0.3048), 0.01);
  });

  it('volumen usa el cubo de la unidad', () => {
    expect(formatVolume(1, settings({ unit: 'm' }))).toBe('1 m³');
    expect(formatVolume(1, settings({ unit: 'mm' }))).toBe('1000000000 mm³');
    expect(formatVolume(1, settings({ unit: 'ft' }))).toBe('35.31 ft³');
    expect(formatVolume(1, settings({ format: 'architectural' }))).toBe('35.31 ft³');
  });

  it('todos los sufijos terminan en ² o ³ y nada lanza', () => {
    for (const format of ALL_FORMATS) {
      for (const unit of ALL_UNITS) {
        const u = settings({ format, unit });
        for (const v of [0, 1, 1e-9, 1e9, -3, NaN, Infinity]) {
          const a = formatArea(v, u);
          const b = formatVolume(v, u);
          expect(a.endsWith('²'), `área sin sufijo: ${a}`).toBe(true);
          expect(b.endsWith('³'), `volumen sin sufijo: ${b}`).toBe(true);
        }
      }
    }
  });
});

describe('formatAngle', () => {
  it('convierte radianes a grados', () => {
    expect(formatAngle(Math.PI / 4)).toBe('45°');
    expect(formatAngle(Math.PI / 2)).toBe('90°');
    expect(formatAngle(0)).toBe('0°');
    expect(formatAngle(-Math.PI)).toBe('-180°');
    expect(formatAngle(Math.PI / 3, settings({ anglePrecision: 2 }))).toBe('60°');
    expect(formatAngle(Math.PI / 7, settings({ anglePrecision: 3 }))).toBe('25.714°');
  });

  it('no produce "-0°" ni lanza con valores extremos', () => {
    expect(formatAngle(-1e-12)).toBe('0°');
    for (const v of [NaN, Infinity, -Infinity, 1e12]) {
      expect(() => formatAngle(v)).not.toThrow();
      expect(formatAngle(v).endsWith('°')).toBe(true);
    }
  });
});

describe('formatVector', () => {
  it('usa el separador ; y los delimitadores angulares', () => {
    expect(formatVector({ x: 1.2, y: 0, z: 0.45 })).toBe('⟨1200; 0; 450⟩');
    expect(formatVector({ x: -1.2, y: 0, z: 0 }, settings({ unit: 'm', precision: 2 }))).toBe('⟨-1.2; 0; 0⟩');
  });

  it('en formatos imperiales conserva los símbolos (son parte del número)', () => {
    // Documenta el comportamiento: 5' 6" no es legible sin sus símbolos.
    const arch = settings({ format: 'architectural' });
    expect(formatVector({ x: 1.6764, y: 0, z: -0.3048 }, arch)).toBe('⟨5\' 6"; 0"; -1\'⟩');
  });

  it('no lanza con cualquier configuración ni con valores no finitos', () => {
    for (const format of ALL_FORMATS) {
      for (const unit of ALL_UNITS) {
        const u = settings({ format, unit });
        expect(() => formatVector({ x: 1, y: -2, z: NaN }, u)).not.toThrow();
        const s = formatVector({ x: 1, y: -2, z: 3 }, u);
        expect(s.startsWith('⟨') && s.endsWith('⟩')).toBe(true);
        expect(s.split(';')).toHaveLength(3);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Rejilla
// ---------------------------------------------------------------------------

describe('niceGridStep', () => {
  it('devuelve un paso positivo y finito para toda combinación', () => {
    for (const format of ALL_FORMATS) {
      for (const unit of ALL_UNITS) {
        const step = niceGridStep(settings({ format, unit }));
        expect(Number.isFinite(step), `paso no finito en ${format}/${unit}`).toBe(true);
        expect(step, `paso no positivo en ${format}/${unit}`).toBeGreaterThan(0);
      }
    }
  });

  it('los formatos imperiales usan pie o pulgada', () => {
    nearly(niceGridStep(settings({ format: 'architectural' })), METERS_PER.ft);
    nearly(niceGridStep(settings({ format: 'fractional' })), METERS_PER.ft);
    nearly(niceGridStep(settings({ format: 'engineering' })), METERS_PER.ft);
  });

  it('los pasos métricos son redondos en su unidad', () => {
    expect(niceGridStep(settings({ unit: 'mm' }))).toBe(0.01);
    expect(niceGridStep(settings({ unit: 'cm' }))).toBe(0.1);
    expect(niceGridStep(settings({ unit: 'm' }))).toBe(1);
    expect(niceGridStep(settings({ unit: 'km' }))).toBe(100);
    for (const unit of ALL_UNITS) {
      const step = niceGridStep(settings({ unit }));
      const enUnidad = step / METERS_PER[unit];
      // El paso equivale a una cantidad "redonda" de la unidad activa.
      expect(Math.abs(enUnidad - Math.round(enUnidad * 1e6) / 1e6)).toBeLessThan(1e-9);
    }
  });
});
