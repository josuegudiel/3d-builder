import { BaseTool } from './base';
import { PointerInfo } from '../app/editor';
import { Overlay } from '../render/overlay';
import { THEME } from '../render/theme';
import { Vec3, v3, sub, cross, normalize, lengthSq, addScaled, midpoint } from '../core/math/vec';
import { EPS } from '../core/math/tolerance';
import { Id } from '../core/model/types';
import { pickEntity } from '../pick/picker';
import { formatAngle, formatLength } from '../core/units';
import {
  dihedralAngle, angleBetweenEdges, lineAngle, planeAngle, cutAngles, miterPlaneNormal,
  faceEdgeDirection,
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
  readonly statusHint = 'Señala una arista para ver su diedro, o elige dos elementos para medir el ángulo. Con Ctrl, el segundo clic deja puesta la cota.';

  private first: Target | null = null;

  override activate(): void {
    super.activate();
    this.first = null;
    this.editor.setStatus(this.statusHint);
  }

  override onPointerMove(e: PointerInfo): void {
    const hit = this.pick(e);
    this.setHovered(hit ? { kind: hit.kind, id: hit.id } : null);

    const first = this.validFirst();
    if (!first) {
      this.editor.showMeasurement('Ángulo', hit ? this.singleReading(hit) : '', false);
      return;
    }
    if (hit) {
      const text = this.pairReading(first, hit);
      this.editor.showMeasurement('Ángulo', text ?? '', false);
    }
    this.editor.refreshOverlay();
  }

  override onPointerDown(e: PointerInfo): void {
    if (e.button !== 0) return;
    const hit = this.pick(e);
    if (!hit) return;

    const first = this.validFirst();
    if (!first) {
      this.first = hit;
      const single = this.singleReading(hit);
      this.editor.setStatus(single
        ? `${single}. Elige el segundo elemento; con Ctrl se queda la cota puesta.`
        : 'Elige el segundo elemento.');
      this.editor.refreshOverlay();
      return;
    }

    if (hit.kind === first.kind && hit.id === first.id) return;

    const text = this.pairReading(first, hit);
    if (text) {
      this.editor.setStatus(text);
      // La cota permanente sólo se crea si se pide: medir no debe ensuciar el
      // modelo con anotaciones que el usuario no ha decidido poner.
      if (e.ctrlKey) this.placeDimension(first, hit);
    } else {
      this.editor.setStatus('No se puede medir el ángulo entre esos dos elementos.');
    }
    this.first = null;
    this.setHovered(null);
    this.editor.refreshOverlay();
  }

  /**
   * Primer elemento elegido, sólo si sigue existiendo. Deshacer o borrar puede
   * habérselo llevado, y guardar un identificador muerto hacía que fallara cada
   * redibujado y, con él, cualquier operación posterior.
   */
  private validFirst(): Target | null {
    const first = this.first;
    if (!first) return null;
    if (this.exists(first)) return first;
    this.first = null;
    return null;
  }

  private exists(t: Target): boolean {
    const geo = this.editor.geometry;
    if (t.kind === 'edge') return geo.edges.has(t.id);
    if (t.kind === 'face') return geo.faces.has(t.id);
    return geo.instances.has(t.id);
  }

  override cancel(): void {
    this.first = null;
    super.cancel();
  }

  // -------------------------------------------------------------------------

  override busy(): boolean {
    return this.first !== null;
  }

  /** Consulta memorizada: ¿es la cara parte de un sólido cerrado? */
  private readonly solidOf = (faceId: Id): boolean => this.editor.shellOf(faceId);

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
      if (!geo.edges.has(t.id)) return '';
      const d = dihedralAngle(geo, t.id, this.solidOf);
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
      if (!geo.edges.has(a.id) || !geo.edges.has(b.id)) return null;
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
          const d = dihedralAngle(geo, e, this.solidOf);
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
      if (!geo.edges.has(t.id)) return null;
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
      if (!geo.edges.has(a.id) || !geo.edges.has(b.id)) return;
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

    if (a.kind === 'face' && b.kind === 'face') {
      // Dos caras que comparten arista: la cota va en el punto medio de esa
      // arista, con un lado dentro de cada cara.
      for (const eid of geo.faceEdges(a.id)) {
        if (!geo.edgeFaces.get(eid)?.has(b.id)) continue;
        const [p, q] = geo.edgeEndpoints(eid);
        const centre = this.world(midpoint(p, q));
        const dirA = this.inwardDir(a.id, eid);
        const dirB = this.inwardDir(b.id, eid);
        if (!dirA || !dirB) return;
        const r = Math.max(EPS * 10, geo.edgeLength(eid) * 0.3);
        const pa = addScaled(centre, this.editor.toWorldVector(dirA), r);
        const pb = addScaled(centre, this.editor.toWorldVector(dirB), r);
        this.editor.edit('Cota angular', () => {
          this.editor.model.addAngleDimension(
            this.editor.toRoot(centre), this.editor.toRoot(pa), this.editor.toRoot(pb), r,
          );
        });
        return;
      }
      this.editor.setStatus('Las dos caras no comparten arista: no hay dónde poner la cota.');
      return;
    }

    if (a.kind === 'instance' && b.kind === 'instance') {
      const ma = measureInstance(this.editor.model, geo, a.id);
      const mb = measureInstance(this.editor.model, geo, b.id);
      if (!ma || !mb) return;
      const j = analyseJoint(ma, mb);
      const r = Math.max(EPS * 10, Math.min(ma.length, mb.length) * 0.25);
      const vertex = this.world(j.point);
      const pa = addScaled(vertex, this.editor.toWorldVector(j.directions[0]), r);
      const pb = addScaled(vertex, this.editor.toWorldVector(j.directions[1]), r);
      this.editor.edit('Cota angular', () => {
        this.editor.model.addAngleDimension(
          this.editor.toRoot(vertex), this.editor.toRoot(pa), this.editor.toRoot(pb), r,
        );
      });
    }
  }

  /** Dirección que entra en la cara desde una de sus aristas, en el plano. */
  private inwardDir(faceId: Id, edgeId: Id): Vec3 | null {
    const geo = this.editor.geometry;
    const f = geo.faces.get(faceId);
    const d = faceEdgeDirection(geo, faceId, edgeId);
    if (!f || !d) return null;
    const inward = cross(f.plane.n, d);
    return lengthSq(inward) > 0 ? normalize(inward) : null;
  }

  override drawOverlay(overlay: Overlay): void {
    this.drawHover(overlay);
    const geo = this.editor.geometry;
    const first = this.validFirst();
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
  solidOf?: (faceId: Id) => boolean,
): string | null {
  if (edges.some((e) => !geo.edges.has(e)) || faces.some((f) => !geo.faces.has(f))) return null;

  if (edges.length === 1 && faces.length === 0) {
    const d = dihedralAngle(geo, edges[0], solidOf);
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
        const d = dihedralAngle(geo, e, solidOf);
        if (d) return `Diedro ${formatAngle(d.angle, units)}`;
      }
    }
    return `Entre planos ${formatAngle(planeAngle(fa.plane, fb.plane), units)}`;
  }
  return null;
}
