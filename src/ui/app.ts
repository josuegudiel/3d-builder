import '../style.css';
import { Viewport } from '../render/viewport';
import { Editor } from '../app/editor';
import { Tool } from '../tools/base';
import { SelectTool } from '../tools/select';
import {
  LineTool, RectangleTool, CircleTool, PolygonTool, ArcTool, Arc3Tool,
} from '../tools/drawing';
import {
  PushPullTool, MoveTool, RotateTool, ScaleTool, OffsetTool, FollowMeTool,
} from '../tools/modify';
import {
  EraserTool, PaintTool, TapeMeasureTool, DimensionTool, ProtractorTool,
  OrbitTool, PanTool, ZoomTool,
} from '../tools/utility';
import { AngleTool, selectionAngleSummary } from '../tools/angle';
import { icon } from './icons';
import { THEME } from '../render/theme';
import { Id } from '../core/model/types';
import { formatLength, formatArea, formatVolume, LengthUnit, LengthFormat, UNIT_NAME } from '../core/units';
import { faceArea } from '../core/topology/triangulate';
import {
  shellVolume, isSolid, faceComponent, flipFace, orientFacesConsistently,
} from '../core/topology/orient';
import { eraseEdges, eraseFaces, eraseInstances } from '../core/ops/erase';
import { makeGroup, explodeInstance } from '../core/ops/group';
import {
  selectAll, invertSelection, clearSelection, selectionSize, selectedEdgeSet,
} from '../core/selection';
import { serializeToJSON, deserializeModel } from '../core/io/serialize';
import { exportOBJ } from '../core/io/obj';
import { exportSTLBinary } from '../core/io/stl';
import { StandardView } from '../render/camera';
import { Model } from '../core/model/model';
import { AutoSave } from '../app/autosave';
import { Form3DApi } from '../app/api';
import { ContextMenu } from './contextmenu';
import { SOLIDS } from '../core/ops/solids';
import { openSolidDialog } from './solids-dialog';
import { BooleanOp, BOOLEAN_LABEL, booleanInstances, SolidOpResult } from '../core/ops/boolean';
import { intersectFaceSets } from '../core/ops/intersect';
import { rebuildFaces, collectCandidatePlanes } from '../core/topology/rebuild';
import { measureInstance, analyseJoint, JointReport, Member } from '../core/measure/member';
import { describeJoint, describeMember, jointLines } from '../core/measure/report';
import { CameraState } from '../render/camera';

interface ToolEntry {
  tool: Tool;
  iconName: string;
  shortcut?: string;
  group: number;
}

/** Construye y gobierna toda la interfaz de la aplicación. */
export class AppUI {
  readonly viewport: Viewport;
  readonly editor: Editor;
  /** Interfaz de automatización, disponible en `window.form3d.api`. */
  readonly api: Form3DApi;

  private tools: ToolEntry[] = [];
  private toolButtons = new Map<string, HTMLButtonElement>();

  private canvasWrap!: HTMLDivElement;
  private tipEl!: HTMLDivElement;
  private rectEl!: HTMLDivElement;
  private labelHost!: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private vcbLabel!: HTMLLabelElement;
  private vcbInput!: HTMLInputElement;
  private breadcrumbEl!: HTMLDivElement;
  private panelsEl!: HTMLDivElement;
  private infoBody!: HTMLDivElement;
  private outlinerBody!: HTMLDivElement;
  private swatchHost!: HTMLDivElement;
  private viewButtons!: HTMLElement;

  private paintTool!: PaintTool;
  private activeMaterial = 'blanco';
  private openMenu: HTMLElement | null = null;
  private autosave!: AutoSave;

  constructor(private readonly root: HTMLElement) {
    this.buildLayout();
    this.viewport = new Viewport(this.canvasWrap.querySelector('.canvas-host')!);
    this.editor = new Editor(this.viewport);
    this.api = new Form3DApi(this.editor);
    this.registerTools();
    this.buildToolbar();
    this.wireEvents();
    this.editor.setTool(this.tools[0].tool);
    this.editor.startRenderLoop();
    this.startLabelLoop();
    this.restoreSession();
    new ContextMenu(this.editor, this.canvasWrap);
    this.autosave = new AutoSave(() => this.editor.model);
    this.autosave.start();
    this.refreshPanels();
    window.addEventListener('resize', () => this.viewport.resize());
    // Un primer ajuste tras el diseño inicial.
    requestAnimationFrame(() => {
      this.viewport.resize();
      this.editor.refreshModel();
    });
  }

  // -------------------------------------------------------------------------
  // Construcción del DOM
  // -------------------------------------------------------------------------

