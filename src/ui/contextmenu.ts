import { Editor } from '../app/editor';
import { pickEntity } from '../pick/picker';
import {
  clearSelection, selectionSize, selectConnected, selectCoplanar, selectAll,
} from '../core/selection';
import { eraseEdges, eraseFaces, eraseInstances } from '../core/ops/erase';
import { makeGroup, explodeInstance, makeUnique } from '../core/ops/group';
import { flipFace, orientFacesConsistently, faceComponent, isSolid, shellVolume } from '../core/topology/orient';
import { faceArea } from '../core/topology/triangulate';
import { formatArea, formatLength, formatVolume } from '../core/units';
import { Id } from '../core/model/types';

interface MenuItem {
  label?: string;
  action?: () => void;
  disabled?: boolean;
  sep?: boolean;
  info?: boolean;
}

/**
 * Menú contextual del botón derecho. En SketchUp es donde vive la mitad de las
 * acciones, así que aquí reproduce las más usadas y además muestra las medidas
 * de lo que hay bajo el cursor.
 */
export class ContextMenu {
  private el: HTMLDivElement | null = null;

  constructor(private readonly editor: Editor, private readonly host: HTMLElement) {
    const canvas = editor.viewport.renderer.domElement;
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.openAt(e.clientX, e.clientY);
    });
    window.addEventListener('pointerdown', (e) => {
      if (this.el && !this.el.contains(e.target as Node)) this.close();
    }, true);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  close(): void {
    this.el?.remove();
    this.el = null;
  }

  private openAt(clientX: number, clientY: number): void {
    this.close();
    const editor = this.editor;
    const geo = editor.geometry;

    // Si se pulsa sobre algo no seleccionado, pasa a ser la selección.
    const hit = pickEntity(
      editor.viewport.builder.pick, editor.viewport, clientX, clientY,
    );
    if (hit) {
      const kind = hit.kind === 'vertex' ? 'vertex' : hit.kind;
      const already =
        (kind === 'face' && editor.selection.faces.has(hit.id)) ||
        (kind === 'edge' && editor.selection.edges.has(hit.id)) ||
        (kind === 'instance' && editor.selection.instances.has(hit.id));
      if (!already) {
        clearSelection(editor.selection);
        if (kind === 'face') editor.selection.faces.add(hit.id);
        else if (kind === 'edge') editor.selection.edges.add(hit.id);
        else if (kind === 'instance') editor.selection.instances.add(hit.id);
        else if (kind === 'vertex') editor.selection.vertices.add(hit.id);
        editor.refreshModel();
      }
    }

    const sel = editor.selection;
    const items: MenuItem[] = [];

    // --- Medidas de lo señalado --------------------------------------------
    if (hit?.kind === 'face' && geo.faces.has(hit.id)) {
      items.push({ label: `Área: ${formatArea(faceArea(geo, hit.id), editor.units)}`, info: true });
      const comp = faceComponent(geo, hit.id);
      if (isSolid(geo, comp)) {
        items.push({
          label: `Volumen: ${formatVolume(Math.abs(shellVolume(geo, comp)), editor.units)}`,
          info: true,
        });
      }
      items.push({ sep: true });
    } else if (hit?.kind === 'edge' && geo.edges.has(hit.id)) {
      items.push({ label: `Longitud: ${formatLength(geo.edgeLength(hit.id), editor.units)}`, info: true });
      items.push({ sep: true });
    }

    // --- Grupos --------------------------------------------------------------
    if (sel.instances.size === 1) {
      const instId = [...sel.instances][0];
      items.push({ label: 'Entrar a editar', action: () => editor.enterContext(instId) });
      items.push({
        label: 'Explotar',
        action: () => editor.edit('Explotar', () => {
          explodeInstance(editor.model, geo, instId);
        }),
      });
      const inst = geo.instances.get(instId);
      const def = inst ? editor.model.definitions.get(inst.definitionId) : null;
      if (def && def.instanceCount > 1) {
        items.push({
          label: 'Hacer único',
          action: () => editor.edit('Hacer único', () => {
            makeUnique(editor.model, geo, instId);
          }),
        });
      }
      items.push({ sep: true });
    }

    if (selectionSize(sel) > 0) {
      items.push({
        label: 'Crear grupo',
        action: () => editor.edit('Crear grupo', () => {
          makeGroup(editor.model, geo, sel, 'group');
        }),
      });
      items.push({
        label: 'Crear componente…',
        action: () => {
          const name = window.prompt('Nombre del componente', 'Componente');
          if (name === null) return;
          editor.edit('Crear componente', () => {
            makeGroup(editor.model, geo, sel, 'component', name.trim() || 'Componente');
          });
        },
      });
      items.push({ sep: true });
    }

    // --- Caras ---------------------------------------------------------------
    if (sel.faces.size > 0) {
      const faces = [...sel.faces];
      items.push({
        label: 'Invertir caras',
        action: () => editor.edit('Invertir caras', () => {
          for (const f of faces) flipFace(geo, f);
        }),
      });
      items.push({
        label: 'Orientar el sólido',
        action: () => editor.edit('Orientar caras', () => {
          orientFacesConsistently(geo, faces);
        }),
      });
      items.push({
        label: 'Seleccionar caras coplanares',
        action: () => {
          const seed = faces[0];
          selectCoplanar(sel, geo, seed);
          editor.refreshModel();
        },
      });
    }

    if (hit && (hit.kind === 'face' || hit.kind === 'edge')) {
      items.push({
        label: 'Seleccionar todo lo conectado',
        action: () => {
          clearSelection(sel);
          selectConnected(sel, geo, { kind: hit.kind as 'face' | 'edge', id: hit.id });
          editor.refreshModel();
        },
      });
    }

    // --- Aristas -------------------------------------------------------------
    if (sel.edges.size > 0) {
      const edges = [...sel.edges];
      items.push({ sep: true });
      items.push({
        label: 'Suavizar aristas',
        action: () => editor.edit('Suavizar', () => {
          for (const id of edges) {
            const e = geo.edges.get(id);
            if (e) {
              e.soft = true;
              e.smooth = true;
            }
          }
        }),
      });
      items.push({
        label: 'Quitar suavizado',
        action: () => editor.edit('Quitar suavizado', () => {
          for (const id of edges) {
            const e = geo.edges.get(id);
            if (e) {
              e.soft = false;
              e.smooth = false;
            }
          }
        }),
      });
    }

    // --- Visibilidad y borrado ------------------------------------------------
    if (selectionSize(sel) > 0) {
      items.push({ sep: true });
      items.push({
        label: 'Ocultar',
        action: () => editor.edit('Ocultar', () => {
          for (const f of sel.faces) {
            const face = geo.faces.get(f);
            if (face) face.hidden = true;
          }
          for (const e of sel.edges) {
            const edge = geo.edges.get(e);
            if (edge) edge.hidden = true;
          }
          for (const i of sel.instances) {
            const inst = geo.instances.get(i);
            if (inst) inst.hidden = true;
          }
          clearSelection(sel);
        }),
      });
      items.push({
        label: 'Borrar',
        action: () => {
          const faces = [...sel.faces];
          const edges = [...sel.edges];
          const instances = [...sel.instances];
          editor.edit('Borrar', () => {
            eraseInstances(geo, instances);
            if (edges.length) eraseEdges(geo, edges);
            const remaining = faces.filter((f) => geo.faces.has(f));
            if (remaining.length) eraseFaces(geo, remaining);
          });
          clearSelection(sel);
          editor.refreshModel();
        },
      });
      items.push({
        label: 'Encajar la selección',
        action: () => editor.zoomSelection(),
      });
    }

    items.push({ sep: true });
    items.push({
      label: 'Mostrar todo',
      action: () => editor.edit('Mostrar todo', () => {
        for (const f of geo.faces.values()) f.hidden = false;
        for (const e of geo.edges.values()) e.hidden = false;
        for (const i of geo.instances.values()) i.hidden = false;
      }),
    });
    items.push({
      label: 'Seleccionar todo',
      action: () => {
        selectAll(sel, geo);
        editor.refreshModel();
      },
    });
    if (editor.contextPath.length > 0) {
      items.push({ label: 'Salir del grupo', action: () => editor.exitContext() });
    }
    if (editor.model.guides.size > 0) {
      items.push({
        label: 'Eliminar guías',
        action: () => editor.edit('Eliminar guías', () => editor.model.clearGuides()),
      });
    }

    this.render(items, clientX, clientY);
  }

  private render(items: MenuItem[], clientX: number, clientY: number): void {
    const menu = document.createElement('div');
    menu.className = 'menu-list context-menu';
    menu.style.position = 'fixed';
    menu.style.display = 'block';
    menu.style.zIndex = '90';

    for (const item of items) {
      if (item.sep) {
        const s = document.createElement('div');
        s.className = 'menu-sep';
        menu.append(s);
        continue;
      }
      if (item.info) {
        const d = document.createElement('div');
        d.className = 'menu-item';
        d.style.cssText = 'color:var(--text-dim);font-variant-numeric:tabular-nums;cursor:default';
        d.textContent = item.label ?? '';
        menu.append(d);
        continue;
      }
      const b = document.createElement('button');
      b.className = 'menu-item';
      b.textContent = item.label ?? '';
      b.disabled = !!item.disabled;
      b.addEventListener('click', () => {
        this.close();
        item.action?.();
      });
      menu.append(b);
    }

    document.body.append(menu);
    const rect = menu.getBoundingClientRect();
    const x = Math.min(clientX, window.innerWidth - rect.width - 8);
    const y = Math.min(clientY, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(4, x)}px`;
    menu.style.top = `${Math.max(4, y)}px`;
    this.el = menu;
    void this.host;
  }
}

export type { Id };
