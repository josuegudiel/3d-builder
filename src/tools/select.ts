import { BaseTool } from './base';
import { PointerInfo } from '../app/editor';
import { Overlay } from '../render/overlay';
import { pickEntity, boxSelect } from '../pick/picker';
import {
  clearSelection, toggleEntity, addEntity, removeEntity,
  expandFaceToEdges, selectConnected,
} from '../core/selection';
import { EntityKind } from '../core/model/types';

const DRAG_THRESHOLD = 4;
const MULTICLICK_MS = 400;

/**
 * Herramienta Seleccionar.
 *
 * - Clic: selecciona una entidad.
 * - Mayús + clic: añade o quita de la selección.
 * - Ctrl + clic: añade. Ctrl + Mayús + clic: quita.
 * - Doble clic sobre una cara: selecciona también sus aristas.
 * - Doble clic sobre un grupo: entra a editarlo.
 * - Triple clic: selecciona toda la geometría conectada.
 * - Arrastrar: ventana de selección (de izquierda a derecha exige contener
 *   la entidad completa; de derecha a izquierda basta con tocarla).
 */
export class SelectTool extends BaseTool {
  readonly id = 'select';
  readonly name = 'Seleccionar';
  readonly statusHint = 'Clic para seleccionar. Mayús para añadir. Doble clic entra en un grupo. Arrastra para seleccionar por ventana.';
  override readonly cursor = 'default';

  private dragStart: { x: number; y: number } | null = null;
  private dragging = false;
  private lastClick = { time: 0, x: 0, y: 0, count: 0 };

  override onPointerDown(e: PointerInfo): void {
    if (e.button !== 0) return;
    this.dragStart = { x: e.clientX, y: e.clientY };
    this.dragging = false;
  }

  override onPointerMove(e: PointerInfo): void {
    if (this.dragStart) {
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      if (!this.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) this.dragging = true;
      if (this.dragging) {
        const local0 = this.editor.viewport.toLocal(this.dragStart.x, this.dragStart.y);
        const local1 = this.editor.viewport.toLocal(e.clientX, e.clientY);
        this.editor.events.onSelectionRect?.({
          x: Math.min(local0.x, local1.x),
          y: Math.min(local0.y, local1.y),
          w: Math.abs(local1.x - local0.x),
          h: Math.abs(local1.y - local0.y),
          crossing: local1.x < local0.x,
        });
      }
      return;
    }

    // Resaltado bajo el cursor.
    const hit = pickEntity(
      this.editor.viewport.builder.pick, this.editor.viewport, e.clientX, e.clientY,
    );
    const hover = hit
      ? { kind: hit.kind === 'vertex' ? 'edge' as const : hit.kind, id: hit.id }
      : null;
    const prev = this.editor.renderOptions.hover;
    const changed = (prev?.id !== hover?.id) || (prev?.kind !== hover?.kind);
    if (changed) {
      this.editor.renderOptions.hover = hover as never;
      this.editor.refreshModel();
    }
    this.editor.events.onTooltip?.('', e.clientX, e.clientY);
  }

  override onPointerUp(e: PointerInfo): void {
    if (!this.dragStart) return;
    const start = this.dragStart;
    this.dragStart = null;

    if (this.dragging) {
      this.dragging = false;
      this.editor.events.onSelectionRect?.(null);
      this.applyBoxSelection(start, e);
      return;
    }

    this.handleClick(e);
  }

  private applyBoxSelection(start: { x: number; y: number }, e: PointerInfo): void {
    const vp = this.editor.viewport;
    const a = vp.toLocal(start.x, start.y);
    const b = vp.toLocal(e.clientX, e.clientY);
    const crossing = b.x < a.x;
    const result = boxSelect(vp.builder.pick, vp, a.x, a.y, b.x, b.y, crossing);

    const sel = this.editor.selection;
    const additive = e.shiftKey || e.ctrlKey;
    const subtract = e.ctrlKey && e.shiftKey;
    if (!additive) clearSelection(sel);

    for (const id of result.faces) {
      if (subtract) sel.faces.delete(id);
      else sel.faces.add(id);
    }
    for (const id of result.edges) {
      if (subtract) sel.edges.delete(id);
      else sel.edges.add(id);
    }
    for (const id of result.instances) {
      if (subtract) sel.instances.delete(id);
      else sel.instances.add(id);
    }
    this.editor.refreshModel();
    this.editor.setStatus(this.editor.selectionSummary());
  }

  private handleClick(e: PointerInfo): void {
    const now = performance.now();
    const near = Math.hypot(e.clientX - this.lastClick.x, e.clientY - this.lastClick.y) < 6;
    this.lastClick.count = (now - this.lastClick.time < MULTICLICK_MS && near)
      ? this.lastClick.count + 1
      : 1;
    this.lastClick.time = now;
    this.lastClick.x = e.clientX;
    this.lastClick.y = e.clientY;

    const hit = pickEntity(
      this.editor.viewport.builder.pick, this.editor.viewport, e.clientX, e.clientY,
    );
    const sel = this.editor.selection;

    if (!hit) {
      if (!e.shiftKey && !e.ctrlKey) {
        clearSelection(sel);
        this.editor.refreshModel();
        this.editor.setStatus(this.editor.selectionSummary());
      }
      return;
    }

    // Los vértices se tratan como puntos sueltos sólo si no hay nada mejor.
    const kind: EntityKind = hit.kind === 'vertex' ? 'vertex' : hit.kind;

    if (this.lastClick.count >= 3) {
      clearSelection(sel);
      selectConnected(sel, this.editor.geometry, { kind, id: hit.id });
      this.editor.refreshModel();
      this.editor.setStatus(this.editor.selectionSummary());
      return;
    }

    if (this.lastClick.count === 2) {
      if (kind === 'instance') {
        this.editor.enterContext(hit.id);
        this.editor.setStatus(`Editando ${this.editor.contextLabel().join(' › ')}`);
        return;
      }
      if (kind === 'face') {
        clearSelection(sel);
        expandFaceToEdges(sel, this.editor.geometry, hit.id);
        this.editor.refreshModel();
        this.editor.setStatus(this.editor.selectionSummary());
        return;
      }
      if (kind === 'edge') {
        // Doble clic sobre una arista: añade las caras adyacentes.
        for (const f of this.editor.geometry.edgeFaces.get(hit.id) ?? []) sel.faces.add(f);
        this.editor.refreshModel();
        return;
      }
    }

    const subtract = e.ctrlKey && e.shiftKey;
    if (subtract) {
      removeEntity(sel, kind, hit.id);
    } else if (e.shiftKey) {
      toggleEntity(sel, kind, hit.id);
    } else if (e.ctrlKey) {
      addEntity(sel, kind, hit.id);
    } else {
      // Clic simple: la entidad pasa a ser la única seleccionada, aunque ya lo
      // estuviera (así se reduce una selección múltiple a un solo elemento).
      clearSelection(sel);
      addEntity(sel, kind, hit.id);
    }

    this.editor.refreshModel();
    this.editor.setStatus(this.editor.selectionSummary());
  }

  override onDoubleClick(): void {
    // El conteo de clics ya lo gestiona handleClick.
  }

  override onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      if (this.editor.selection.faces.size + this.editor.selection.edges.size
        + this.editor.selection.instances.size > 0) {
        clearSelection(this.editor.selection);
        this.editor.refreshModel();
        return true;
      }
      return this.editor.exitContext();
    }
    return false;
  }

  override drawOverlay(_overlay: Overlay): void {
    // La ventana de selección se dibuja en HTML, no en la escena 3D.
  }
}
