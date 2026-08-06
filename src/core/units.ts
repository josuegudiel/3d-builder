/**
 * Sistema de unidades.
 *
 * El modelo guarda SIEMPRE metros. Este módulo traduce entre metros y el texto
 * que ve y escribe el usuario. Soporta el sistema métrico y el imperial,
 * incluyendo notación arquitectónica (5' 6 1/2").
 */

export type LengthUnit = 'mm' | 'cm' | 'm' | 'km' | 'in' | 'ft' | 'yd';

export type LengthFormat =
  /** Número decimal con la unidad indicada: 1250 mm */
  | 'decimal'
  /** Pies y pulgadas con fracciones: 4' 1 1/4" */
  | 'architectural'
  /** Pies decimales: 4.104' */
  | 'engineering'
  /** Pulgadas con fracciones: 49 1/4" */
  | 'fractional';

export type AngleUnit = 'deg' | 'rad';

export interface UnitSettings {
  format: LengthFormat;
  /** Unidad usada cuando `format` es 'decimal'. */
  unit: LengthUnit;
  /** Decimales mostrados en formatos decimales. */
  precision: number;
  /** Denominador máximo de las fracciones (1/2, 1/4, ... 1/64). */
  fractionDenominator: 2 | 4 | 8 | 16 | 32 | 64;
  /** Decimales mostrados para ángulos. */
  anglePrecision: number;
  /** Mostrar el símbolo de unidad junto al número. */
  showUnit: boolean;
}

export const DEFAULT_UNITS: UnitSettings = {
  format: 'decimal',
  unit: 'mm',
  precision: 1,
  fractionDenominator: 16,
  anglePrecision: 1,
  showUnit: true,
};

/** Metros por unidad. */
export const METERS_PER: Record<LengthUnit, number> = {
  mm: 0.001,
  cm: 0.01,
  m: 1,
  km: 1000,
  in: 0.0254,
  ft: 0.3048,
  yd: 0.9144,
};

export const UNIT_LABEL: Record<LengthUnit, string> = {
  mm: 'mm',
  cm: 'cm',
  m: 'm',
  km: 'km',
  in: '"',
  ft: "'",
  yd: 'yd',
};

export const UNIT_NAME: Record<LengthUnit, string> = {
  mm: 'Milímetros',
  cm: 'Centímetros',
  m: 'Metros',
  km: 'Kilómetros',
  in: 'Pulgadas',
  ft: 'Pies',
  yd: 'Yardas',
};

/** ¿La unidad pertenece al sistema imperial? */
export function isImperial(u: LengthUnit): boolean {
  return u === 'in' || u === 'ft' || u === 'yd';
}

/** Convierte de metros a la unidad indicada. */
export function fromMeters(meters: number, unit: LengthUnit): number {
  return meters / METERS_PER[unit];
}

/** Convierte de la unidad indicada a metros. */
export function toMeters(value: number, unit: LengthUnit): number {
  return value * METERS_PER[unit];
}

// ---------------------------------------------------------------------------
// Parseo
// ---------------------------------------------------------------------------

