import { BaseTool } from './base';
import { PointerInfo } from '../app/editor';
import { Overlay } from '../render/overlay';
import { THEME } from '../render/theme';
import { Vec3, v3, sub, cross, normalize, lengthSq, addScaled } from '../core/math/vec';
import { EPS } from '../core/math/tolerance';
import { Id } from '../core/model/types';
import { pickEntity } from '../pick/picker';
import { formatAngle, formatLength } from '../core/units';
import {
  dihedralAngle, angleBetweenEdges, lineAngle, planeAngle, cutAngles, miterPlaneNormal,
} from '../core/measure/angles';
import { measureInstance, analyseJoint } from '../core/measure/member';
import { describeJoint } from '../core/measure/report';

type Target =
  | { kind: 'edge'; id: Id }
  | { kind: 'face'; id: Id }
  | { kind: 'instance'; id: Id };

/**
 * Herramienta Ángulo.
 *
 * Mide el ángulo de lo que se le señale, con la lectura que tiene sentido en
 * cada caso:
 *
 *  - Una arista sola: su ángulo diedro, medido por dentro del material.
 *  - Dos aristas: el ángulo que forman, y si salen del mismo vértice deja
 *    puesta una cota angular.
 *  - Dos caras: el ángulo entre sus planos, y el diedro real si comparten
 *    arista.
 *  - Dos piezas (grupos o sólidos): el análisis completo de la unión, con el
 *    inglete y el bisel con que hay que cortar cada una.
 */
export class AngleTool extends BaseTool {
  readonly id = 'angle';
  readonly name = 'Ángulo';
  readonly statusHint = 'Señala una arista para ver su diedro, o elige dos elementos para medir el ángulo entre ellos.';

  private first: Target | null = null;

  override activate(): void {
    super.activate();
    this.first = null;
    this.editor.setStatus(this.statusHint);
  }

  override onPointerMove(e: PointerInfo): void {
    const hit = this.pick(e);
    this.setHovered(hit ? { kind: hit.kind, id: hit.id } : null);

    if (!this.first) {
      this.editor.showMeasurement('Ángulo', hit ? this.singleReading(hit) : '', false);
      return;
    }
    if (hit) {
      const text = this.pairReading(this.first, hit);
      this.editor.showMeasurement('Ángulo', text ?? '', false);
    }
    this.editor.refreshOverlay();
  }

  override onPointerDown(e: PointerInfo): void {
    if (e.button !== 0) return;
    const hit = this.pick(e);
    if (!hit) return;

    if (!this.first) {
      this.first = hit;
      const single = this.singleReading(hit);
      this.editor.setStatus(single
        ? `${single}. Elige el segundo elemento para medir el ángulo entre los dos.`
        : 'Elige el segundo elemento.');
      this.editor.refreshOverlay();
      return;
    }

    if (hit.kind === this.first.kind && hit.id === this.first.id) return;

    const text = this.pairReading(this.first, hit);
    if (text) {
      this.editor.setStatus(text);
      this.placeDimension(this.first, hit);
    } else {
      this.editor.setStatus('No se puede medir el ángulo entre esos dos elementos.');
    }
    this.first = null;
    this.setHovered(null);
    this.editor.refreshOverlay();
  }

  override cancel(): void {
    this.first = null;
    super.cancel();
  }

  // -------------------------------------------------------------------------

  private pick(e: PointerInfo): Target | null {
    const hit = pickEntity(
      this.editor.viewport.builder.pick, this.editor.viewport, e.clientX, e.clientY,
      { vertices: false },
    );
    if (!hit) return null;
    if (hit.kind === 'edge' || hit.kind === 'face' || hit.kind === 'instance') {
      return { kind: hit.kind, id: hit.id };
    }
    return null;
  }

