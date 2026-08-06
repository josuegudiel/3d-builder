import { Editor, PointerInfo } from '../app/editor';
import { Overlay } from '../render/overlay';
import { Vec3 } from '../core/math/vec';
import { Plane } from '../core/math/plane';
import { InferenceHit, infer } from '../pick/inference';
import { AXIS_X, AXIS_Y, AXIS_Z } from '../core/math/vec';

/** Interfaz común a todas las herramientas. */
export interface Tool {
  readonly id: string;
  readonly name: string;
  /** Texto de ayuda que aparece en la barra de estado. */
  readonly statusHint: string;
  /** Cursor CSS. */
  readonly cursor: string;

  activate?(): void;
  deactivate?(): void;

  onPointerDown?(e: PointerInfo): void;
  onPointerMove?(e: PointerInfo): void;
  onPointerUp?(e: PointerInfo): void;
  onDoubleClick?(e: PointerInfo): void;

  /** Devuelve true si consume la tecla. */
  onKeyDown?(e: KeyboardEvent): boolean;

  /** Valor confirmado en el cuadro de medidas. Devuelve true si lo acepta. */
  onMeasurement?(text: string): boolean;

  /** Dibuja la previsualización. */
  drawOverlay?(overlay: Overlay): void;

  /** Cancela la operación en curso (Escape). */
  cancel?(): void;
}

/**
 * Base con la maquinaria compartida: inferencia, bloqueo de ejes y
 * conversión entre el espacio del contexto y el del mundo.
 */
export abstract class BaseTool implements Tool {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly statusHint: string;
  readonly cursor: string = 'crosshair';

  /** Última inferencia calculada, en coordenadas del MUNDO. */
  protected hit: InferenceHit | null = null;
  /** Eje bloqueado (en coordenadas del mundo) o null. */
  protected lockedAxis: Vec3 | null = null;
  /** Plano de trabajo activo, en coordenadas del mundo. */
  protected workPlane: Plane | null = null;
  /** Punto de referencia para las inferencias direccionales. */
  protected anchor: Vec3 | null = null;
  /** Dirección de referencia para inferencias de paralelismo. */
  protected referenceDirection: Vec3 | null = null;
  /** Alt desactiva el enganche mientras está pulsado. */
  protected snapDisabled = false;

  constructor(protected readonly editor: Editor) {}

  activate(): void {
    this.reset();
  }

  deactivate(): void {
    this.reset();
  }

  /** Vuelve al estado inicial. */
  protected reset(): void {
    this.hit = null;
    this.anchor = null;
    this.lockedAxis = null;
    this.workPlane = null;
    this.referenceDirection = null;
  }

  cancel(): void {
    this.reset();
    this.editor.setStatus(this.statusHint);
    this.editor.showMeasurement('', '', false);
    this.editor.refreshOverlay();
  }

  /** Calcula la inferencia bajo el cursor. */
  protected updateInference(e: PointerInfo): InferenceHit {
    const hit = infer({
      viewport: this.editor.viewport,
      cache: this.editor.viewport.builder.pick,
      geometry: this.editor.geometry,
      clientX: e.clientX,
      clientY: e.clientY,
      anchor: this.anchor,
      workPlane: this.workPlane,
      lockedAxis: this.lockedAxis,
      referenceDirection: this.referenceDirection,
      disableSnap: e.altKey || this.snapDisabled,
    });
    this.hit = hit;
    this.editor.events.onTooltip?.(hit.label, e.clientX, e.clientY);
    return hit;
  }

  /** Dibuja los glifos y guías de la inferencia actual. */
  protected drawInference(overlay: Overlay): void {
    const hit = this.hit;
    if (!hit) return;
    for (const g of hit.guides) {
      overlay.addLine(g.from, g.to, g.color, true);
    }
    if (hit.glyph) overlay.addGlyph(hit.point, hit.color, hit.glyph);
  }

  /** Gestiona los bloqueos de eje con las flechas del teclado. */
  onKeyDown(e: KeyboardEvent): boolean {
    switch (e.key) {
      case 'ArrowRight':
        this.toggleAxis(AXIS_X);
        return true;
      case 'ArrowLeft':
        this.toggleAxis(AXIS_Y);
        return true;
      case 'ArrowUp':
        this.toggleAxis(AXIS_Z);
        return true;
      case 'ArrowDown':
        this.lockedAxis = null;
        this.editor.refreshOverlay();
        return true;
      default:
        return false;
    }
  }

  protected toggleAxis(axis: Vec3): void {
    if (this.lockedAxis
      && Math.abs(this.lockedAxis.x - axis.x) < 1e-9
      && Math.abs(this.lockedAxis.y - axis.y) < 1e-9
      && Math.abs(this.lockedAxis.z - axis.z) < 1e-9) {
      this.lockedAxis = null;
    } else {
      this.lockedAxis = axis;
    }
    this.editor.refreshOverlay();
  }

  /** Convierte un punto del mundo al espacio de la geometría editada. */
  protected local(p: Vec3): Vec3 {
    return this.editor.toContext(p);
  }

  /** Convierte un punto de la geometría editada al mundo. */
  protected world(p: Vec3): Vec3 {
    return this.editor.toWorld(p);
  }

  // --- Manejadores por defecto (las subclases los sobrescriben) -------------

  onPointerDown(_e: PointerInfo): void { /* sin comportamiento por defecto */ }

  onPointerMove(e: PointerInfo): void {
    this.updateInference(e);
    this.editor.refreshOverlay();
  }

  onPointerUp(_e: PointerInfo): void { /* sin comportamiento por defecto */ }

  onDoubleClick(_e: PointerInfo): void { /* sin comportamiento por defecto */ }

  onMeasurement(_text: string): boolean {
    return false;
  }

  drawOverlay(overlay: Overlay): void {
    this.drawInference(overlay);
  }
}

/** Herramientas que no hacen nada ante un evento concreto. */
export const NO_OP_TOOL: Tool = {
  id: 'none',
  name: 'Ninguna',
  statusHint: '',
  cursor: 'default',
};
