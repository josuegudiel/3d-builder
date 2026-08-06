import { BaseTool } from './base';
import { PointerInfo } from '../app/editor';
import { Overlay } from '../render/overlay';
import { THEME } from '../render/theme';
import {
  Vec3, v3, add, sub, mul, dot, cross, normalize, length, distance, addScaled,
  midpoint, signedAngle, AXIS_Z, AXIS_X,
} from '../core/math/vec';
import { EPS } from '../core/math/tolerance';
import { Id } from '../core/model/types';
import { pickEntity, pickFace } from '../pick/picker';
import { eraseEdges, eraseFaces, eraseInstances } from '../core/ops/erase';
import { formatLength, formatAngle, parseLength } from '../core/units';
import { selectCoplanar } from '../core/selection';

// ---------------------------------------------------------------------------
// Borrador
// ---------------------------------------------------------------------------

/**
 * Herramienta Borrar. Arrastrando se van marcando las aristas que se
 * eliminarán al soltar. Con Ctrl se suavizan en lugar de borrarse y con Mayús
 * se ocultan, igual que en SketchUp.
 */
export class EraserTool extends BaseTool {
  readonly id = 'eraser';
  readonly name = 'Borrar';
  readonly statusHint = 'Clic o arrastra sobre las aristas. Ctrl las suaviza, Mayús las oculta.';
  override readonly cursor = 'cell';

  private active = false;
  private marked = new Set<Id>();
  private markedInstances = new Set<Id>();
  private mode: 'erase' | 'soften' | 'hide' = 'erase';

  override onPointerDown(e: PointerInfo): void {
    if (e.button !== 0) return;
    this.active = true;
    this.marked.clear();
    this.markedInstances.clear();
    this.mode = e.ctrlKey ? 'soften' : e.shiftKey ? 'hide' : 'erase';
    this.markAt(e);
  }

  override onPointerMove(e: PointerInfo): void {
    if (!this.active) {
      const hit = pickEntity(
        this.editor.viewport.builder.pick, this.editor.viewport, e.clientX, e.clientY,
        { vertices: false, faces: false },
      );
      const hover = hit ? { kind: hit.kind as 'edge' | 'instance', id: hit.id } : null;
      if (hover?.id !== this.editor.renderOptions.hover?.id) {
        this.editor.renderOptions.hover = hover;
        this.editor.refreshModel();
      }
      return;
    }
    this.markAt(e);
  }

  private markAt(e: PointerInfo): void {
    const hit = pickEntity(
      this.editor.viewport.builder.pick, this.editor.viewport, e.clientX, e.clientY,
      { vertices: false, faces: false },
    );
    if (!hit) return;
    if (hit.kind === 'edge') this.marked.add(hit.id);
    else if (hit.kind === 'instance') this.markedInstances.add(hit.id);
    this.editor.refreshOverlay();
  }

  override onPointerUp(): void {
    if (!this.active) return;
    this.active = false;
    if (this.marked.size === 0 && this.markedInstances.size === 0) return;

    const edges = [...this.marked];
    const instances = [...this.markedInstances];
    const mode = this.mode;

    this.editor.edit(
      mode === 'erase' ? 'Borrar' : mode === 'soften' ? 'Suavizar' : 'Ocultar',
      () => {
        const geo = this.editor.geometry;
        if (mode === 'erase') {
          eraseEdges(geo, edges);
          eraseInstances(geo, instances);
        } else {
          for (const id of edges) {
            const edge = geo.edges.get(id);
            if (!edge) continue;
            if (mode === 'soften') {
              edge.soft = true;
              edge.smooth = true;
            } else {
              edge.hidden = true;
            }
          }
          for (const id of instances) {
            const inst = geo.instances.get(id);
            if (inst) inst.hidden = true;
          }
        }
      },
    );

    this.marked.clear();
    this.markedInstances.clear();
    this.editor.renderOptions.hover = null;
    this.editor.refreshModel();
  }