  /** Lectura de un solo elemento. */
  private singleReading(t: Target): string {
    const geo = this.editor.geometry;
    const u = this.editor.units;

    if (t.kind === 'edge') {
      const d = dihedralAngle(geo, t.id);
      if (d) return `Diedro ${formatAngle(d.angle, u)}`;
      return `Arista de ${formatLength(geo.edgeLength(t.id), u)}`;
    }
    if (t.kind === 'face') {
      const f = geo.faces.get(t.id);
      if (!f) return '';
      const n = this.editor.toWorldVector(f.plane.n);
      const tilt = Math.PI / 2 - lineAngle(n, v3(0, 0, 1));
      return `Cara inclinada ${formatAngle(tilt, u)} respecto a la horizontal`;
    }
    const m = measureInstance(this.editor.model, geo, t.id);
    if (!m) return '';
    return `Pieza de ${formatLength(m.length, u)}`;
  }

  /** Lectura de la pareja. Devuelve null si no se puede medir. */
  private pairReading(a: Target, b: Target): string | null {
    const geo = this.editor.geometry;
    const u = this.editor.units;

    if (a.kind === 'edge' && b.kind === 'edge') {
      const shared = angleBetweenEdges(geo, a.id, b.id);
      if (shared) {
        return `Ángulo ${formatAngle(shared.angle, u)} · suplementario ${formatAngle(Math.PI - shared.angle, u)}`;
      }
      const [p0, p1] = geo.edgeEndpoints(a.id);
      const [q0, q1] = geo.edgeEndpoints(b.id);
      const ang = lineAngle(sub(p1, p0), sub(q1, q0));
      return `Aristas a ${formatAngle(ang, u)} (no se cortan)`;
    }

    if (a.kind === 'face' && b.kind === 'face') {
      const fa = geo.faces.get(a.id);
      const fb = geo.faces.get(b.id);
      if (!fa || !fb) return null;
      // Si comparten arista, el diedro real es la lectura correcta.
      for (const e of geo.faceEdges(a.id)) {
        const users = geo.edgeFaces.get(e);
        if (users?.has(b.id)) {
          const d = dihedralAngle(geo, e);
          if (d) return `Diedro ${formatAngle(d.angle, u)} · entre planos ${formatAngle(planeAngle(fa.plane, fb.plane), u)}`;
        }
      }
      return `Entre planos ${formatAngle(planeAngle(fa.plane, fb.plane), u)}`;
    }

    if (a.kind === 'instance' && b.kind === 'instance') {
      const ma = measureInstance(this.editor.model, geo, a.id);
      const mb = measureInstance(this.editor.model, geo, b.id);
      if (!ma || !mb) return null;
      return describeJoint(analyseJoint(ma, mb), u);
    }

    // Combinaciones mixtas: se comparan las direcciones características.
    const da = this.directionOf(a);
    const db = this.directionOf(b);
    if (!da || !db) return null;
    if (a.kind === 'face' || b.kind === 'face') {
      // Con una cara implicada interesa el ángulo respecto al plano.
      const faceDir = a.kind === 'face' ? da : db;
      const other = a.kind === 'face' ? db : da;
      const ang = Math.PI / 2 - lineAngle(faceDir, other);
      return `Recta y plano a ${formatAngle(ang, u)}`;
    }
    return `Direcciones a ${formatAngle(lineAngle(da, db), u)}`;
  }

  /** Dirección característica: la arista, la normal de la cara o el eje. */
  private directionOf(t: Target): Vec3 | null {
    const geo = this.editor.geometry;
    if (t.kind === 'edge') {
      const [p, q] = geo.edgeEndpoints(t.id);
      const d = sub(q, p);
      return lengthSq(d) > 0 ? normalize(d) : null;
    }
    if (t.kind === 'face') {
      const f = geo.faces.get(t.id);
      return f ? f.plane.n : null;
    }
    const m = measureInstance(this.editor.model, geo, t.id);
    return m ? m.axis : null;
  }

