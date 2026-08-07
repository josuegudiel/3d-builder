import { Model, resolveContext } from '../core/model/model';
import { Geometry } from '../core/model/geometry';
import { Id } from '../core/model/types';
import { Vec3, v3, sub, add, dot } from '../core/math/vec';
import { Mat4, IDENTITY, matInvert, transformPoint, transformVector } from '../core/math/mat';
import { Plane, planeTransform } from '../core/math/plane';
import { Viewport } from '../render/viewport';
import { RenderOptions, DEFAULT_RENDER_OPTIONS } from '../render/scene';
import { History } from '../core/history';
import { faceComponent, isOrientedShell } from '../core/topology/orient';
import {
  Selection, emptySelection, clearSelection, pruneSelection, describeSelection,
} from '../core/selection';
import { UnitSettings, DEFAULT_UNITS } from '../core/units';
import { Tool } from '../tools/base';

export interface EditorEvents {
  /** El modelo o la selección han cambiado. */
  onModelChanged?: () => void;
  /** Ha cambiado la herramienta activa. */
  onToolChanged?: (tool: Tool) => void;
  /** Texto de ayuda para la barra de estado. */
  onStatus?: (text: string) => void;
  /** El cuadro de medidas debe mostrar este valor. */
  onMeasurement?: (label: string, value: string, editable: boolean) => void;
  /** Etiqueta flotante junto al cursor (inferencia). */
  onTooltip?: (text: string, x: number, y: number) => void;
  /** Ha cambiado el contexto de edición (entrar/salir de un grupo). */
  onContextChanged?: () => void;
  /** Rectángulo de selección en píxeles, o null para ocultarlo. */
  onSelectionRect?: (rect: { x: number; y: number; w: number; h: number; crossing: boolean } | null) => void;
  /** Etiquetas flotantes ancladas a puntos del mundo (cotas, longitudes). */
  onLabels?: (labels: Array<{ text: string; x: number; y: number; kind?: string }>) => void;
}

/**
 * Núcleo de la aplicación: mantiene el modelo, la vista, la selección, el
 * historial y la herramienta activa, y reparte los eventos de entrada.
 */
export class Editor {
  model = new Model();
  selection: Selection = emptySelection();
  contextPath: Id[] = [];
  history: History;

  renderOptions: RenderOptions = { ...DEFAULT_RENDER_OPTIONS };
  events: EditorEvents = {};

  /** Herramienta activa. */
  tool!: Tool;
  private previousTool: Tool | null = null;

  /** Última posición conocida del cursor, en coordenadas de cliente. */
  pointer = { x: 0, y: 0, inside: false };

  private navigating: 'orbit' | 'pan' | null = null;
  private navLast = { x: 0, y: 0 };
  private frameRequested = false;

  constructor(readonly viewport: Viewport) {
    this.history = new History(120, () => this.events.onModelChanged?.());
    this.renderOptions.selection = this.selection;
    this.attachEvents();
    this.refreshModel();
  }

  // -------------------------------------------------------------------------
  // Contexto de edición
  // -------------------------------------------------------------------------

  /** Geometría que se está editando ahora mismo. */
  get geometry(): Geometry {
    return resolveContext(this.model, this.contextPath).geometry;
  }

  /** Transformación del contexto activo al espacio del mundo. */
  get contextTransform(): Mat4 {
    return resolveContext(this.model, this.contextPath).transform;
  }

  private get inverseContextTransform(): Mat4 {
    return matInvert(this.contextTransform) ?? IDENTITY;
  }

  /** Convierte un punto del mundo al espacio del contexto activo. */
  toContext(p: Vec3): Vec3 {
    return transformPoint(this.inverseContextTransform, p);
  }

  /** Convierte un punto del contexto activo al mundo. */
  toWorld(p: Vec3): Vec3 {
    return transformPoint(this.contextTransform, p);
  }

  /** Convierte una dirección del mundo al espacio del contexto. */
  toContextVector(v: Vec3): Vec3 {
    return transformVector(this.inverseContextTransform, v);
  }

  toWorldVector(v: Vec3): Vec3 {
    return transformVector(this.contextTransform, v);
  }

  /** Convierte un plano del contexto al mundo. */
  planeToWorld(p: Plane): Plane {
    return planeTransform(p, this.contextTransform);
  }

  /**
   * Convierte un punto del mundo al espacio del modelo raíz. Las cotas y las
   * guías se guardan siempre ahí, no dentro del grupo que se esté editando.
   *
   * La definición raíz no tiene transformación propia, así que su espacio y el
   * del mundo coinciden: la conversión es la identidad. La función existe para
   * que las herramientas expresen su intención y para que siga siendo correcta
   * si algún día la raíz dejara de estar en el origen.
   */
  toRoot(p: Vec3): Vec3 {
    return p;
  }