  private buildLayout(): void {
    this.root.innerHTML = '';

    // --- Barra superior ----------------------------------------------------
    const top = el('div', 'topbar');
    const brand = el('div', 'brand');
    brand.innerHTML = `<span class="brand-mark">${icon('logo')}</span><span>Form3D</span>`;
    top.append(brand);

    top.append(
      this.buildMenu('Archivo', [
        { label: 'Nuevo', keys: 'Ctrl+N', action: () => this.newModel() },
        { label: 'Abrir…', keys: 'Ctrl+O', action: () => this.openFile() },
        { label: 'Guardar', keys: 'Ctrl+S', action: () => this.saveFile() },
        { sep: true },
        { label: 'Exportar OBJ', action: () => this.exportObj() },
        { label: 'Exportar STL', action: () => this.exportStl() },
        { label: 'Exportar imagen PNG', action: () => this.exportPng() },
      ]),
      this.buildMenu('Edición', [
        { label: 'Deshacer', keys: 'Ctrl+Z', action: () => this.editor.undo() },
        { label: 'Rehacer', keys: 'Ctrl+Y', action: () => this.editor.redo() },
        { sep: true },
        { label: 'Seleccionar todo', keys: 'Ctrl+A', action: () => this.doSelectAll() },
        { label: 'Invertir selección', action: () => this.doInvert() },
        { label: 'Borrar selección', keys: 'Supr', action: () => this.deleteSelection() },
        { sep: true },
        { label: 'Crear grupo', keys: 'Ctrl+G', action: () => this.doGroup('group') },
        { label: 'Crear componente', action: () => this.doGroup('component') },
        { label: 'Explotar', action: () => this.doExplode() },
        { sep: true },
        { label: 'Invertir caras', action: () => this.doFlipFaces() },
        { label: 'Orientar caras del sólido', action: () => this.doOrient() },
      ]),
      this.buildMenu('Insertar', SOLIDS.map((def) => ({
        label: def.label,
        action: () => openSolidDialog(this.editor, def),
      }))),
      this.buildMenu('Sólidos', [
        { label: 'Unir', action: () => this.doBoolean('union') },
        { label: 'Restar', action: () => this.doBoolean('subtract') },
        { label: 'Intersecar', action: () => this.doBoolean('intersect') },
        { sep: true },
        { label: 'Intersecar caras', action: () => this.doIntersectFaces() },
        { sep: true },
        { label: 'Medir la unión', action: () => this.doMeasureJoint() },
      ]),
      this.buildMenu('Ver', [
        { label: 'Encajar todo', keys: 'Mayús+Z', action: () => this.editor.zoomExtents() },
        {
          label: 'Encajar selección',
          action: () => {
            if (selectionSize(this.editor.selection) === 0) {
              this.editor.setStatus('No hay nada seleccionado: se encaja el modelo entero.');
            }
            this.editor.zoomSelection();
          },
        },
        { sep: true },
        { label: 'Superior', action: () => this.setView('top') },
        { label: 'Frontal', action: () => this.setView('front') },
        { label: 'Derecha', action: () => this.setView('right') },
        { label: 'Izquierda', action: () => this.setView('left') },
        { label: 'Posterior', action: () => this.setView('back') },
        { label: 'Isométrica', action: () => this.setView('iso') },
        { sep: true },
        { label: 'Alternar proyección paralela', action: () => this.toggleProjection() },
      ]),
      this.buildMenu('Ayuda', [
        { label: 'Atajos de teclado', keys: '?', action: () => this.showHelp() },
        { label: 'Cómo empezar', action: () => this.showGuide() },
      ]),
    );

    top.append(el('div', 'topbar-spacer'));

    this.breadcrumbEl = el('div', 'breadcrumb') as HTMLDivElement;
    top.append(this.breadcrumbEl);

    const unitSelect = el('select', 'unit-select') as HTMLSelectElement;
    const unitOptions: Array<[string, LengthFormat, LengthUnit]> = [
      [UNIT_NAME.mm, 'decimal', 'mm'],
      [UNIT_NAME.cm, 'decimal', 'cm'],
      [UNIT_NAME.m, 'decimal', 'm'],
      ['Pulgadas', 'fractional', 'in'],
      ['Pies y pulgadas', 'architectural', 'in'],
    ];
    for (const [label, format, unit] of unitOptions) {
      const opt = document.createElement('option');
      opt.value = `${format}|${unit}`;
      opt.textContent = label;
      unitSelect.append(opt);
    }
    unitSelect.value = 'decimal|mm';
    unitSelect.title = 'Unidades del modelo';
    unitSelect.addEventListener('change', () => {
      const [format, unit] = unitSelect.value.split('|') as [LengthFormat, LengthUnit];
      this.editor.setUnits({ format, unit, precision: unit === 'm' ? 3 : 1 });
      this.refreshPanels();
    });
    top.append(unitSelect);

    // --- Barra de herramientas --------------------------------------------
    const toolbar = el('div', 'toolbar');

    // --- Lienzo -------------------------------------------------------------
    this.canvasWrap = el('div', 'canvas-wrap') as HTMLDivElement;
    const host = el('div', 'canvas-host');
    this.tipEl = el('div', 'inference-tip') as HTMLDivElement;
    this.rectEl = el('div', 'selection-rect') as HTMLDivElement;
    this.labelHost = el('div', 'label-host') as HTMLDivElement;
    this.labelHost.style.cssText = 'position:absolute;inset:0;pointer-events:none;';

    const cube = el('div', 'view-cube');
    const views: Array<[string, StandardView, string]> = [
      ['Sup', 'top', 'superior'], ['Fr', 'front', 'frontal'], ['Der', 'right', 'derecha'],
      ['Iso', 'iso', 'isométrica'], ['Post', 'back', 'posterior'], ['Izq', 'left', 'izquierda'],
    ];
    for (const [label, view, name] of views) {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = `Vista ${name}`;
      b.dataset.view = view;
      b.addEventListener('click', () => this.setView(view));
      cube.append(b);
    }
    this.viewButtons = cube;

    const legend = el('div', 'axis-legend');
    legend.innerHTML =
      `<span><i style="background:${THEME.axisX}"></i>X</span>` +
      `<span><i style="background:${THEME.axisY}"></i>Y</span>` +
      `<span><i style="background:${THEME.axisZ}"></i>Z</span>`;

    this.canvasWrap.append(host, this.labelHost, this.tipEl, this.rectEl, cube, legend);

    // --- Paneles ------------------------------------------------------------
    this.panelsEl = el('div', 'panels') as HTMLDivElement;
    this.panelsEl.append(
      this.buildCard('Información', (body) => { this.infoBody = body; }),
      this.buildCard('Materiales', (body) => {
        this.swatchHost = el('div', 'swatches') as HTMLDivElement;
        body.append(this.swatchHost);
        const hint = el('div');
        hint.style.cssText = 'font-size:11.5px;color:var(--text-dim)';
        hint.textContent = 'Elige un color y usa la herramienta Pintar (B).';
        body.append(hint);
      }),
      this.buildCard('Estructura', (body) => {
        this.outlinerBody = el('div', 'outliner') as HTMLDivElement;
        body.append(this.outlinerBody);
      }),
      this.buildCard('Vista', (body) => {
        body.append(
          this.buildCheck('Rejilla', true, (v) => { this.viewport.options.showGrid = v; this.viewport.invalidate(); }),
          this.buildCheck('Ejes', true, (v) => { this.viewport.options.showAxes = v; this.viewport.invalidate(); }),
          this.buildCheck('Suelo', true, (v) => { this.viewport.options.showGround = v; this.viewport.invalidate(); }),
          this.buildCheck('Sombras', true, (v) => {
            this.viewport.options.showShadows = v;
            this.editor.refreshModel();
          }),
          this.buildCheck('Geometría oculta', false, (v) => {
            this.editor.renderOptions.showHiddenGeometry = v;
            this.editor.refreshModel();
          }),
          this.buildCheck('Aristas desnudas gruesas', true, (v) => {
            this.editor.renderOptions.showProfiles = v;
            this.editor.refreshModel();
          }, 'Dibuja más gruesas las aristas que no cierran ningún volumen, '
            + 'para localizar de un vistazo los huecos del modelo.'),
        );
        const styleField = el('label', 'field');
        styleField.innerHTML = '<span>Estilo de caras</span>';
        const sel = document.createElement('select');
        for (const [value, label] of [
          ['shaded', 'Sombreado con color'],
          ['monochrome', 'Monocromo'],
          ['hiddenline', 'Líneas ocultas'],
          ['wireframe', 'Alámbrico'],
        ] as const) {
          const o = document.createElement('option');
          o.value = value;
          o.textContent = label;
          sel.append(o);
        }
        sel.addEventListener('change', () => {
          this.editor.renderOptions.faceStyle = sel.value as never;
          this.editor.refreshModel();
        });
        styleField.append(sel);
        body.append(styleField);
      }),
    );

    // --- Barra de estado ----------------------------------------------------
    const status = el('div', 'statusbar');
    this.statusEl = el('div', 'status-text') as HTMLDivElement;
    const vcb = el('div', 'vcb');
    this.vcbLabel = el('label') as HTMLLabelElement;
    this.vcbLabel.textContent = 'Medidas';
    this.vcbInput = document.createElement('input');
    this.vcbInput.type = 'text';
    this.vcbInput.placeholder = '—';
    this.vcbInput.setAttribute('aria-label', 'Cuadro de medidas');
    vcb.append(this.vcbLabel, this.vcbInput);
    status.append(this.statusEl, vcb);

    this.root.append(top, toolbar, this.canvasWrap, this.panelsEl, status);
  }