  /**
   * Deja puesta una cota angular cuando la medida tiene un vértice claro: dos
   * aristas que se tocan, o dos piezas con un nudo.
   */
  private placeDimension(a: Target, b: Target): void {
    const geo = this.editor.geometry;

    if (a.kind === 'edge' && b.kind === 'edge') {
      const shared = angleBetweenEdges(geo, a.id, b.id);
      if (!shared) return;
      const vertex = this.world(geo.vertexPos(shared.vertex));
      const la = geo.edgeLength(a.id);
      const lb = geo.edgeLength(b.id);
      const r = Math.max(EPS * 10, Math.min(la, lb) * 0.4);
      const pa = addScaled(vertex, this.editor.toWorldVector(shared.dirs[0]), r);
      const pb = addScaled(vertex, this.editor.toWorldVector(shared.dirs[1]), r);
      this.editor.edit('Cota angular', () => {
        this.editor.model.addAngleDimension(
          this.editor.toRoot(vertex), this.editor.toRoot(pa), this.editor.toRoot(pb), r,
        );
      });
      return;
    }

    if (a.kind === 'instance' && b.kind === 'instance') {
      const ma = measureInstance(this.editor.model, geo, a.id);
      const mb = measureInstance(this.editor.model, geo, b.id);
      if (!ma || !mb) return;
      const j = analyseJoint(ma, mb);
      const r = Math.max(EPS * 10, Math.min(ma.length, mb.length) * 0.25);
      const vertex = this.world(j.point);
      const pa = addScaled(vertex, this.editor.toWorldVector(j.cuts[0].outward), r);
      const pb = addScaled(vertex, this.editor.toWorldVector(j.cuts[1].outward), r);
      this.editor.edit('Cota angular', () => {
        this.editor.model.addAngleDimension(
          this.editor.toRoot(vertex), this.editor.toRoot(pa), this.editor.toRoot(pb), r,
        );
      });
    }
  }

  override drawOverlay(overlay: Overlay): void {
    this.drawHover(overlay);
    const geo = this.editor.geometry;
    const first = this.first;
    if (!first) return;

    if (first.kind === 'edge') {
      const [p, q] = geo.edgeEndpoints(first.id);
      overlay.addLine(this.world(p), this.world(q), THEME.selection);
    } else if (first.kind === 'face') {
      const f = geo.faces.get(first.id);
      if (f) {
        for (const loop of f.loops) {
          overlay.addPolyline(loop.vertices.map((v) => this.world(geo.vertexPos(v))), THEME.selection, true);
        }
      }
    } else {
      const m = measureInstance(this.editor.model, geo, first.id);
      if (m) overlay.addLine(this.world(m.ends[0]), this.world(m.ends[1]), THEME.selection, true);
    }
  }
}

/**
 * Ángulo diedro de la arista bajo el cursor, para el panel de información.
 * Se expone aparte porque la interfaz también lo usa sin la herramienta activa.
 */
export function selectionAngleSummary(
  geo: Parameters<typeof dihedralAngle>[0],
  edges: readonly Id[],
  faces: readonly Id[],
  units: Parameters<typeof formatAngle>[1],
): string | null {
  if (edges.length === 1 && faces.length === 0) {
    const d = dihedralAngle(geo, edges[0]);
    return d ? `Diedro ${formatAngle(d.angle, units)}` : null;
  }
  if (edges.length === 2 && faces.length === 0) {
    const shared = angleBetweenEdges(geo, edges[0], edges[1]);
    if (shared) {
      const cut = cutAngles(
        miterPlaneNormal(shared.dirs[0], shared.dirs[1]) ?? shared.dirs[0],
        { axis: shared.dirs[0], faceNormal: normalize(cross(shared.dirs[0], shared.dirs[1])) },
      );
      return `Ángulo ${formatAngle(shared.angle, units)} · inglete ${formatAngle(Math.abs(cut.miter), units)}`;
    }
    const [p0, p1] = geo.edgeEndpoints(edges[0]);
    const [q0, q1] = geo.edgeEndpoints(edges[1]);
    return `Aristas a ${formatAngle(lineAngle(sub(p1, p0), sub(q1, q0)), units)}`;
  }
  if (faces.length === 2 && edges.length === 0) {
    const fa = geo.faces.get(faces[0]);
    const fb = geo.faces.get(faces[1]);
    if (!fa || !fb) return null;
    for (const e of geo.faceEdges(faces[0])) {
      if (geo.edgeFaces.get(e)?.has(faces[1])) {
        const d = dihedralAngle(geo, e);
        if (d) return `Diedro ${formatAngle(d.angle, units)}`;
      }
    }
    return `Entre planos ${formatAngle(planeAngle(fa.plane, fb.plane), units)}`;
  }
  return null;
}
