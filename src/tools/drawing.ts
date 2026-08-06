import { BaseTool } from './base';
import { PointerInfo } from '../app/editor';
import { Overlay } from '../render/overlay';
import { THEME } from '../render/theme';
import {
  Vec3, sub, add, mul, dot, cross, normalize, length, distance, addScaled, v3,
} from '../core/math/vec';
import { Plane, planeFromPointNormal } from '../core/math/plane';
import { EPS } from '../core/math/tolerance';
import { drawPolyline } from '../core/ops/draw';
import {
  frameFromNormal, rectanglePoints, rectangleFromSize, circlePoints, polygonPoints,
  bulgeArcPoints, arcFrom3Points, PlaneFrame,
} from '../core/ops/primitives';
import { formatLength, parseLength, parseLengthList } from '../core/units';
import { orientFacesConsistently } from '../core/topology/orient';

/** Base para las herramientas que dibujan sobre un plano de trabajo. */
abstract class DrawingTool extends BaseTool {
  /** Puntos ya fijados, en coordenadas del mundo. */
  protected points: Vec3[] = [];
  /** Punto que sigue al cursor. */
  protected preview: Vec3 | null = null;

  /** Dirección hacia la cámara, en el espacio del contexto (para orientar caras). */
  protected orientToward(): Vec3 {
    return this.editor.toContextVector(mul(this.editor.viewport.cameraCtl.forward, -1));
  }

  /** Inserta una polilínea en la geometría del contexto activo. */
  protected commit(worldPoints: readonly Vec3[], closed: boolean, label: string): void {
    if (worldPoints.length < 2) return;
    const local = worldPoints.map((p) => this.local(p));
    this.editor.edit(label, () => {
      const r = drawPolyline(this.editor.geometry, local, closed, {
        orientToward: this.orientToward(),
      });
      orientFacesConsistently(this.editor.geometry, r.rebuild.created);
    });
  }

  /** Plano de trabajo deducido del primer punto. */
  protected planeFromFirstPoint(): Plane {
    if (this.workPlane) return this.workPlane;
    const p = this.points[0] ?? v3(0, 0, 0);
    return planeFromPointNormal(p, v3(0, 0, 1));
  }

  protected frame(hintU?: Vec3): PlaneFrame {
    const plane = this.planeFromFirstPoint();
    return frameFromNormal(this.points[0] ?? v3(0, 0, 0), plane.n, hintU);
  }

  override cancel(): void {
    this.points = [];
    this.preview = null;
    super.cancel();
  }

  override onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.cancel();
      return true;
    }
    return super.onKeyDown(e);
  }
}

// ---------------------------------------------------------------------------
// Línea
// ---------------------------------------------------------------------------

/**
 * Herramienta Línea: cadena de segmentos con inferencia y longitud exacta.
 * Cada segmento se crea al hacer clic; la cadena continúa hasta pulsar Escape,
 * Intro o hacer doble clic.
 */
export class LineTool extends DrawingTool {
  readonly id = 'line';
  readonly name = 'Línea';
  readonly statusHint = 'Clic para el primer punto. Escribe una longitud y pulsa Intro para fijarla. Escape termina.';

  override onPointerMove(e: PointerInfo): void {
    const hit = this.updateInference(e);
    this.preview = hit.point;
    if (this.points.length > 0) {
      const d = distance(this.points[this.points.length - 1], hit.point);
      this.editor.showMeasurement('Longitud', formatLength(d, this.editor.units));
    }
    this.editor.refreshOverlay();
  }

  override onPointerDown(e: PointerInfo): void {
    if (e.button !== 0) return;
    const hit = this.updateInference(e);
    this.addPoint(hit.point);
  }