  /** Igual que `toRoot` pero para direcciones. */
  toRootVector(v: Vec3): Vec3 {
    return v;
  }

  /** Entra a editar una instancia. */
  enterContext(instanceId: Id): void {
    const geo = this.geometry;
    if (!geo.instances.has(instanceId)) return;
    this.contextPath = [...this.contextPath, instanceId];
    clearSelection(this.selection);
    this.refreshModel();
    this.events.onContextChanged?.();
  }

  /** Sale un nivel del contexto de edición. */
  exitContext(): boolean {
    if (this.contextPath.length === 0) return false;
    const leaving = this.contextPath[this.contextPath.length - 1];
    this.contextPath = this.contextPath.slice(0, -1);
    clearSelection(this.selection);
    this.selection.instances.add(leaving);
    this.refreshModel();
    this.events.onContextChanged?.();
    return true;
  }

  /** Nombre legible del contexto actual, para la barra superior. */
  contextLabel(): string[] {
    const labels = ['Modelo'];
    let def = this.model.root;
    for (const instId of this.contextPath) {
      const inst = def.geometry.instances.get(instId);
      if (!inst) break;
      const child = this.model.definitions.get(inst.definitionId);
      labels.push(inst.name || child?.name || 'Grupo');
      if (!child) break;
      def = child;
    }
    return labels;
  }

  // -------------------------------------------------------------------------
  // Unidades
  // -------------------------------------------------------------------------

  get units(): UnitSettings {
    return this.model.units ?? DEFAULT_UNITS;
  }

  setUnits(u: Partial<UnitSettings>): void {
    this.model.units = { ...this.units, ...u };
    this.events.onModelChanged?.();
    this.refreshModel();
  }

  // -------------------------------------------------------------------------
  // Herramientas
  // -------------------------------------------------------------------------

  setTool(tool: Tool, remember = true): void {
    if (this.tool === tool) return;
    if (this.tool) {
      this.tool.deactivate?.();
      if (remember) this.previousTool = this.tool;
    }
    this.tool = tool;
    tool.activate?.();
    this.renderOptions.hover = null;
    this.events.onTooltip?.('', 0, 0);
    this.events.onSelectionRect?.(null);
    this.events.onToolChanged?.(tool);
    this.setStatus(tool.statusHint);
    this.refreshOverlay();
  }

  /** Vuelve a la herramienta anterior (tras una acción puntual). */
  restorePreviousTool(): void {
    if (this.previousTool) this.setTool(this.previousTool, false);
  }

  setStatus(text: string): void {
    this.events.onStatus?.(text);
  }

  showMeasurement(label: string, value: string, editable = true): void {
    this.events.onMeasurement?.(label, value, editable);
  }

  // -------------------------------------------------------------------------
  // Actualización de la vista
  // -------------------------------------------------------------------------

  /** Reconstruye la escena completa (tras un cambio en el modelo). */
  refreshModel(): void {
    this.shellMemo.clear();
    pruneSelection(this.selection, this.geometry);
    this.renderOptions.context = this.contextPath;
    this.renderOptions.selection = this.selection;
    this.viewport.rebuild(this.model, this.renderOptions);
    this.refreshOverlay();
    this.events.onModelChanged?.();
  }

  /**
   * ¿Pertenece la cara a una cáscara cerrada y bien orientada?
   *
   * Responderlo exige recorrer toda la componente, y el ángulo diedro lo
   * pregunta en cada movimiento del ratón: sin recordar la respuesta, pasar el
   * cursor por una esfera de cuatro mil caras costaba 37 ms por movimiento. Se
   * guarda para TODAS las caras de la componente de una vez y se olvida en
   * `refreshModel`, que es por donde pasa cualquier cambio del modelo.
   */
  shellOf(faceId: Id): boolean {
    const cached = this.shellMemo.get(faceId);
    if (cached !== undefined) return cached;
    const geo = this.geometry;
    if (!geo.faces.has(faceId)) return false;
    const component = faceComponent(geo, faceId);
    const ok = isOrientedShell(geo, component);
    for (const f of component) this.shellMemo.set(f, ok);
    return ok;
  }

  private readonly shellMemo = new Map<Id, boolean>();