const UNIT_ALIASES: Array<[RegExp, LengthUnit]> = [
  [/^(mm|milimetros?|milímetros?|millimeters?)$/i, 'mm'],
  [/^(cm|centimetros?|centímetros?|centimeters?)$/i, 'cm'],
  [/^(m|metros?|meters?|mts?)$/i, 'm'],
  [/^(km|kilometros?|kilómetros?|kilometers?)$/i, 'km'],
  [/^(in|inch|inches|pulg|pulgadas?|["”″])$/i, 'in'],
  [/^(ft|feet|foot|pies?|pie|['’′])$/i, 'ft'],
  [/^(yd|yard|yards|yardas?)$/i, 'yd'],
];

function matchUnit(token: string): LengthUnit | null {
  const t = token.trim();
  if (!t) return null;
  for (const [re, u] of UNIT_ALIASES) {
    if (re.test(t)) return u;
  }
  return null;
}

/** Normaliza comillas tipográficas y espacios raros. */
function normalizeInput(s: string): string {
  return s
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/ /g, ' ')
    .trim();
}

/**
 * Convierte "3 1/2" en 3.5. Devuelve null si no encaja el patrón.
 * Acepta también "1/2" y "3-1/2".
 */
function parseMixedFraction(s: string): number | null {
  const t = s.trim();
  let m = /^([+-]?\d+)\s*[-\s]\s*(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (m) {
    const whole = parseInt(m[1], 10);
    const num = parseInt(m[2], 10);
    const den = parseInt(m[3], 10);
    if (den === 0) return null;
    const frac = num / den;
    return whole < 0 || /^-/.test(m[1]) ? whole - frac : whole + frac;
  }
  m = /^([+-]?\d+)\s*\/\s*(\d+)$/.exec(t);
  if (m) {
    const den = parseInt(m[2], 10);
    if (den === 0) return null;
    return parseInt(m[1], 10) / den;
  }
  return null;
}

/** Convierte un texto numérico simple (con o sin fracción) a número. */
function parseNumber(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const frac = parseMixedFraction(t);
  if (frac !== null) return frac;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export interface ParseLengthOptions {
  /** Unidad asumida cuando el texto no lleva unidad explícita. */
  defaultUnit: LengthUnit;
  /** Permitir valores negativos (por defecto sí). */
  allowNegative?: boolean;
}

/**
 * Interpreta una longitud escrita por el usuario y la devuelve en METROS.
 *
 * Ejemplos aceptados:
 *   "1200"       → 1200 unidades por defecto
 *   "1200mm"     → 1.2 m
 *   "1,2m"       → 1.2 m (coma decimal admitida en valor único)
 *   "4'"         → 1.2192 m
 *   `5' 6"`      → 1.6764 m
 *   "5'6"        → 1.6764 m
 *   `6 1/2"`     → 0.1651 m
 *   "3ft 2in"    → 0.9652 m
 *   "-25.4mm"    → -0.0254 m
 *
 * Devuelve null si no se puede interpretar.
 */
export function parseLength(input: string, opts: ParseLengthOptions): number | null {
  const allowNegative = opts.allowNegative !== false;
  let s = normalizeInput(input);
  if (!s) return null;

  // Coma decimal: sólo si hay exactamente una coma y ningún punto.
  if ((s.match(/,/g)?.length ?? 0) === 1 && !s.includes('.')) {
    s = s.replace(',', '.');
  }

  let negative = false;
  if (/^[-–]/.test(s)) {
    negative = true;
    s = s.slice(1).trim();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim();
  }
  // Tras quitar el signo no puede quedar otro: "--3" o "+-3" son inválidos.
  if (/^[+\-–]/.test(s)) return null;

  const meters = parseUnsignedLength(s, opts.defaultUnit);
  if (meters === null) return null;
  const signed = negative ? -meters : meters;
  if (!allowNegative && signed < 0) return null;
  return signed;
}

function parseUnsignedLength(s: string, defaultUnit: LengthUnit): number | null {
  if (!s) return null;

  // --- Notación arquitectónica: pies seguidos opcionalmente de pulgadas ---
  // 5'  |  5'6  |  5' 6"  |  5'6 1/2"  |  5 ft 6 in
  const feetMatch = /^(.+?)\s*(?:'|ft|feet|foot|pies?|pie)\s*(.*)$/i.exec(s);
  if (feetMatch) {
    const feetVal = parseNumber(feetMatch[1]);
    if (feetVal !== null) {
      const rest = feetMatch[2].trim();
      if (!rest) return feetVal * METERS_PER.ft;
      // El resto son pulgadas (con o sin símbolo).
      const inchText = rest.replace(/(?:"|in|inch|inches|pulg|pulgadas?)\s*$/i, '').trim();
      const inchVal = parseNumber(inchText);
      if (inchVal !== null) {
        return feetVal * METERS_PER.ft + inchVal * METERS_PER.in;
      }
      return null;
    }
  }

  // --- Sufijo de unidad explícito al final ---
  // La clase incluye vocales acentuadas para que "centímetros" o "kilómetros"
  // (declarados en UNIT_ALIASES) se capturen como un único token.
  const suffixMatch = /^(.*?)\s*([a-zA-ZµáéíóúüÁÉÍÓÚÜ"'”’″′]+)$/.exec(s);
  if (suffixMatch) {
    const unit = matchUnit(suffixMatch[2]);
    if (unit) {
      const num = parseNumber(suffixMatch[1]);
      if (num !== null) return num * METERS_PER[unit];
      // "1/2\"" → fracción sin parte entera ya cubierta por parseNumber.
      return null;
    }
    // Sufijo no reconocido → error.
    return null;
  }

  // --- Número puro: se usa la unidad por defecto ---
  const num = parseNumber(s);
  if (num === null) return null;
  return num * METERS_PER[defaultUnit];
}

/**
 * Interpreta una lista de longitudes separadas por `;` (o por `,` cuando no hay
 * `;`). Devuelve los valores en metros o null si alguno es inválido.
 *
 * Se usa para el cuadro de medidas: "2000;1000" define ancho y alto de un
 * rectángulo, "3000;2000;1500" define una caja.
 */
export function parseLengthList(
  input: string,
  opts: ParseLengthOptions,
): number[] | null {
  const s = normalizeInput(input);
  if (!s) return null;
  const parts = s.includes(';') ? s.split(';') : splitOnListComma(s);
  const out: number[] = [];
  for (const part of parts) {
    const t = part.trim();
    if (!t) return null;
    const v = parseLength(t, opts);
    if (v === null) return null;
    out.push(v);
  }
  return out;
}

/**
 * Divide por comas tratándolas como separador de lista. Si sólo hay una coma y
 * el texto se interpreta correctamente como un único valor con coma decimal,
 * devuelve un solo elemento.
 */
function splitOnListComma(s: string): string[] {
  const commas = s.match(/,/g)?.length ?? 0;
  if (commas === 0) return [s];
  if (commas === 1 && !s.includes('.')) {
    // Ambiguo: "1,5" puede ser 1.5 o la lista [1, 5].
    // Si ambos lados son enteros cortos lo tratamos como lista (caso habitual
    // al dibujar rectángulos); si el lado derecho tiene 1-2 dígitos y el texto
    // lleva unidad, es coma decimal.
    const [a, b] = s.split(',');
    const hasUnit = /[a-zA-Z"'”’″′]/.test(s);
    // El lado derecho lleva los decimales y, opcionalmente, la unidad ("5m").
    if (hasUnit && /^\s*\d{1,2}\s*[a-zA-Z"'”’″′]*\s*$/.test(b) && !/[a-zA-Z"'”’″′]/.test(a)) {
      return [s]; // "1,5m" → coma decimal
    }
    return [a, b];
  }
  return s.split(',');
}

/** Interpreta un ángulo escrito por el usuario. Devuelve RADIANES. */
export function parseAngle(input: string): number | null {
  let s = normalizeInput(input);
  if (!s) return null;
  if ((s.match(/,/g)?.length ?? 0) === 1 && !s.includes('.')) s = s.replace(',', '.');

  let unit: AngleUnit = 'deg';
  const m = /^(.*?)\s*(deg|grados?|°|rad|radianes?|r)$/i.exec(s);
  let numText = s;
  if (m) {
    numText = m[1];
    unit = /^(rad|radianes?|r)$/i.test(m[2]) ? 'rad' : 'deg';
  }
  const num = parseNumber(numText);
  if (num === null) return null;
  return unit === 'rad' ? num : (num * Math.PI) / 180;
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

/** Recorta ceros finales innecesarios: "12.500" → "12.5", "12.000" → "12". */
function trimZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/\.?0+$/, '');
}

function fixed(v: number, digits: number): string {
  const s = v.toFixed(Math.max(0, Math.min(12, digits)));
  // Elimina el "-0" y "-0.00".
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

/**
 * Aproxima `v` por una fracción con denominador `den`, devolviendo la parte
 * entera y el numerador reducido.
 */
function toFraction(v: number, den: number): { whole: number; num: number; den: number } {
  const sign = v < 0 ? -1 : 1;
  const a = Math.abs(v);
  let whole = Math.floor(a);
  let num = Math.round((a - whole) * den);
  let d = den;
  if (num >= den) {
    whole += 1;
    num = 0;
  }
  while (num > 0 && num % 2 === 0 && d % 2 === 0) {
    num /= 2;
    d /= 2;
  }
  return { whole: sign * whole, num, den: d };
}

function formatFractionalInches(inches: number, den: number, showUnit: boolean): string {
  const neg = inches < 0;
  const f = toFraction(Math.abs(inches), den);
  let s: string;
  if (f.num === 0) s = `${f.whole}`;
  else if (f.whole === 0) s = `${f.num}/${f.den}`;
  else s = `${f.whole} ${f.num}/${f.den}`;
  // No mostrar "-0": si al redondear queda cero, el signo sobra.
  if (neg && !(f.whole === 0 && f.num === 0)) s = `-${s}`;
  return showUnit ? `${s}"` : s;
}

/** Convierte metros a texto según los ajustes de unidades. */
export function formatLength(meters: number, u: UnitSettings = DEFAULT_UNITS): string {
  if (!Number.isFinite(meters)) return '—';

  switch (u.format) {
    case 'architectural': {
      const totalInches = meters / METERS_PER.in;
      const neg = totalInches < 0;
      const abs = Math.abs(totalInches);
      const den = u.fractionDenominator;
      // Redondear primero a la fracción para evitar 11 15/16" + 1/16" = 12"
      const roundedSixteenths = Math.round(abs * den);
      const roundedInches = roundedSixteenths / den;
      let feet = Math.floor(roundedInches / 12);
      let inches = roundedInches - feet * 12;
      if (Math.abs(inches - 12) < 1e-9) {
        feet += 1;
        inches = 0;
      }
      const parts: string[] = [];
      if (feet !== 0) parts.push(`${feet}'`);
      if (inches !== 0 || feet === 0) {
        parts.push(formatFractionalInches(inches, den, true));
      }
      const s = parts.join(' ');
      // Igual que arriba: -0.0001 m redondea a 0" y no debe salir como -0".
      return neg && roundedSixteenths !== 0 ? `-${s}` : s;
    }
    case 'engineering': {
      const feet = meters / METERS_PER.ft;
      return `${trimZeros(fixed(feet, u.precision))}${u.showUnit ? "'" : ''}`;
    }
    case 'fractional': {
      const inches = meters / METERS_PER.in;
      return formatFractionalInches(inches, u.fractionDenominator, u.showUnit);
    }
    case 'decimal':
    default: {
      const v = fromMeters(meters, u.unit);
      const s = trimZeros(fixed(v, u.precision));
      return u.showUnit ? `${s} ${UNIT_LABEL[u.unit]}`.replace(' "', '"').replace(" '", "'") : s;
    }
  }
}

/** Igual que `formatLength` pero sin el símbolo de unidad. */
export function formatLengthBare(meters: number, u: UnitSettings = DEFAULT_UNITS): string {
  return formatLength(meters, { ...u, showUnit: false });
}

/** Área en metros cuadrados → texto en la unidad activa al cuadrado. */
export function formatArea(m2: number, u: UnitSettings = DEFAULT_UNITS): string {
  const unit: LengthUnit = isImperial(u.unit) || u.format !== 'decimal' ? 'ft' : u.unit;
  const factor = METERS_PER[unit] * METERS_PER[unit];
  const v = m2 / factor;
  const label = unit === 'in' ? 'in²' : unit === 'ft' ? 'ft²' : `${unit}²`;
  return `${trimZeros(fixed(v, Math.max(2, u.precision)))} ${label}`;
}

/** Volumen en metros cúbicos → texto. */
export function formatVolume(m3: number, u: UnitSettings = DEFAULT_UNITS): string {
  const unit: LengthUnit = isImperial(u.unit) || u.format !== 'decimal' ? 'ft' : u.unit;
  const factor = METERS_PER[unit] ** 3;
  const v = m3 / factor;
  const label = unit === 'in' ? 'in³' : unit === 'ft' ? 'ft³' : `${unit}³`;
  return `${trimZeros(fixed(v, Math.max(2, u.precision)))} ${label}`;
}

/** Radianes → texto en grados. */
export function formatAngle(rad: number, u: UnitSettings = DEFAULT_UNITS): string {
  const deg = (rad * 180) / Math.PI;
  return `${trimZeros(fixed(deg, u.anglePrecision))}°`;
}

/** Texto para un vector de desplazamiento: "<1200; 0; 450>". */
export function formatVector(
  v: { x: number; y: number; z: number },
  u: UnitSettings = DEFAULT_UNITS,
): string {
  const f = (n: number) => formatLengthBare(n, u);
  return `⟨${f(v.x)}; ${f(v.y)}; ${f(v.z)}⟩`;
}

/**
 * Tamaño "redondo" de la cuadrícula para la unidad activa, en metros.
 * Se usa para dibujar la rejilla y para el snap opcional.
 */
export function niceGridStep(u: UnitSettings): number {
  switch (u.format) {
    case 'architectural':
    case 'fractional':
      return METERS_PER.in * 12; // 1 pie
    case 'engineering':
      return METERS_PER.ft;
    default:
      switch (u.unit) {
        case 'mm': return 0.01;   // 10 mm
        case 'cm': return 0.1;    // 10 cm
        case 'm': return 1;
        case 'km': return 100;
        case 'in': return METERS_PER.in;
        case 'ft': return METERS_PER.ft;
        case 'yd': return METERS_PER.yd;
      }
  }
}