  private addPoint(p: Vec3): void {
    const last = this.points[this.points.length - 1];
    if (last && distance(last, p) <= EPS) return;

    if (last) {
      this.commit([last, p], false, 'Línea');
      // ¿Se ha cerrado el recorrido?
      if (this.points.length >= 2 && distance(p, this.points[0]) <= EPS) {
        this.points = [];
        this.anchor = null;
        this.referenceDirection = null;
        this.editor.showMeasurement('', '', false);
        this.editor.refreshOverlay();
        return;
      }
      this.referenceDirection = normalize(sub(p, last));
    }

    this.points.push(p);
    this.anchor = p;
    if (this.points.length === 1 && this.hit?.plane) this.workPlane = this.hit.plane;
    this.editor.refreshOverlay();
  }

  override onDoubleClick(): void {
    this.cancel();
  }

  override onMeasurement(text: string): boolean {
    const last = this.points[this.points.length - 1];
    if (!last || !this.preview) return false;
    const value = parseLength(text, { defaultUnit: this.editor.units.unit });
    if (value === null || Math.abs(value) <= EPS) return false;
    const dir = sub(this.preview, last);
    if (length(dir) <= EPS) return false;
    const target = addScaled(last, normalize(dir), value);
    this.addPoint(target);
    return true;
  }

  override onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Enter' && this.points.length > 0) {
      this.cancel();
      return true;
    }
    return super.onKeyDown(e);
  }

  override drawOverlay(overlay: Overlay): void {
    this.drawInference(overlay);
    const last = this.points[this.points.length - 1];
    if (last && this.preview) {
      overlay.addLine(last, this.preview, THEME.selection);
    }
  }
}

// ---------------------------------------------------------------------------
// Rectángulo
// ---------------------------------------------------------------------------

/** Herramienta Rectángulo: dos esquinas opuestas sobre el plano de trabajo. */
export class RectangleTool extends DrawingTool {
  readonly id = 'rectangle';
  readonly name = 'Rectángulo';
  readonly statusHint = 'Clic en una esquina y luego en la opuesta. Escribe "ancho;alto" para medidas exactas.';

  private corners: Vec3[] = [];

  override onPointerMove(e: PointerInfo): void {
    const hit = this.updateInference(e);
    this.preview = hit.point;
    if (this.points.length === 1) {
      const frame = this.frame();
      this.corners = rectanglePoints(frame, this.points[0], hit.point);

      // Las medidas se sacan proyectando el desplazamiento sobre los ejes del
      // marco, no de las esquinas: cuando la inferencia engancha el cursor a un
      // eje, uno de los lados vale cero y el generador devuelve una lista vacía
      // (no hay rectángulo que dibujar), pero el cuadro de medidas debe seguir
      // funcionando para poder escribir las dimensiones exactas.
      const rel = sub(hit.point, this.points[0]);
      const w = Math.abs(dot(rel, frame.u));
      const h = Math.abs(dot(rel, frame.v));
      this.editor.showMeasurement(
        'Medidas',
        `${formatLength(w, this.editor.units)} ; ${formatLength(h, this.editor.units)}`,
      );
    }
    this.editor.refreshOverlay();
  }

  override onPointerDown(e: PointerInfo): void {
    if (e.button !== 0) return;
    const hit = this.updateInference(e);

    if (this.points.length === 0) {
      this.points.push(hit.point);
      this.anchor = hit.point;
      this.workPlane = hit.plane ?? planeFromPointNormal(hit.point, v3(0, 0, 1));
      return;
    }

    const pts = rectanglePoints(this.frame(), this.points[0], hit.point);
    if (pts.length === 4 && distance(pts[0], pts[2]) > EPS) {
      this.commit(pts, true, 'Rectángulo');
    }
    this.cancel();
  }

  override onMeasurement(text: string): boolean {
    if (this.points.length !== 1) return false;
    const values = parseLengthList(text, { defaultUnit: this.editor.units.unit });
    if (!values || values.length < 2) return false;
    const frame = this.frame();
    // Se conserva el cuadrante hacia el que se estaba arrastrando.
    let signU = 1;
    let signV = 1;
    if (this.preview) {
      const rel = sub(this.preview, this.points[0]);
      signU = dot(rel, frame.u) >= 0 ? 1 : -1;
      signV = dot(rel, frame.v) >= 0 ? 1 : -1;
    }
    const pts = rectangleFromSize(frame, this.points[0], values[0] * signU, values[1] * signV);
    if (pts.length !== 4) return false;
    this.commit(pts, true, 'Rectángulo');
    this.cancel();
    return true;
  }

