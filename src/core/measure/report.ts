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

/** Descripción corta de un corte: «inglete 45° · bisel 30°». */
export function describeCut(cut: CutAngles, u: UnitSettings): string {
  const miter = `inglete ${formatAngle(Math.abs(cut.miter), u)}`;
  if (Math.abs(cut.bevel) < 1e-9) return miter;
  return `${miter} · bisel ${formatAngle(Math.abs(cut.bevel), u)}`;
}

/** Una línea con lo esencial de la unión, para la barra de estado. */
export function describeJoint(j: JointReport, u: UnitSettings): string {
  const parts: string[] = [`${KIND_LABEL[j.kind]}: ${formatAngle(j.angle, u)}`];

  const [a, b] = j.cuts;
  const sameMiter = Math.abs(Math.abs(a.miter) - Math.abs(b.miter)) < 1e-9;
  const sameBevel = Math.abs(Math.abs(a.bevel) - Math.abs(b.bevel)) < 1e-9;

  if (j.kind === 'cruce') {
    parts.push(`ejes a ${formatAngle(j.axisAngle, u)}`);
  } else if (sameMiter) {
    parts.push(`inglete ${formatAngle(Math.abs(a.miter), u)} en las dos piezas`);
  } else {
    parts.push(`inglete ${formatAngle(Math.abs(a.miter), u)} y ${formatAngle(Math.abs(b.miter), u)}`);
  }

  if (a.compound || b.compound) {
    parts.push(sameBevel
      ? `bisel ${formatAngle(Math.abs(a.bevel), u)}`
      : `bisel ${formatAngle(Math.abs(a.bevel), u)} y ${formatAngle(Math.abs(b.bevel), u)}`);
  }

  if (j.gap > 1e-6) parts.push(`separación ${formatLength(j.gap, u)}`);
  return parts.join(' · ');
}

/** Descripción de una pieza: «2×4 · 2,40 m». */
export function describeMember(m: Member, u: UnitSettings): string {
  const nominal = nominalSection(m.thickness, m.width);
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
    value: j.sameFacePlane ? 'sí (corte sin bisel)' : 'no (corte compuesto)',
  });

  const names = ['Pieza 1', 'Pieza 2'];
  for (let i = 0; i < 2; i++) {
    const m = members[i];
    if (m) lines.push({ label: `${names[i]}`, value: describeMember(m, u) });
    lines.push({ label: `${names[i]} · corte`, value: cutDetail(j.cuts[i], u) });
  }
  return lines;
}

function cutDetail(cut: MemberCut, u: UnitSettings): string {
  const parts = [
    `inglete ${formatAngle(Math.abs(cut.miter), u)}`,
    `bisel ${formatAngle(Math.abs(cut.bevel), u)}`,
    `${formatAngle(cut.toAxis, u)} respecto al canto`,
  ];
  if (!cut.end) parts.push('el nudo no cae en una testa');
  return parts.join(' · ');
}