  override drawOverlay(overlay: Overlay): void {
    const geo = this.editor.geometry;
    for (const id of this.marked) {
      const e = geo.edges.get(id);
      if (!e) continue;
      overlay.addLine(
        this.world(geo.vertexPos(e.a)),
        this.world(geo.vertexPos(e.b)),
        THEME.axisX,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Pintar
// ---------------------------------------------------------------------------

/** Herramienta Pintar: aplica el material activo a las caras. */
export class PaintTool extends BaseTool {
  readonly id = 'paint';
  readonly name = 'Pintar';
  readonly statusHint = 'Clic en una cara para aplicar el material. Alt copia el material, Mayús pinta todas las coplanares.';
  override readonly cursor = 'copy';

  /** Material activo, controlado desde el panel de materiales. */
  material: string | null = 'blanco';

  override onPointerMove(e: PointerInfo): void {
    const hit = pickFace(
      this.editor.viewport.builder.pick, this.editor.viewport, e.clientX, e.clientY,
    );
    const id = hit ? hit.id : null;
    if (id !== this.editor.renderOptions.hover?.id) {
      this.editor.renderOptions.hover = id !== null ? { kind: 'face', id } : null;
      this.editor.refreshModel();
    }
  }

  override onPointerDown(e: PointerInfo): void {
    if (e.button !== 0) return;
    const picked = pickEntity(
      this.editor.viewport.builder.pick, this.editor.viewport, e.clientX, e.clientY,
      { vertices: false, edges: false },
    );
    if (!picked) return;

    const geo = this.editor.geometry;

    if (picked.kind === 'instance') {
      const inst = geo.instances.get(picked.id);
      if (!inst) return;
      this.editor.edit('Pintar grupo', () => { inst.materialId = this.material; });
      return;
    }
    if (picked.kind !== 'face') return;

    const face = geo.faces.get(picked.id);
    if (!face) return;

    if (e.altKey) {
      this.material = face.frontMaterial;
      this.editor.setStatus(`Material tomado: ${this.material ?? 'por defecto'}`);
      return;
    }

    const targets = new Set<Id>([picked.id]);
    if (e.shiftKey) {
      const tmp = { faces: new Set<Id>(), edges: new Set<Id>(), vertices: new Set<Id>(), instances: new Set<Id>() };
      selectCoplanar(tmp, geo, picked.id);
      for (const f of tmp.faces) targets.add(f);
    }
    if (this.editor.selection.faces.has(picked.id)) {
      for (const f of this.editor.selection.faces) targets.add(f);
    }

    const material = this.material;
    // ¿Se ha hecho clic sobre el reverso? En ese caso se pinta el reverso.
    const backSide = dot(
      this.editor.toWorldVector(face.plane.n),
      this.editor.viewport.cameraCtl.forward,
    ) > 0;

    this.editor.edit('Pintar', () => {
      for (const id of targets) {
        const f = geo.faces.get(id);
        if (!f) continue;
        if (backSide) f.backMaterial = material;
        else f.frontMaterial = material;
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Metro
// ---------------------------------------------------------------------------

/**
 * Herramienta Metro: mide distancias y, si no se pulsa Ctrl, crea líneas de
 * guía a partir de una arista o un punto.
 */
export class TapeMeasureTool extends BaseTool {
  readonly id = 'tape';
  readonly name = 'Metro';
  readonly statusHint = 'Clic en dos puntos para medir. Ctrl alterna la creación de guías.';

  protected start: Vec3 | null = null;
  protected end: Vec3 | null = null;
  protected createGuides = true;

  override onPointerMove(e: PointerInfo): void {
    const hit = this.updateInference(e);
    if (this.start) {
      this.end = hit.point;
      const d = distance(this.start, this.end);
      this.editor.showMeasurement('Distancia', formatLength(d, this.editor.units));
    }
    this.editor.refreshOverlay();
  }

  override onPointerDown(e: PointerInfo): void {
    if (e.button !== 0) return;
    if (e.ctrlKey) this.createGuides = !this.createGuides;
    const hit = this.updateInference(e);

    if (!this.start) {
      this.start = hit.point;
      this.anchor = hit.point;
      return;
    }
    this.finish(hit.point);
  }

  protected finish(endPoint: Vec3): void {
    const start = this.start;
    if (!start) return;
    if (this.createGuides && distance(start, endPoint) > EPS) {
      this.editor.edit('Guía', () => {
        this.editor.model.addGuide('line', start, endPoint);
        this.editor.model.addGuide('point', endPoint, endPoint);
      });
    }
    this.cancel();
  }

  override onMeasurement(text: string): boolean {
    if (!this.start || !this.end) return false;
    const value = parseLength(text, { defaultUnit: this.editor.units.unit, allowNegative: false });
    if (value === null || value <= EPS) return false;
    const dir = sub(this.end, this.start);
    if (length(dir) <= EPS) return false;
    this.finish(addScaled(this.start, normalize(dir), value));
    return true;
  }

  override cancel(): void {
    this.start = null;
    this.end = null;
    super.cancel();
  }

  override drawOverlay(overlay: Overlay): void {
    this.drawInference(overlay);
    if (this.start && this.end) {
      overlay.addLine(this.start, this.end, THEME.guide, true);
      overlay.addGlyph(this.start, THEME.inferenceEndpoint, 'square');
      overlay.addGlyph(this.end, THEME.inferenceEndpoint, 'square');
    }
  }
}

// ---------------------------------------------------------------------------
// Acotar
// ---------------------------------------------------------------------------

/** Herramienta Acotar: crea cotas permanentes entre dos puntos. */
export class DimensionTool extends BaseTool {
  readonly id = 'dimension';
  readonly name = 'Acotar';
  readonly statusHint = 'Clic en dos puntos y separa la línea de cota. Un tercer clic la fija.';

  private a: Vec3 | null = null;
  private b: Vec3 | null = null;
  private offset: Vec3 = v3(0, 0, 0);

  override onPointerMove(e: PointerInfo): void {
    const hit = this.updateInference(e);

    if (this.a && !this.b) {
      this.editor.showMeasurement('Longitud', formatLength(distance(this.a, hit.point), this.editor.units));
    } else if (this.a && this.b) {
      // La separación se mide perpendicularmente al segmento acotado.
      const dir = sub(this.b, this.a);
      const l = length(dir);
      if (l > EPS) {
        const u = mul(dir, 1 / l);
        const rel = sub(hit.point, this.a);
        this.offset = sub(rel, mul(u, dot(rel, u)));
      }
      this.editor.showMeasurement('Longitud', formatLength(l, this.editor.units));
    }
    this.editor.refreshOverlay();
  }

  override onPointerDown(e: PointerInfo): void {
    if (e.button !== 0) return;
    const hit = this.updateInference(e);

    if (!this.a) {
      // Un clic sobre una arista acota la arista completa.
      const picked = pickEntity(
        this.editor.viewport.builder.pick, this.editor.viewport, e.clientX, e.clientY,
        { vertices: true, edges: true, faces: false, instances: false },
      );
      if (picked && picked.kind === 'edge') {
        const edge = this.editor.geometry.edges.get(picked.id);
        if (edge) {
          this.a = this.world(this.editor.geometry.vertexPos(edge.a));
          this.b = this.world(this.editor.geometry.vertexPos(edge.b));
          this.anchor = this.b;
          return;
        }
      }
      this.a = hit.point;
      this.anchor = hit.point;
      return;
    }
    if (!this.b) {
      if (distance(this.a, hit.point) <= EPS) return;
      this.b = hit.point;
      this.anchor = hit.point;
      return;
    }

    const a = this.editor.toRoot(this.a);
    const b = this.editor.toRoot(this.b);
    let off = this.editor.toRootVector(this.offset);
    if (length(off) <= EPS) {
      // Sin separación la cota quedaría pegada al segmento y sería ilegible:
      // se aparta un poco en perpendicular, hacia arriba si es posible.
      const dir = normalize(sub(b, a));
      const up = Math.abs(dir.z) > 0.9 ? v3(1, 0, 0) : v3(0, 0, 1);
      const perp = normalize(cross(cross(dir, up), dir));
      off = mul(perp, Math.max(distance(a, b) * 0.15, EPS * 10));
    }
    const finalOffset = off;
    this.editor.edit('Acotar', () => {
      this.editor.model.addDimension(a, b, finalOffset, '');
    });
    this.cancel();
  }

  override cancel(): void {
    this.a = null;
    this.b = null;
    this.offset = v3(0, 0, 0);
    super.cancel();
  }

  override drawOverlay(overlay: Overlay): void {
    this.drawInference(overlay);
    if (this.a && this.b) {
      const a2 = add(this.a, this.offset);
      const b2 = add(this.b, this.offset);
      overlay.addLine(this.a, a2, THEME.dimension);
      overlay.addLine(this.b, b2, THEME.dimension);
      overlay.addLine(a2, b2, THEME.dimension);
    } else if (this.a && this.hit) {
      overlay.addLine(this.a, this.hit.point, THEME.dimension, true);
    }
  }
}

// ---------------------------------------------------------------------------
// Transportador
// ---------------------------------------------------------------------------

/** Herramienta Transportador: mide ángulos y crea guías angulares. */
export class ProtractorTool extends BaseTool {
  readonly id = 'protractor';
  readonly name = 'Transportador';
  readonly statusHint = 'Clic en el vértice, después en el primer lado y por último en el segundo.';

  private center: Vec3 | null = null;
  private first: Vec3 | null = null;
  private axis: Vec3 = AXIS_Z;
  private angle = 0;

  override onPointerMove(e: PointerInfo): void {
    const hit = this.updateInference(e);
    if (this.center && this.first) {
      const u = sub(this.first, this.center);
      const w = sub(hit.point, this.center);
      const n = cross(u, w);
      if (length(n) > EPS) this.axis = normalize(n);
      this.angle = signedAngle(u, w, this.axis);
      this.editor.showMeasurement('Ángulo', formatAngle(Math.abs(this.angle), this.editor.units));
    } else if (this.center) {
      this.editor.showMeasurement('Radio', formatLength(distance(this.center, hit.point), this.editor.units));
    }
    this.editor.refreshOverlay();
  }

  override onPointerDown(e: PointerInfo): void {
    if (e.button !== 0) return;
    const hit = this.updateInference(e);
    if (!this.center) {
      this.center = hit.point;
      this.anchor = hit.point;
      return;
    }
    if (!this.first) {
      if (distance(this.center, hit.point) <= EPS) return;
      this.first = hit.point;
      return;
    }
    // Guía angular desde el vértice.
    const center = this.center;
    const dirWorld = sub(hit.point, center);
    if (length(dirWorld) > EPS) {
      const end = addScaled(center, normalize(dirWorld), distance(center, this.first));
      const rootA = this.editor.toRoot(center);
      const rootB = this.editor.toRoot(end);
      this.editor.edit('Guía angular', () => {
        this.editor.model.addGuide('line', rootA, rootB);
      });
    }
    this.cancel();
  }

  override cancel(): void {
    this.center = null;
    this.first = null;
    this.angle = 0;
    super.cancel();
  }

  override drawOverlay(overlay: Overlay): void {
    this.drawInference(overlay);
    if (!this.center) return;
    const radius = this.first
      ? distance(this.center, this.first)
      : this.editor.viewport.cameraCtl.distance * 0.1;

    const u = this.first
      ? normalize(sub(this.first, this.center))
      : normalize(cross(this.axis, Math.abs(this.axis.z) < 0.9 ? AXIS_Z : AXIS_X));
    const w = cross(this.axis, u);
    const ring: Vec3[] = [];
    for (let i = 0; i <= 48; i++) {
      const t = (i / 48) * Math.PI * 2;
      ring.push(add(this.center, add(mul(u, Math.cos(t) * radius), mul(w, Math.sin(t) * radius))));
    }
    overlay.addPolyline(ring, THEME.guide, false, true);
    if (this.first) {
      overlay.addLine(this.center, this.first, THEME.guide);
      if (this.hit) overlay.addLine(this.center, this.hit.point, THEME.selection);
    }
    overlay.addGlyph(this.center, THEME.inferenceEndpoint, 'cross');
  }
}

// ---------------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------------

/** Herramienta Orbitar (también disponible con el botón central del ratón). */
export class OrbitTool extends BaseTool {
  readonly id = 'orbit';
  readonly name = 'Orbitar';
  readonly statusHint = 'Arrastra para girar alrededor del modelo.';
  override readonly cursor = 'grab';

  private dragging = false;
  private last = { x: 0, y: 0 };

  override onPointerDown(e: PointerInfo): void {
    if (e.button !== 0) return;
    this.dragging = true;
    this.last = { x: e.clientX, y: e.clientY };
  }

  override onPointerMove(e: PointerInfo): void {
    if (!this.dragging) return;
    this.editor.viewport.cameraCtl.orbit(e.clientX - this.last.x, e.clientY - this.last.y);
    this.last = { x: e.clientX, y: e.clientY };
    this.editor.viewport.invalidate();
    this.editor.refreshOverlay();
  }

  override onPointerUp(): void {
    this.dragging = false;
  }

  override drawOverlay(): void { /* sin previsualización */ }
}

/** Herramienta Desplazar la vista. */
export class PanTool extends BaseTool {
  readonly id = 'pan';
  readonly name = 'Desplazar';
  readonly statusHint = 'Arrastra para mover la vista.';
  override readonly cursor = 'move';

  private dragging = false;
  private last = { x: 0, y: 0 };

  override onPointerDown(e: PointerInfo): void {
    if (e.button !== 0) return;
    this.dragging = true;
    this.last = { x: e.clientX, y: e.clientY };
  }

  override onPointerMove(e: PointerInfo): void {
    if (!this.dragging) return;
    this.editor.viewport.cameraCtl.pan(
      e.clientX - this.last.x, e.clientY - this.last.y, this.editor.viewport.size.height,
    );
    this.last = { x: e.clientX, y: e.clientY };
    this.editor.viewport.invalidate();
    this.editor.refreshOverlay();
  }

  override onPointerUp(): void {
    this.dragging = false;
  }

  override drawOverlay(): void { /* sin previsualización */ }
}

/** Herramienta Zoom por arrastre vertical. */
export class ZoomTool extends BaseTool {
  readonly id = 'zoom';
  readonly name = 'Zoom';
  readonly statusHint = 'Arrastra arriba o abajo para acercar o alejar.';
  override readonly cursor = 'ns-resize';

  private dragging = false;
  private lastY = 0;

  override onPointerDown(e: PointerInfo): void {
    if (e.button !== 0) return;
    this.dragging = true;
    this.lastY = e.clientY;
  }

  override onPointerMove(e: PointerInfo): void {
    if (!this.dragging) return;
    this.editor.viewport.cameraCtl.zoom((this.lastY - e.clientY) * 0.05);
    this.lastY = e.clientY;
    this.editor.viewport.invalidate();
    this.editor.refreshOverlay();
  }

  override onPointerUp(): void {
    this.dragging = false;
  }

  override drawOverlay(): void { /* sin previsualización */ }
}

/** Reexport para las herramientas que necesitan borrar caras. */
export { eraseFaces, midpoint };
