import { describe, it } from 'vitest';
import * as U from '../src/core/units';

describe('probe', () => {
  it('probe', () => {
    const mm: U.ParseLengthOptions = { defaultUnit: 'mm' };
    const cases = [
      '1200', '0', '-25', '1200mm', '120 cm', '1.2m', '1,2m', '0.0012km',
      '48in', '48"', '4ft', "4'", "5' 6\"", "5'6", '5 ft 6 in', '6 1/2"',
      '1/2"', '3ft 2in', '2yd', '', 'abc', '12xy', '1/0', '--3', '1 2 3',
      '  ', '+5', '1e3', '5\'', '5\' 6 1/2"', '0.5in', '-1/2"', '12,5',
      'm', '"', "'", '.5m', '5.', '1.2.3m', 'NaN', 'Infinity', '1 m 2',
      '2 pies', '3 pulgadas', '5 pies 6 pulgadas', '1 metro', '10 mm ',
    ];
    for (const c of cases) {
      console.log(JSON.stringify(c), '->', U.parseLength(c, mm));
    }
    console.log('--- lists ---');
    for (const c of ['2000;1000', '2000,1000', '1,5m', '3000;2000;1500', '', 'a;b', '2000;', '1,5', '1.5,2.5', '2000;abc', '1200']) {
      console.log(JSON.stringify(c), '->', JSON.stringify(U.parseLengthList(c, mm)));
    }
    console.log('--- angles ---');
    for (const c of ['45', '45°', '90 grados', '1.5708rad', '-30', 'abc', '', '0', '360', '1,5', '2r', '0.5 radianes', '45 deg', 'deg', '1/2']) {
      console.log(JSON.stringify(c), '->', U.parseAngle(c));
    }
    console.log('--- format decimal mm p1 ---');
    for (const v of [1.2, 0.0015, 0, -0.0254, 1234.5678, 1e-9, -1e-9]) {
      console.log(v, '->', JSON.stringify(U.formatLength(v, { ...U.DEFAULT_UNITS })), 'bare=', JSON.stringify(U.formatLengthBare(v)));
    }
    console.log('--- format architectural ---');
    const arch: U.UnitSettings = { ...U.DEFAULT_UNITS, format: 'architectural' };
    for (const v of [1.6764, 0.0254, 0.3048, 0.30479, 0.3047, 0, -1.6764, 0.1651, 0.0127, 0.9144, 0.001, 3.048]) {
      console.log(v, '->', JSON.stringify(U.formatLength(v, arch)));
    }
    console.log('--- fractional ---');
    const fr: U.UnitSettings = { ...U.DEFAULT_UNITS, format: 'fractional' };
    for (const v of [0.0127, 0.0254, 0.0254 * 1.5, 0.0254 * 0.5, 0.0254 * (3 + 8 / 16), 0.0254 * (3 + 4 / 16), 0, -0.0254 * 2.25, 1.6764]) {
      console.log(v, '->', JSON.stringify(U.formatLength(v, fr)), 'noUnit=', JSON.stringify(U.formatLength(v, { ...fr, showUnit: false })));
    }
    console.log('--- engineering ---');
    const eng: U.UnitSettings = { ...U.DEFAULT_UNITS, format: 'engineering', precision: 3 };
    for (const v of [0.3048, 1.6764, 0, -0.3048, 30.48]) {
      console.log(v, '->', JSON.stringify(U.formatLength(v, eng)), JSON.stringify(U.formatLength(v, { ...eng, showUnit: false })));
    }
    console.log('--- decimal units ---');
    for (const unit of ['mm', 'cm', 'm', 'km', 'in', 'ft', 'yd'] as U.LengthUnit[]) {
      const s: U.UnitSettings = { ...U.DEFAULT_UNITS, unit, precision: 3 };
      console.log(unit, JSON.stringify(U.formatLength(1.2, s)), 'grid=', U.niceGridStep(s));
    }
    console.log('--- area/vol/angle/vector ---');
    console.log(JSON.stringify(U.formatArea(1, U.DEFAULT_UNITS)));
    console.log(JSON.stringify(U.formatArea(1, { ...U.DEFAULT_UNITS, unit: 'm' })));
    console.log(JSON.stringify(U.formatArea(1, { ...U.DEFAULT_UNITS, unit: 'ft' })));
    console.log(JSON.stringify(U.formatArea(1, { ...U.DEFAULT_UNITS, unit: 'in' })));
    console.log(JSON.stringify(U.formatArea(1, { ...U.DEFAULT_UNITS, format: 'architectural' })));
    console.log(JSON.stringify(U.formatVolume(1, U.DEFAULT_UNITS)), JSON.stringify(U.formatVolume(1, { ...U.DEFAULT_UNITS, unit: 'm' })));
    console.log(JSON.stringify(U.formatAngle(Math.PI / 4)), JSON.stringify(U.formatAngle(0)), JSON.stringify(U.formatAngle(-Math.PI)));
    console.log(JSON.stringify(U.formatVector({ x: 1.2, y: 0, z: 0.45 })));
    console.log(JSON.stringify(U.formatLength(NaN)), JSON.stringify(U.formatLength(Infinity)));
  });
});