  override cancel(): void {
    this.corners = [];
    super.cancel();
  }

  override drawOverlay(overlay: Overlay): void {
    this.drawInference(overlay);
    if (this.corners.length === 4) {
      overlay.addPolyline(this.corners, THEME.selection, true);
      overlay.addGhostPolygon(this.corners, THEME.selectionFace);
    }
  }
}

// ---------------------------------------------------------------------------
// Círculo y polígono
// ---------------------------------------------------------------------------

/** Base común de círculo y polígono regular. */
abstract class RadialTool extends DrawingTool {
  protected sides = 24;
  protected ring: Vec3[] = [];
  protected radius = 0;
  /** true: el radio llega a los vértices; false: a los puntos medios. */
  protected inscribed = true;

  protected abstract buildRing(center: Vec3, normal: Vec3, radius: number, startDir?: Vec3): Vec3[];

  override onPointerMove(e: PointerInfo): void {
    const hit = this.updateInference(e);
    this.preview = hit.point;
    if (this.points.length === 1) {
      const plane = this.planeFromFirstPoint();
      const center = this.points[0];
      const rel = sub(hit.point, center);
      const flat = sub(rel, mul(plane.n, dot(rel, plane.n)));
      this.radius = length(flat);
      if (this.radius > EPS) {
        this.ring = this.buildRing(center, plane.n, this.radius, normalize(flat));
      }
      this.editor.showMeasurement('Radio', formatLength(this.radius, this.editor.units));
    } else {
      this.editor.showMeasurement('Lados', String(this.sides));
    }
    this.editor.refreshOverlay();
  }

  override onPointerDown(e: PointerInfo): void {
    if (e.button !== 0) return;
    const hit = this.updateInference(e);

    if (this.points.length === 0) {
      this.points.push(hit.point);
      this.anchor = hit.point;
      this.workPlane = hit.plane ?? planeFromPointNormal(hit.point, v3(0, 0, 1));
      return;
    }

    if (this.ring.length >= 3) {
      this.commit(this.ring, true, this.name);
    }
    this.cancel();
  }

  override onMeasurement(text: string): boolean {
    // "24s" o "24l" fija el número de lados en cualquier momento.
    const sidesMatch = /^(\d+)\s*(s|l|lados|sides)$/i.exec(text.trim());
    if (sidesMatch) {
      const n = parseInt(sidesMatch[1], 10);
      if (n >= 3 && n <= 512) {
        this.sides = n;
        if (this.points.length === 1 && this.radius > EPS) {
          const plane = this.planeFromFirstPoint();
          this.ring = this.buildRing(this.points[0], plane.n, this.radius);
        }
        this.editor.refreshOverlay();
        return true;
      }
      return false;
    }
    // Un número suelto antes del primer clic también fija los lados.
    if (this.points.length === 0) {
      const n = parseInt(text.trim(), 10);
      if (Number.isInteger(n) && n >= 3 && n <= 512 && String(n) === text.trim()) {
        this.sides = n;
        return true;
      }
      return false;
    }

    const value = parseLength(text, { defaultUnit: this.editor.units.unit, allowNegative: false });
    if (value === null || value <= EPS) return false;
    const plane = this.planeFromFirstPoint();
    let startDir: Vec3 | undefined;
    if (this.preview) {
      const rel = sub(this.preview, this.points[0]);
      const flat = sub(rel, mul(plane.n, dot(rel, plane.n)));
      if (length(flat) > EPS) startDir = normalize(flat);
    }
    const ring = this.buildRing(this.points[0], plane.n, value, startDir);
    if (ring.length < 3) return false;
    this.commit(ring, true, this.name);
    this.cancel();
    return true;
  }

  override cancel(): void {
    this.ring = [];
    this.radius = 0;
    super.cancel();
  }