  private buildMenu(
    title: string,
    items: Array<{ label?: string; keys?: string; action?: () => void; sep?: boolean }>,
  ): HTMLElement {
    const menu = el('div', 'menu');
    const btn = document.createElement('button');
    btn.textContent = title;
    const list = el('div', 'menu-list');

    for (const item of items) {
      if (item.sep) {
        list.append(el('div', 'menu-sep'));
        continue;
      }
      const b = el('button', 'menu-item') as HTMLButtonElement;
      b.innerHTML = `<span>${item.label}</span>${item.keys ? `<kbd>${item.keys}</kbd>` : ''}`;
      b.addEventListener('click', () => {
        this.closeMenus();
        item.action?.();
      });
      list.append(b);
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = menu.classList.contains('open');
      this.closeMenus();
      if (!wasOpen) {
        menu.classList.add('open');
        this.openMenu = menu;
      }
    });

    menu.append(btn, list);
    return menu;
  }

  private closeMenus(): void {
    this.openMenu?.classList.remove('open');
    this.openMenu = null;
  }

  private buildCard(title: string, fill: (body: HTMLDivElement) => void): HTMLElement {
    const card = el('div', 'card');
    const h = document.createElement('h3');
    h.textContent = title;
    const body = el('div', 'card-body') as HTMLDivElement;
    fill(body);
    card.append(h, body);
    return card;
  }

  private buildCheck(
    label: string,
    initial: boolean,
    onChange: (v: boolean) => void,
    title?: string,
  ): HTMLElement {
    const l = el('label', 'checkline');
    if (title) l.title = title;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = initial;
    input.addEventListener('change', () => onChange(input.checked));
    l.append(input, document.createTextNode(label));
    return l;
  }

  // -------------------------------------------------------------------------
  // Herramientas
  // -------------------------------------------------------------------------

  private registerTools(): void {
    const e = this.editor;
    this.paintTool = new PaintTool(e);
    this.tools = [
      { tool: new SelectTool(e), iconName: 'select', shortcut: 'v', group: 0 },
      { tool: new LineTool(e), iconName: 'line', shortcut: 'l', group: 1 },
      { tool: new RectangleTool(e), iconName: 'rectangle', shortcut: 'r', group: 1 },
      { tool: new CircleTool(e), iconName: 'circle', shortcut: 'c', group: 1 },
      { tool: new PolygonTool(e), iconName: 'polygon', shortcut: 'g', group: 1 },
      { tool: new ArcTool(e), iconName: 'arc', shortcut: 'a', group: 1 },
      { tool: new Arc3Tool(e), iconName: 'arc3', group: 1 },
      { tool: new PushPullTool(e), iconName: 'pushpull', shortcut: 'p', group: 2 },
      { tool: new MoveTool(e), iconName: 'move', shortcut: 'm', group: 2 },
      { tool: new RotateTool(e), iconName: 'rotate', shortcut: 'q', group: 2 },
      { tool: new ScaleTool(e), iconName: 'scale', shortcut: 's', group: 2 },
      { tool: new OffsetTool(e), iconName: 'offset', shortcut: 'f', group: 2 },
      { tool: new FollowMeTool(e), iconName: 'followme', group: 2 },
      { tool: new EraserTool(e), iconName: 'eraser', shortcut: 'e', group: 3 },
      { tool: this.paintTool, iconName: 'paint', shortcut: 'b', group: 3 },
      { tool: new TapeMeasureTool(e), iconName: 'tape', shortcut: 't', group: 4 },
      { tool: new DimensionTool(e), iconName: 'dimension', shortcut: 'd', group: 4 },
      { tool: new ProtractorTool(e), iconName: 'protractor', group: 4 },
      { tool: new AngleTool(e), iconName: 'angle', shortcut: 'n', group: 4 },
      { tool: new OrbitTool(e), iconName: 'orbit', shortcut: 'o', group: 5 },
      { tool: new PanTool(e), iconName: 'pan', shortcut: 'h', group: 5 },
      { tool: new ZoomTool(e), iconName: 'zoom', shortcut: 'z', group: 5 },
    ];
  }

  private buildToolbar(): void {
    const toolbar = this.root.querySelector('.toolbar')!;
    let lastGroup = -1;
    for (const entry of this.tools) {
      if (lastGroup !== -1 && entry.group !== lastGroup) {
        toolbar.append(el('div', 'tool-sep'));
      }
      lastGroup = entry.group;

      const b = el('button', 'tool-btn') as HTMLButtonElement;
      b.innerHTML = icon(entry.iconName);
      b.dataset.tip = entry.shortcut
        ? `${entry.tool.name} (${entry.shortcut.toUpperCase()})`
        : entry.tool.name;
      b.setAttribute('aria-label', entry.tool.name);
      b.addEventListener('click', () => this.editor.setTool(entry.tool));
      toolbar.append(b);
      this.toolButtons.set(entry.tool.id, b);
    }
  }

  // -------------------------------------------------------------------------
  // Conexión de eventos
  // -------------------------------------------------------------------------

  private wireEvents(): void {
    const e = this.editor;

    e.events.onStatus = (text) => { this.statusEl.textContent = text; };

    e.events.onToolChanged = (tool) => {
      for (const [id, btn] of this.toolButtons) btn.classList.toggle('active', id === tool.id);
      this.viewport.renderer.domElement.style.cursor = tool.cursor;
      this.vcbInput.value = '';
      this.vcbLabel.textContent = 'Medidas';
    };

    e.events.onMeasurement = (label, value, editable) => {
      this.vcbLabel.textContent = label || 'Medidas';
      if (document.activeElement !== this.vcbInput) this.vcbInput.value = value;
      this.vcbInput.disabled = !editable && !label;
    };

    e.events.onTooltip = (text, x, y) => {
      if (!text) {
        this.tipEl.classList.remove('visible');
        return;
      }
      const local = this.viewport.toLocal(x, y);
      this.tipEl.textContent = text;
      this.tipEl.style.left = `${local.x}px`;
      this.tipEl.style.top = `${local.y}px`;
      this.tipEl.classList.add('visible');
    };

    e.events.onSelectionRect = (rect) => {
      if (!rect) {
        this.rectEl.style.display = 'none';
        return;
      }
      this.rectEl.style.display = 'block';
      this.rectEl.classList.toggle('crossing', rect.crossing);
      this.rectEl.style.left = `${rect.x}px`;
      this.rectEl.style.top = `${rect.y}px`;
      this.rectEl.style.width = `${rect.w}px`;
      this.rectEl.style.height = `${rect.h}px`;
    };

    e.events.onModelChanged = () => {
      this.refreshPanels();
      this.autosave?.touch();
    };
    e.events.onContextChanged = () => this.refreshPanels();

    // Orbitar con el ratón deja de estar en una vista normalizada.
    this.viewport.renderer.domElement.addEventListener('pointerdown', (ev) => {
      if (ev.button === 1) this.markActiveView(null);
    });
    this.viewport.renderer.domElement.addEventListener('wheel', () => this.markActiveView(null));

    document.addEventListener('click', () => this.closeMenus());
    // El primer clic fuera de un menú abierto sólo lo descarta: sin esto,
    // cerrar el menú colocaba además el primer punto de la línea.
    this.viewport.renderer.domElement.addEventListener('pointerdown', (ev) => {
      if (this.openMenu) {
        this.closeMenus();
        ev.stopImmediatePropagation();
        ev.preventDefault();
      }
    }, true);
    window.addEventListener('keydown', (ev) => this.onKeyDown(ev));

    this.vcbInput.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') {
        ev.preventDefault();
        this.commitMeasurement();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        this.vcbInput.value = '';
        this.vcbInput.blur();
        this.viewport.renderer.domElement.focus();
      }
    });

    this.buildSwatches();
  }

  private commitMeasurement(): void {
    const text = this.vcbInput.value.trim();
    if (!text) return;
    const ok = this.editor.tool.onMeasurement?.(text) ?? false;
    if (ok) {
      this.vcbInput.value = '';
      this.viewport.renderer.domElement.focus();
    } else {
      this.vcbInput.select();
      this.editor.setStatus('No se pudo interpretar el valor. Ejemplos: 1200, 1.2m, 5\' 6", 30;20');
    }
  }

  private onKeyDown(ev: KeyboardEvent): void {
    // Con un diálogo abierto, el teclado es suyo.
    if (document.querySelector('.modal-backdrop')) {
      if (ev.key === 'Escape') {
        document.querySelector('.modal-backdrop')?.remove();
        ev.preventDefault();
      }
      return;
    }
    const target = ev.target as HTMLElement | null;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');

    // Combinaciones con Ctrl/Cmd: acciones de menú.
    if (ev.ctrlKey || ev.metaKey) {
      const k = ev.key.toLowerCase();
      const actions: Record<string, () => void> = {
        z: () => (ev.shiftKey ? this.editor.redo() : this.editor.undo()),
        y: () => this.editor.redo(),
        a: () => this.doSelectAll(),
        g: () => this.doGroup('group'),
        s: () => this.saveFile(),
        o: () => this.openFile(),
        n: () => this.newModel(),
      };
      const action = actions[k];
      if (action) {
        ev.preventDefault();
        action();
      }
      return;
    }

    if (typing) return;

    // Dígitos y símbolos numéricos → cuadro de medidas.
    if (/^[0-9.,\-/'"]$/.test(ev.key)) {
      this.vcbInput.focus();
      this.vcbInput.value = ev.key;
      ev.preventDefault();
      return;
    }

    // La herramienta activa tiene prioridad (bloqueo de ejes, Escape...).
    if (this.editor.tool.onKeyDown?.(ev)) {
      ev.preventDefault();
      return;
    }

    switch (ev.key) {
      case 'Escape':
        this.editor.tool.cancel?.();
        ev.preventDefault();
        return;
      case 'Delete':
      case 'Backspace':
        this.deleteSelection();
        ev.preventDefault();
        return;
      case 'Z':
        this.editor.zoomExtents();
        ev.preventDefault();
        return;
      case '?':
        this.showHelp();
        ev.preventDefault();
        return;
      default:
        break;
    }

    const key = ev.key.toLowerCase();
    const entry = this.tools.find((t) => t.shortcut === key);
    if (entry) {
      this.editor.setTool(entry.tool);
      ev.preventDefault();
    }
  }

  // -------------------------------------------------------------------------
  // Sesión
  // -------------------------------------------------------------------------

  /**
   * Recupera el trabajo de la sesión anterior, si lo hay. No se pregunta al
   * usuario: perder lo dibujado al recargar sin querer es mucho peor que
   * encontrarse el modelo tal y como se dejó, y siempre queda "Archivo ▸ Nuevo".
   */
  private restoreSession(): void {
    const model = AutoSave.restore();
    if (model && model.stats().edges > 0) {
      this.editor.replaceModel(model);
      const cam = AutoSave.restoreCamera<CameraState>();
      if (cam) this.viewport.cameraCtl.fromJSON(cam);
      else this.editor.zoomExtents();
      this.editor.setStatus('Recuperado el modelo de la sesión anterior.');
    }
    window.addEventListener('beforeunload', () => {
      AutoSave.saveCamera(this.viewport.cameraCtl.toJSON());
    });
  }

  // -------------------------------------------------------------------------
  // Acciones
  // -------------------------------------------------------------------------

  private setView(view: StandardView): void {
    this.viewport.cameraCtl.setStandardView(view);
    this.viewport.invalidate();
    this.markActiveView(view);
  }

  /**
   * Marca el botón de la vista activa. Se borra en cuanto el usuario orbita:
   * la cámara ya no está en ninguna vista normalizada.
   */
  private markActiveView(view: StandardView | null): void {
    for (const b of this.viewButtons.querySelectorAll('button')) {
      b.classList.toggle('active', b.dataset.view === view);
    }
  }

  private toggleProjection(): void {
    const ctl = this.viewport.cameraCtl;
    ctl.setMode(ctl.mode === 'perspective' ? 'parallel' : 'perspective');
    this.viewport.invalidate();
    this.editor.setStatus(
      ctl.mode === 'parallel' ? 'Proyección paralela' : 'Proyección en perspectiva',
    );
  }

  private doSelectAll(): void {
    selectAll(this.editor.selection, this.editor.geometry);
    this.editor.refreshModel();
    this.editor.setStatus(this.editor.selectionSummary());
  }

  private doInvert(): void {
    invertSelection(this.editor.selection, this.editor.geometry);
    this.editor.refreshModel();
  }

  private deleteSelection(): void {
    const sel = this.editor.selection;
    if (selectionSize(sel) === 0) return;
    const edges = [...sel.edges];
    const faces = [...sel.faces];
    const instances = [...sel.instances];
    this.editor.edit('Borrar', () => {
      const geo = this.editor.geometry;
      clearSelection(sel);
      eraseInstances(geo, instances);
      if (edges.length > 0) eraseEdges(geo, edges);
      const remaining = faces.filter((f) => geo.faces.has(f));
      if (remaining.length > 0) eraseFaces(geo, remaining);
    });
  }

  private doGroup(kind: 'group' | 'component'): void {
    if (selectionSize(this.editor.selection) === 0) {
      this.editor.setStatus('Selecciona algo antes de agrupar.');
      return;
    }
    let name = kind === 'group' ? 'Grupo' : 'Componente';
    if (kind === 'component') {
      const typed = window.prompt('Nombre del componente', 'Componente');
      if (typed === null) return;
      name = typed.trim() || 'Componente';
    }
    this.editor.edit(kind === 'group' ? 'Crear grupo' : 'Crear componente', () => {
      makeGroup(this.editor.model, this.editor.geometry, this.editor.selection, kind, name);
    });
  }

  private doExplode(): void {
    const instances = [...this.editor.selection.instances];
    if (instances.length === 0) {
      this.editor.setStatus('Selecciona un grupo o componente para explotarlo.');
      return;
    }
    this.editor.edit('Explotar', () => {
      for (const id of instances) {
        explodeInstance(this.editor.model, this.editor.geometry, id);
      }
    });
    clearSelection(this.editor.selection);
    this.editor.refreshModel();
  }

  private doFlipFaces(): void {
    const faces = [...this.editor.selection.faces];
    if (faces.length === 0) return;
    this.editor.edit('Invertir caras', () => {
      for (const f of faces) flipFace(this.editor.geometry, f);
    });
  }

  private doOrient(): void {
    const faces = [...this.editor.selection.faces];
    const geo = this.editor.geometry;
    const seeds = faces.length > 0 ? faces : [...geo.faces.keys()];
    if (seeds.length === 0) return;
    this.editor.edit('Orientar caras', () => {
      orientFacesConsistently(geo, seeds);
    });
  }

  // -------------------------------------------------------------------------
  // Sólidos
  // -------------------------------------------------------------------------

  /**
   * Une, resta o interseca los dos grupos seleccionados. Al terminar enseña el
   * informe de la unión, que es lo que hace falta para cortar las piezas.
   */
  private doBoolean(op: BooleanOp): void {
    const sel = this.editor.selection;
    if (sel.instances.size !== 2) {
      this.editor.setStatus(`${BOOLEAN_LABEL[op]}: selecciona exactamente dos grupos.`);
      return;
    }
    const [a, b] = [...sel.instances];
    const geo = this.editor.geometry;

    let result: SolidOpResult | null = null;
    this.editor.edit(BOOLEAN_LABEL[op], () => {
      result = booleanInstances(this.editor.model, geo, a, b, op);
      clearSelection(sel);
      if (result.ok && result.instanceId !== null) sel.instances.add(result.instanceId);
    });

    const r = result as SolidOpResult | null;
    if (!r) return;
    if (!r.ok) {
      this.editor.setStatus(`${BOOLEAN_LABEL[op]}: ${r.message}`);
      this.editor.undo();
      return;
    }

    const extra = r.solid ? '' : ' El resultado no es un sólido cerrado.';
    this.editor.setStatus(`${BOOLEAN_LABEL[op]}: hecho.${extra}`);
    if (r.joint) this.showJointReport(r.joint, r.members);
  }

  /**
   * Inserta las aristas donde se cruzan las caras seleccionadas con el resto
   * del contexto, sin borrar nada: es el paso previo a recortar a mano.
   */
  private doIntersectFaces(): void {
    const geo = this.editor.geometry;
    const sel = this.editor.selection;
    const selected = sel.faces.size > 0 ? [...sel.faces] : [...geo.faces.keys()];
    if (selected.length === 0) {
      this.editor.setStatus('No hay caras con las que intersecar.');
      return;
    }
    const others = [...geo.faces.keys()].filter((f) => !selected.includes(f));
    const target = others.length > 0 ? others : selected;

    let created = 0;
    this.editor.edit('Intersecar caras', () => {
      const r = intersectFaceSets(geo, selected, target);
      created = r.edges.length;
      if (created > 0) {
        rebuildFaces(geo, collectCandidatePlanes(geo, r.edges), { newEdges: new Set(r.edges) });
      }
    });
    this.editor.setStatus(created > 0
      ? `Intersecar caras: ${created} arista(s) nuevas.`
      : 'Intersecar caras: no hay cruces.');
  }

  /** Informe de la unión entre las dos piezas seleccionadas, sin modificarlas. */
  private doMeasureJoint(): void {
    const geo = this.editor.geometry;
    const sel = this.editor.selection;
    if (sel.instances.size === 2) {
      const [a, b] = [...sel.instances];
      const ma = measureInstance(this.editor.model, geo, a);
      const mb = measureInstance(this.editor.model, geo, b);
      if (ma && mb) {
        this.showJointReport(analyseJoint(ma, mb), [ma, mb]);
        return;
      }
    }
    this.editor.setStatus('Medir la unión: selecciona dos grupos.');
  }

  private showJointReport(joint: JointReport, members: [Member | null, Member | null]): void {
    const lines = jointLines(joint, members, this.editor.units);
    const html = lines.map((l) => row(l.label, escapeHtml(l.value))).join('');
    this.showModal('Unión entre piezas', html);
    this.editor.setStatus(describeJoint(joint, this.editor.units));
  }

  private newModel(): void {
    if (!window.confirm('¿Empezar un modelo nuevo? Se perderán los cambios no guardados.')) return;
    AutoSave.clear();
    this.editor.replaceModel(new Model());
    this.buildSwatches();
    this.editor.zoomExtents();
  }

  private saveFile(): void {
    const json = serializeToJSON(this.editor.model, 2);
    download(new Blob([json], { type: 'application/json' }), `${safeFileName(this.editor.model.name)}.form3d.json`);
    this.editor.setStatus('Modelo guardado.');
  }

  private openFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.form3d,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const model = deserializeModel(text);
        this.editor.replaceModel(model);
        this.editor.zoomExtents();
        this.editor.setStatus(`Abierto: ${file.name}`);
      } catch (err) {
        window.alert(`No se pudo abrir el archivo.\n${(err as Error).message}`);
      }
    });
    input.click();
  }

  private exportObj(): void {
    const { obj, mtl } = exportOBJ(this.editor.model);
    download(new Blob([obj], { type: 'text/plain' }), `${safeFileName(this.editor.model.name)}.obj`);
    download(new Blob([mtl], { type: 'text/plain' }), 'form3d.mtl');
    this.editor.setStatus('Exportado a OBJ.');
  }

  private exportStl(): void {
    const buffer = exportSTLBinary(this.editor.model);
    download(new Blob([buffer], { type: 'model/stl' }), `${safeFileName(this.editor.model.name)}.stl`);
    this.editor.setStatus('Exportado a STL (milímetros).');
  }

  private exportPng(): void {
    this.viewport.forceRender();
    this.viewport.renderer.domElement.toBlob((blob) => {
      if (blob) {
        download(blob, `${safeFileName(this.editor.model.name)}.png`);
        this.editor.setStatus('Imagen guardada.');
      }
    }, 'image/png');
  }

  // -------------------------------------------------------------------------
  // Paneles
  // -------------------------------------------------------------------------

  private buildSwatches(): void {
    this.swatchHost.innerHTML = '';
    for (const m of this.editor.model.materials.values()) {
      const b = el('button', 'swatch') as HTMLButtonElement;
      b.style.background = m.color;
      b.title = m.name;
      b.setAttribute('aria-label', m.name);
      b.classList.toggle('active', m.id === this.activeMaterial);
      b.addEventListener('click', () => {
        this.activeMaterial = m.id;
        this.paintTool.material = m.id;
        this.buildSwatches();
        this.editor.setTool(this.paintTool);
      });
      this.swatchHost.append(b);
    }
  }

  private refreshPanels(): void {
    this.refreshBreadcrumb();
    this.refreshInfo();
    this.refreshOutliner();
  }

  private refreshBreadcrumb(): void {
    const labels = this.editor.contextLabel();
    this.breadcrumbEl.innerHTML = labels
      .map((l, i) => (i === labels.length - 1 ? `<b>${escapeHtml(l)}</b>` : escapeHtml(l)))
      .join(' › ');
    if (labels.length > 1) {
      const btn = el('button', 'crumb-exit') as HTMLButtonElement;
      btn.textContent = 'Salir';
      btn.addEventListener('click', () => this.editor.exitContext());
      this.breadcrumbEl.append(btn);
    }
  }

  private refreshInfo(): void {
    const geo = this.editor.geometry;
    const sel = this.editor.selection;
    const units = this.editor.units;
    const rows: string[] = [];

    const stats = this.editor.model.visibleStats();
    rows.push(row('Aristas', String(stats.edges)));
    rows.push(row('Caras', String(stats.faces)));
    rows.push(row('Grupos', String(stats.instances)));

    if (sel.faces.size > 0) {
      let area = 0;
      for (const f of sel.faces) area += faceArea(geo, f);
      rows.push(row('Área seleccionada', formatArea(area, units)));
    }
    if (sel.edges.size > 0) {
      let total = 0;
      for (const e of selectedEdgeSet(sel, geo)) total += geo.edgeLength(e);
      rows.push(row('Longitud total', formatLength(total, units)));
      if (sel.edges.size === 1) {
        const id = [...sel.edges][0];
        rows.push(row('Longitud', formatLength(geo.edgeLength(id), units)));
      }
    }

    // Volumen del sólido que contiene la primera cara seleccionada.
    if (sel.faces.size > 0) {
      const seed = [...sel.faces][0];
      const comp = faceComponent(geo, seed);
      if (isSolid(geo, comp)) {
        rows.push(row('Volumen del sólido', formatVolume(Math.abs(shellVolume(geo, comp)), units)));
      }
    }

    if (sel.instances.size === 1) {
      const inst = geo.instances.get([...sel.instances][0]);
      const def = inst ? this.editor.model.definitions.get(inst.definitionId) : null;
      if (def) {
        rows.push(row('Definición', escapeHtml(def.name)));
        rows.push(row('Tipo', def.kind === 'group' ? 'Grupo' : 'Componente'));
        rows.push(row('Instancias', String(def.instanceCount)));
      }
    }

    // Ángulos de la selección: diedro de una arista, ángulo entre dos aristas
    // o entre dos caras, y unión completa entre dos piezas.
    const angle = selectionAngleSummary(
      geo, [...sel.edges], [...sel.faces], units,
    );
    if (angle) rows.push(row('Ángulo', escapeHtml(angle)));

    if (sel.instances.size === 2) {
      const [ia, ib] = [...sel.instances];
      const ma = measureInstance(this.editor.model, geo, ia);
      const mb = measureInstance(this.editor.model, geo, ib);
      if (ma && mb) {
        rows.push(row('Pieza 1', escapeHtml(describeMember(ma, units))));
        rows.push(row('Pieza 2', escapeHtml(describeMember(mb, units))));
        rows.push(row('Unión', escapeHtml(describeJoint(analyseJoint(ma, mb), units))));
      }
    } else if (sel.instances.size === 1) {
      const m = measureInstance(this.editor.model, geo, [...sel.instances][0]);
      if (m) rows.push(row('Pieza', escapeHtml(describeMember(m, units))));
    }

    rows.push(row('Selección', escapeHtml(this.editor.selectionSummary())));
    this.infoBody.innerHTML = rows.join('');
  }

  private refreshOutliner(): void {
    const geo = this.editor.geometry;
    this.outlinerBody.innerHTML = '';
    if (geo.instances.size === 0) {
      const p = el('div');
      p.style.cssText = 'color:var(--text-dim);font-size:11.5px';
      p.textContent = 'Sin grupos. Selecciona geometría y pulsa Ctrl+G.';
      this.outlinerBody.append(p);
      return;
    }
    for (const inst of geo.instances.values()) {
      const def = this.editor.model.definitions.get(inst.definitionId);
      const item = el('div', 'outliner-item');
      item.classList.toggle('selected', this.editor.selection.instances.has(inst.id));
      item.innerHTML = `<span style="width:14px;display:inline-block">${
        def?.kind === 'component' ? '◈' : '▣'}</span><span>${
        escapeHtml(inst.name || def?.name || 'Grupo')}</span>`;
      item.addEventListener('click', () => {
        clearSelection(this.editor.selection);
        this.editor.selection.instances.add(inst.id);
        this.editor.refreshModel();
      });
      item.addEventListener('dblclick', () => this.editor.enterContext(inst.id));
      this.outlinerBody.append(item);
    }
  }

  /** Coloca los textos de las cotas siguiendo a la cámara. */
  private startLabelLoop(): void {
    const pool: HTMLDivElement[] = [];
    const tick = () => {
      const labels = this.viewport.builder.pick.labels;
      while (pool.length < labels.length) {
        const d = el('div', 'dim-label') as HTMLDivElement;
        this.labelHost.append(d);
        pool.push(d);
      }
      for (let i = 0; i < pool.length; i++) {
        const d = pool[i];
        const label = labels[i];
        if (!label) {
          d.style.display = 'none';
          continue;
        }
        const s = this.viewport.worldToScreen(label.position);
        if (!Number.isFinite(s.x) || s.depth <= 0) {
          d.style.display = 'none';
          continue;
        }
        const dim = label.kind === 'dimension' ? this.editor.model.dimensions.get(label.id) : undefined;
        const text = label.text || (dim
          ? formatLength(dist3(dim.a, dim.b), this.editor.units)
          : '');
        d.textContent = text;
        d.style.display = 'block';
        d.style.left = `${s.x}px`;
        d.style.top = `${s.y}px`;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // -------------------------------------------------------------------------
  // Diálogos
  // -------------------------------------------------------------------------

  private showHelp(): void {
    const sections: Array<[string, Array<[string, string]>]> = [
      ['Herramientas', this.tools
        .filter((t) => t.shortcut)
        .map((t) => [t.shortcut!.toUpperCase(), t.tool.name] as [string, string])],
      ['Navegación', [
        ['Rueda', 'Acercar o alejar hacia el cursor'],
        ['Botón central', 'Orbitar'],
        ['Mayús + botón central', 'Desplazar'],
        ['Mayús+Z', 'Encajar todo el modelo'],
      ]],
      ['Dibujo', [
        ['Escribir un número', 'Fija la medida exacta y pulsa Intro'],
        ['30;20', 'Ancho y alto de un rectángulo'],
        ['24s', 'Número de lados de círculos y polígonos'],
        ['→ ↑ ←', 'Bloquear el eje rojo, azul o verde'],
        ['↓', 'Quitar el bloqueo de eje'],
        ['Alt', 'Desactivar el enganche mientras se pulsa'],
        ['Esc', 'Cancelar la operación en curso'],
      ]],
      ['Edición', [
        ['Ctrl+Z / Ctrl+Y', 'Deshacer y rehacer'],
        ['Ctrl+G', 'Crear grupo con la selección'],
        ['Ctrl+A', 'Seleccionar todo'],
        ['Supr', 'Borrar la selección'],
        ['Doble clic en un grupo', 'Entrar a editarlo'],
        ['Ctrl (Mover/Girar)', 'Copiar en lugar de mover'],
        ['Ctrl (Empujar/Tirar)', 'Crear geometría nueva'],
      ]],
    ];

    const body = sections.map(([title, items]) =>
      `<h4>${title}</h4>` + items.map(([k, v]) => `<kbd>${escapeHtml(k)}</kbd><span>${escapeHtml(v)}</span>`).join(''),
    ).join('');

    this.showModal('Atajos de teclado', `<div class="help-grid">${body}</div>`);
  }

  private showGuide(): void {
    this.showModal('Cómo empezar', `
      <ol style="padding-left:18px;line-height:1.75">
        <li>Pulsa <kbd>R</kbd> y dibuja un rectángulo en el suelo.</li>
        <li>Puedes hacer clic en una esquina y otro clic en la opuesta, o
            arrastrar de una a otra. Antes de cerrar, escribe <b>4000;3000</b> y
            pulsa <kbd>Intro</kbd>: tendrás 4 × 3 metros exactos.</li>
        <li>Pulsa <kbd>P</kbd> (Empujar/Tirar), haz clic en la cara y muévete hacia arriba.
            Escribe <b>2500</b> y pulsa <kbd>Intro</kbd> para una altura exacta.</li>
        <li>Con <kbd>L</kbd> dibuja líneas sobre las caras para dividirlas: cada contorno
            cerrado se convierte en una cara nueva que también puedes empujar.</li>
        <li>Usa <kbd>D</kbd> para acotar y <kbd>T</kbd> para medir.</li>
        <li><kbd>Ctrl+G</kbd> agrupa lo seleccionado; doble clic entra en el grupo.</li>
        <li><kbd>N</kbd> es la herramienta Ángulo: señala una arista y verás su
            diedro; elige dos aristas, dos caras o dos piezas y te dará el
            ángulo, y en el caso de dos piezas también el inglete y el bisel con
            que hay que cortar cada una.</li>
        <li>Con dos grupos seleccionados, <b>Sólidos ▸ Unir</b> los convierte en
            una sola pieza y enseña el informe de la unión. También hay
            <b>Restar</b> e <b>Intersecar</b>.</li>
      </ol>
      <p style="color:var(--text-dim)">Todas las medidas se escriben en el cuadro inferior derecho.
      Acepta <b>1200</b>, <b>1.2m</b>, <b>120cm</b> y también <b>5' 6"</b>.</p>
    `);
  }

  private showModal(title: string, html: string): void {
    // Un solo diálogo a la vez: pulsar el atajo con uno abierto lo reemplaza en
    // lugar de apilar copias idénticas.
    for (const old of document.querySelectorAll('.modal-backdrop')) old.remove();

    const backdrop = el('div', 'modal-backdrop');
    const modal = el('div', 'modal');
    modal.innerHTML = `<h2>${escapeHtml(title)}</h2>${html}`;
    const row2 = el('div', 'btn-row');
    const close = el('button', 'btn') as HTMLButtonElement;
    close.textContent = 'Cerrar';
    close.addEventListener('click', () => backdrop.remove());
    row2.append(close);
    modal.append(row2);
    backdrop.append(modal);
    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) backdrop.remove();
    });
    // El teclado no debe llegar a la aplicación mientras el diálogo esté
    // abierto: escribir un número enfocaba el cuadro de medidas que quedaba
    // debajo. Escape cierra, como en cualquier diálogo.
    backdrop.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') backdrop.remove();
      ev.stopPropagation();
    });
    backdrop.tabIndex = -1;
    document.body.append(backdrop);
    // Enfocar sin arrastrar el desplazamiento: enfocar el botón «Cerrar»
    // llevaba el diálogo de atajos hasta el final, ocultando lo importante.
    backdrop.focus({ preventScroll: true });
    modal.scrollTop = 0;
  }
}

// ---------------------------------------------------------------------------
// Utilidades del DOM
// ---------------------------------------------------------------------------

function el(tag: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function row(label: string, value: string): string {
  return `<div class="row"><span>${escapeHtml(label)}</span><b>${value}</b></div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

/**
 * Nombre de archivo seguro para el atributo `download`.
 *
 * Algunos navegadores descartan el atributo entero —y descargan un fichero
 * llamado «download», sin extensión— si contiene caracteres no ASCII. El
 * nombre por defecto del modelo, «Sin título», caía justo en ese caso.
 */
function safeFileName(name: string): string {
  const base = (name || 'modelo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // quita las tildes
    .replace(/[^A-Za-z0-9 ._-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return base || 'modelo';
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dist3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export type { Id };
