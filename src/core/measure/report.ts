import { UnitSettings, formatAngle, formatLength } from '../units';
import { CutAngles } from './angles';
import { JointReport, Member, MemberCut, nominalSection } from './member';

/**
 * Textos de las medidas angulares.
 *
 * Están aquí, y no en la interfaz, porque las pruebas comprueban exactamente lo
 * que va a leer el usuario: si la cuenta cambia, la prueba lo ve.
 */

const KIND_LABEL: Record<JointReport['kind'], string> = {
  esquina: 'Esquina',
  te: 'Unión en te',
  cruce: 'Cruce',
  prolongación: 'Prolongación',
  suelto: 'Piezas sueltas',
};

const STYLE_LABEL: Record<MemberCut['style'], string> = {
  inglete: 'a inglete',
  tope: 'a tope',
  escuadra: 'a escuadra',
};

/** Un ángulo por debajo de esto se considera nulo al redactar. */
const NIL = 1e-9;

/** Descripción corta de un corte: «inglete 45° · bisel 30°». */
export function describeCut(cut: CutAngles, u: UnitSettings): string {
  const miter = `inglete ${formatAngle(Math.abs(cut.miter), u)}`;
  if (Math.abs(cut.bevel) < NIL) return miter;
  return `${miter} · bisel ${formatAngle(Math.abs(cut.bevel), u)}`;
}

/** Una línea con lo esencial de la unión, para la barra de estado. */
export function describeJoint(j: JointReport, u: UnitSettings): string {
  const parts: string[] = [`${KIND_LABEL[j.kind]}: ${formatAngle(j.angle, u)}`];

  const [a, b] = j.cuts;
  const cuts = [a, b].filter((c): c is MemberCut => c !== null);

  if (j.kind === 'cruce' || cuts.length === 0) {
    parts.push(`ejes a ${formatAngle(j.axisAngle, u)}`);
    if (j.kind === 'cruce') parts.push('las piezas se cruzan, no hay corte');
  } else if (cuts.length === 1) {
    // Unión en te: sólo se corta la pieza que llega.
    parts.push(`corte ${STYLE_LABEL[cuts[0].style]}: ${describeCut(cuts[0], u)}`);
  } else {
    const sameMiter = Math.abs(Math.abs(a!.miter) - Math.abs(b!.miter)) < NIL;
    parts.push(sameMiter
      ? `inglete ${formatAngle(Math.abs(a!.miter), u)} en las dos piezas`
      : `inglete ${formatAngle(Math.abs(a!.miter), u)} y ${formatAngle(Math.abs(b!.miter), u)}`);

    // El bisel se anuncia si lo hay, aunque el inglete sea nulo: un corte de
    // bisel puro es un corte inclinado y callarlo sería un error de taller.
    const bevels = cuts.map((c) => Math.abs(c.bevel));
    if (bevels.some((x) => x >= NIL)) {
      const sameBevel = Math.abs(bevels[0] - bevels[1]) < NIL;
      parts.push(sameBevel
        ? `bisel ${formatAngle(bevels[0], u)} en las dos piezas`
        : `bisel ${formatAngle(bevels[0], u)} y ${formatAngle(bevels[1], u)}`);
    }
  }

  if (j.gap > 1e-6) parts.push(`separación ${formatLength(j.gap, u)}`);
  return parts.join(' · ');
}

/**
 * Descripción de una pieza: «2×4 · 2,40 m».
 *
 * El nombre comercial sólo se usa si la pieza es alargada: un cubo de 89 mm
 * tiene la sección de un 4×4 y no es un 4×4.
 */
export function describeMember(m: Member, u: UnitSettings): string {
  const nominal = m.length >= 3 * m.width ? nominalSection(m.thickness, m.width) : null;
  const section = nominal
    ? `${nominal} (${formatLength(m.thickness, u)} × ${formatLength(m.width, u)})`
    : `${formatLength(m.thickness, u)} × ${formatLength(m.width, u)}`;
  return `${section} · ${formatLength(m.length, u)}`;
}

export interface ReportLine {
  label: string;
  value: string;
}

/** Informe detallado de una unión, en líneas de etiqueta y valor. */
export function jointLines(
  j: JointReport,
  members: [Member | null, Member | null],
  u: UnitSettings,
): ReportLine[] {
  const lines: ReportLine[] = [
    { label: 'Tipo de unión', value: KIND_LABEL[j.kind] },
    { label: 'Ángulo entre piezas', value: formatAngle(j.angle, u) },
    { label: 'Suplementario', value: formatAngle(j.supplement, u) },
    { label: 'Ángulo entre ejes', value: formatAngle(j.axisAngle, u) },
  ];
  if (j.gap > 1e-6) {
    lines.push({ label: 'Separación entre ejes', value: formatLength(j.gap, u) });
  }
  lines.push({
    label: 'Caras en el mismo plano',
    value: j.sameFacePlane ? 'sí' : 'no',
  });

  const names = ['Pieza 1', 'Pieza 2'];
  for (let i = 0; i < 2; i++) {
    const m = members[i];
    if (m) lines.push({ label: names[i], value: describeMember(m, u) });
    const cut = j.cuts[i];
    lines.push({
      label: `${names[i]} · corte`,
      value: cut ? cutDetail(cut, u) : 'no se corta',
    });
  }
  return lines;
}

function cutDetail(cut: MemberCut, u: UnitSettings): string {
  return [
    `corte ${STYLE_LABEL[cut.style]}`,
    `inglete ${formatAngle(Math.abs(cut.miter), u)}`,
    `bisel ${formatAngle(Math.abs(cut.bevel), u)}`,
    `${formatAngle(cut.toAxis, u)} respecto al canto`,
  ].join(' · ');
}