  override drawOverlay(overlay: Overlay): void {
    this.drawInference(overlay);
    if (this.ring.length >= 3) {
      overlay.addPolyline(this.ring, THEME.selection, true);
      overlay.addGhostPolygon(this.ring, THEME.selectionFace);
      if (this.points[0] && this.preview) {
        overlay.addLine(this.points[0], this.preview, THEME.guide, true);
      }
    }
  }
}

export class CircleTool extends RadialTool {
  readonly id = 'circle';
  readonly name = 'Círculo';
  readonly statusHint = 'Clic en el centro y arrastra el radio. Escribe el radio, o "24s" para cambiar los segmentos.';

  protected buildRing(center: Vec3, normal: Vec3, radius: number, startDir?: Vec3): Vec3[] {
    // El número de segmentos es exactamente el que ha pedido el usuario, igual
    // que en SketchUp: escribir "48s" da un círculo de 48 lados.
    return circlePoints(center, normal, radius, this.sides, startDir);
  }
}

export class PolygonTool extends RadialTool {
  readonly id = 'polygon';
  readonly name = 'Polígono';
  readonly statusHint = 'Clic en el centro y arrastra. Escribe el radio, o "6s" para el número de lados.';

  constructor(editor: ConstructorParameters<typeof RadialTool>[0]) {
    super(editor);
    this.sides = 6;
  }

  protected buildRing(center: Vec3, normal: Vec3, radius: number, startDir?: Vec3): Vec3[] {
    return polygonPoints(center, normal, radius, this.sides, this.inscribed, startDir);
  }

  override onKeyDown(e: KeyboardEvent): boolean {
    if (e.key.toLowerCase() === 'i' && !e.ctrlKey && !e.metaKey) {
      this.inscribed = !this.inscribed;
      this.editor.setStatus(this.inscribed
        ? 'Radio medido hasta los vértices (inscrito)'
        : 'Radio medido hasta los lados (circunscrito)');
      return true;
    }
    return super.onKeyDown(e);
  }
}

// ---------------------------------------------------------------------------
// Arco
// ---------------------------------------------------------------------------

/**
 * Herramienta Arco de dos puntos y comba, igual que la de SketchUp:
 * se marcan los extremos de la cuerda y después se separa el arco.
 */
export class ArcTool extends DrawingTool {
  readonly id = 'arc';
  readonly name = 'Arco';
  readonly statusHint = 'Marca los dos extremos y separa el arco. Escribe la comba, o "12s" para los segmentos.';

  private segments = 12;
  private curve: Vec3[] = [];
  private bulge = 0;

  override onPointerMove(e: PointerInfo): void {
    const hit = this.updateInference(e);
    this.preview = hit.point;

    if (this.points.length === 1) {
      this.editor.showMeasurement('Longitud', formatLength(
        distance(this.points[0], hit.point), this.editor.units));
    } else if (this.points.length === 2) {
      const [a, b] = this.points;
      const chord = sub(b, a);
      const mid = add(a, mul(chord, 0.5));
      const plane = this.planeFromFirstPoint();
      let normal = plane.n;
      // El plano del arco contiene la cuerda y el cursor.
      const toCursor = sub(hit.point, mid);
      const n2 = cross(chord, toCursor);
      if (length(n2) > EPS) normal = normalize(n2);
      const perp = normalize(cross(normal, chord));
      this.bulge = dot(toCursor, perp);
      // Sin comba apreciable el arco degenera en la propia cuerda; se dibuja
      // recta en lugar de dejar la herramienta bloqueada sin nada que trazar.
      this.curve = Math.abs(this.bulge) <= EPS
        ? [a, b]
        : bulgeArcPoints(a, b, this.bulge, normal, this.segments);
      this.editor.showMeasurement('Comba', formatLength(Math.abs(this.bulge), this.editor.units));
    }
    this.editor.refreshOverlay();
  }