  /** Redibuja sólo la capa de superposición (previsualizaciones). */
  refreshOverlay(): void {
    const overlay = this.viewport.overlay;
    overlay.clear();
    this.tool?.drawOverlay?.(overlay);
    overlay.commit();
    this.viewport.invalidate();
    this.requestFrame();
  }

  private requestFrame(): void {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.viewport.renderIfNeeded();
    });
  }

  /** Bucle continuo: sólo dibuja cuando hay cambios pendientes. */
  startRenderLoop(): void {
    const loop = () => {
      this.viewport.renderIfNeeded();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // -------------------------------------------------------------------------
  // Deshacer / rehacer
  // -------------------------------------------------------------------------

  /**
   * Ejecuta una operación registrándola en el historial.
   *
   * La selección se depura ANTES de confirmar el paso: al confirmarlo se avisa
   * a la interfaz, y si en ese momento la selección todavía apuntara a
   * entidades recién borradas, el panel de información fallaría al consultar
   * sus medidas y la excepción dejaría la selección obsoleta para siempre.
   */
  edit<T>(label: string, fn: () => T): T {
    this.history.begin(this.model, label);
    try {
      const result = fn();
      pruneSelection(this.selection, this.geometry);
      this.history.commit();
      this.refreshModel();
      return result;
    } catch (err) {
      this.history.abort();
      pruneSelection(this.selection, this.geometry);
      this.refreshModel();
      throw err;
    }
  }

  undo(): void {
    const restored = this.history.undo(this.model);
    if (!restored) {
      this.setStatus('No hay nada que deshacer.');
      return;
    }
    this.model = restored;
    this.clampContext();
    clearSelection(this.selection);
    this.refreshModel();
  }

  redo(): void {
    const restored = this.history.redo(this.model);
    if (!restored) {
      this.setStatus('No hay nada que rehacer.');
      return;
    }
    this.model = restored;
    this.clampContext();
    clearSelection(this.selection);
    this.refreshModel();
  }

  /** Ajusta la ruta de contexto si el modelo restaurado ya no la contiene. */
  private clampContext(): void {
    const resolved = resolveContext(this.model, this.contextPath);
    this.contextPath = [...resolved.path];
  }

  /** Sustituye el modelo completo (al abrir un archivo). */
  replaceModel(model: Model): void {
    // La herramienta activa puede tener puntos del modelo anterior: sin
    // cancelarla, el siguiente clic dibujaba desde una esquina que ya no existe.
    this.tool.cancel?.();
    this.model = model;
    this.contextPath = [];
    clearSelection(this.selection);
    this.history.reset(model);
    this.refreshModel();
  }

  selectionSummary(): string {
    return describeSelection(this.selection);
  }

  // -------------------------------------------------------------------------
  // Entrada
  // -------------------------------------------------------------------------

  private attachEvents(): void {
    const el = this.viewport.renderer.domElement;
    el.tabIndex = 0;
    el.style.outline = 'none';

    el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    el.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerenter', () => { this.pointer.inside = true; });
    el.addEventListener('pointerleave', () => {
      this.pointer.inside = false;
      this.events.onTooltip?.('', 0, 0);
      this.refreshOverlay();
    });
  }

  private toolEvent(e: PointerEvent | MouseEvent): PointerInfo {
    return {
      clientX: e.clientX,
      clientY: e.clientY,
      button: 'button' in e ? e.button : 0,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey || e.metaKey,
      altKey: e.altKey,
    };
  }

  private onPointerDown(e: PointerEvent): void {
    (e.target as HTMLElement).focus?.();

    // Navegación con el botón central (o rueda) en cualquier herramienta.
    if (e.button === 1) {
      e.preventDefault();
      this.navigating = e.shiftKey ? 'pan' : 'orbit';
      this.navLast = { x: e.clientX, y: e.clientY };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      return;
    }

    this.tool?.onPointerDown?.(this.toolEvent(e));
  }

  private onPointerMove(e: PointerEvent): void {
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;

    if (this.navigating) {
      const dx = e.clientX - this.navLast.x;
      const dy = e.clientY - this.navLast.y;
      this.navLast = { x: e.clientX, y: e.clientY };
      if (this.navigating === 'orbit') this.viewport.cameraCtl.orbit(dx, dy);
      else this.viewport.cameraCtl.pan(dx, dy, this.viewport.size.height);
      this.viewport.invalidate();
      this.requestFrame();
      return;
    }

    this.tool?.onPointerMove?.(this.toolEvent(e));
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.navigating) {
      this.navigating = null;
      return;
    }
    this.tool?.onPointerUp?.(this.toolEvent(e));
  }

  private onDoubleClick(e: MouseEvent): void {
    this.tool?.onDoubleClick?.(this.toolEvent(e));
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    // Se respeta la magnitud del evento, acotada: un roce de dos dedos en un
    // panel táctil manda decenas de eventos de deltaY ≈ 4, y tratarlos como
    // una muesca completa de rueda (deltaY ≈ 100) disparaba la vista.
    const perLine = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const raw = (e.deltaY * perLine) / 100;
    const amount = -Math.sign(raw) * Math.min(Math.abs(raw), 3) * 1.1;
    if (amount === 0) return;
    // Zoom hacia el punto bajo el cursor.
    const ray = this.viewport.rayFromClient(e.clientX, e.clientY);
    let focus: Vec3 | undefined;
    const cache = this.viewport.builder.pick;
    let bestT = Infinity;
    for (const tri of cache.triangles) {
      const t = rayTriangleQuick(ray.origin, ray.dir, tri.a, tri.b, tri.c);
      if (t !== null && t < bestT) bestT = t;
    }
    if (bestT < Infinity) {
      focus = add(ray.origin, v3(ray.dir.x * bestT, ray.dir.y * bestT, ray.dir.z * bestT));
    } else {
      // Sin geometría: usar el plano del suelo.
      const denom = ray.dir.z;
      if (Math.abs(denom) > 1e-6) {
        const t = -ray.origin.z / denom;
        if (t > 0) focus = add(ray.origin, v3(ray.dir.x * t, ray.dir.y * t, ray.dir.z * t));
      }
    }
    this.viewport.cameraCtl.zoom(amount, focus);
    this.viewport.invalidate();
    this.requestFrame();
    this.tool?.onPointerMove?.({
      clientX: e.clientX, clientY: e.clientY, button: 0,
      shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey,
    });
  }

  /** Encaja todo el modelo en la vista. */
  zoomExtents(): void {
    const box = this.viewport.builder.pick.bounds;
    this.viewport.cameraCtl.zoomExtents(box);
    this.viewport.invalidate();
    this.requestFrame();
  }

  /** Encaja la selección en la vista. */
  zoomSelection(): void {
    const cache = this.viewport.builder.pick;
    const box = { min: v3(Infinity, Infinity, Infinity), max: v3(-Infinity, -Infinity, -Infinity) };
    let any = false;
    const expand = (p: Vec3) => {
      box.min = v3(Math.min(box.min.x, p.x), Math.min(box.min.y, p.y), Math.min(box.min.z, p.z));
      box.max = v3(Math.max(box.max.x, p.x), Math.max(box.max.y, p.y), Math.max(box.max.z, p.z));
      any = true;
    };
    for (const seg of cache.segments) {
      if (this.selection.edges.has(seg.edgeId) && seg.active) {
        expand(seg.a);
        expand(seg.b);
      }
    }
    for (const tri of cache.triangles) {
      if (this.selection.faces.has(tri.faceId) && tri.active) {
        expand(tri.a);
        expand(tri.b);
        expand(tri.c);
      }
    }
    for (const inst of cache.instanceBoxes) {
      if (this.selection.instances.has(inst.instanceId)) {
        expand(inst.box.min);
        expand(inst.box.max);
      }
    }
    if (!any) {
      this.zoomExtents();
      return;
    }
    this.viewport.cameraCtl.zoomExtents(box);
    this.viewport.invalidate();
    this.requestFrame();
  }
}

export interface PointerInfo {
  clientX: number;
  clientY: number;
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/** Möller–Trumbore reducido, sin asignaciones, para el zoom hacia el cursor. */
function rayTriangleQuick(o: Vec3, d: Vec3, a: Vec3, b: Vec3, c: Vec3): number | null {
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const px = d.y * e2.z - d.z * e2.y;
  const py = d.z * e2.x - d.x * e2.z;
  const pz = d.x * e2.y - d.y * e2.x;
  const det = e1.x * px + e1.y * py + e1.z * pz;
  if (Math.abs(det) < 1e-14) return null;
  const inv = 1 / det;
  const t1 = sub(o, a);
  const u = (t1.x * px + t1.y * py + t1.z * pz) * inv;
  if (u < 0 || u > 1) return null;
  const qx = t1.y * e1.z - t1.z * e1.y;
  const qy = t1.z * e1.x - t1.x * e1.z;
  const qz = t1.x * e1.y - t1.y * e1.x;
  const v = (d.x * qx + d.y * qy + d.z * qz) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = (e2.x * qx + e2.y * qy + e2.z * qz) * inv;
  return t > 1e-9 ? t : null;
}

export { dot };