  override onPointerDown(e: PointerInfo): void {
    if (e.button !== 0) return;
    const hit = this.updateInference(e);

    if (this.points.length === 0) {
      this.points.push(hit.point);
      this.anchor = hit.point;
      this.workPlane = hit.plane ?? planeFromPointNormal(hit.point, v3(0, 0, 1));
      return;
    }
    if (this.points.length === 1) {
      if (distance(this.points[0], hit.point) <= EPS) return;
      this.points.push(hit.point);
      this.anchor = hit.point;
      return;
    }
    if (this.curve.length >= 2) {
      this.commit(this.curve, false, 'Arco');
    }
    this.cancel();
  }

  override onMeasurement(text: string): boolean {
    const segMatch = /^(\d+)\s*s$/i.exec(text.trim());
    if (segMatch) {
      const n = parseInt(segMatch[1], 10);
      if (n >= 1 && n <= 256) {
        this.segments = n;
        this.editor.refreshOverlay();
        return true;
      }
      return false;
    }
    if (this.points.length !== 2) return false;
    const value = parseLength(text, { defaultUnit: this.editor.units.unit });
    if (value === null || Math.abs(value) <= EPS) return false;

    const [a, b] = this.points;
    const chord = sub(b, a);
    const plane = this.planeFromFirstPoint();
    let normal = plane.n;
    if (this.preview) {
      const mid = add(a, mul(chord, 0.5));
      const n2 = cross(chord, sub(this.preview, mid));
      if (length(n2) > EPS) normal = normalize(n2);
    }
    const signed = this.bulge < 0 ? -Math.abs(value) : Math.abs(value);
    const curve = Math.abs(signed) <= EPS
      ? [a, b]
      : bulgeArcPoints(a, b, signed, normal, this.segments);
    if (curve.length < 2) return false;
    this.commit(curve, false, 'Arco');
    this.cancel();
    return true;
  }

  override cancel(): void {
    this.curve = [];
    this.bulge = 0;
    super.cancel();
  }

  override drawOverlay(overlay: Overlay): void {
    this.drawInference(overlay);
    if (this.points.length === 1 && this.preview) {
      overlay.addLine(this.points[0], this.preview, THEME.guide, true);
    }
    if (this.points.length === 2) {
      overlay.addLine(this.points[0], this.points[1], THEME.guide, true);
      if (this.curve.length >= 2) overlay.addPolyline(this.curve, THEME.selection);
    }
  }
}

/** Arco por tres puntos: dos extremos y un punto de paso. */
export class Arc3Tool extends DrawingTool {
  readonly id = 'arc3';
  readonly name = 'Arco por 3 puntos';
  readonly statusHint = 'Marca el inicio, el fin y un punto por el que pase el arco.';

  private segments = 16;
  private curve: Vec3[] = [];

  override onPointerMove(e: PointerInfo): void {
    const hit = this.updateInference(e);
    this.preview = hit.point;
    if (this.points.length === 2) {
      const r = arcFrom3Points(this.points[0], hit.point, this.points[1], this.segments);
      this.curve = r ? r.points : [];
      if (r) this.editor.showMeasurement('Radio', formatLength(r.radius, this.editor.units));
    }
    this.editor.refreshOverlay();
  }

  override onPointerDown(e: PointerInfo): void {
    if (e.button !== 0) return;
    const hit = this.updateInference(e);
    if (this.points.length < 2) {
      this.points.push(hit.point);
      this.anchor = hit.point;
      if (this.points.length === 1) {
        this.workPlane = hit.plane ?? planeFromPointNormal(hit.point, v3(0, 0, 1));
      }
      return;
    }
    if (this.curve.length >= 2) this.commit(this.curve, false, 'Arco');
    this.cancel();
  }

  override cancel(): void {
    this.curve = [];
    super.cancel();
  }

  override drawOverlay(overlay: Overlay): void {
    this.drawInference(overlay);
    if (this.points.length === 1 && this.preview) {
      overlay.addLine(this.points[0], this.preview, THEME.guide, true);
    }
    if (this.points.length === 2) {
      overlay.addLine(this.points[0], this.points[1], THEME.guide, true);
      if (this.curve.length >= 2) overlay.addPolyline(this.curve, THEME.selection);
    }
  }
}
