import { Editor } from '../app/editor';
import { SolidDefinition } from '../core/ops/solids';
import { parseLength, formatLengthBare } from '../core/units';
import { matTranslation } from '../core/math/mat';
import { v3 } from '../core/math/vec';
import { quantize } from '../core/math/tolerance';

/**
 * Diálogo para insertar un sólido paramétrico escribiendo sus medidas.
 *
 * Las longitudes se escriben con la misma sintaxis que el cuadro de medidas
 * (1200, 1.2m, 5' 6"...), de modo que no hay dos formas distintas de teclear
 * una dimensión en la aplicación.
 */
export function openSolidDialog(editor: Editor, def: SolidDefinition): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.width = 'min(380px, 92vw)';

  const title = document.createElement('h2');
  title.textContent = `Insertar ${def.label.toLowerCase()}`;
  modal.append(title);

  const hint = document.createElement('p');
  hint.style.cssText = 'margin:0 0 12px;color:var(--text-dim);font-size:12px';
  hint.textContent = 'Escribe las medidas. Se admite 1200, 1.2m, 120cm o 5\' 6".';
  modal.append(hint);

  const inputs = new Map<string, HTMLInputElement>();
  const errorEl = document.createElement('div');
  errorEl.style.cssText = 'color:var(--danger);font-size:12px;min-height:16px';

  for (const param of def.params) {
    const field = document.createElement('label');
    field.className = 'field';
    field.style.marginBottom = '8px';
    const span = document.createElement('span');
    span.textContent = param.label;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = param.kind === 'length'
      ? formatLengthBare(param.defaultValue, editor.units)
      : String(param.defaultValue);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        accept();
      }
    });
    field.append(span, input);
    modal.append(field);
    inputs.set(param.key, input);
  }

  modal.append(errorEl);

  const row = document.createElement('div');
  row.className = 'btn-row';
  const cancel = document.createElement('button');
  cancel.className = 'btn';
  cancel.textContent = 'Cancelar';
  cancel.addEventListener('click', () => backdrop.remove());
  const ok = document.createElement('button');
  ok.className = 'btn';
  ok.textContent = 'Insertar';
  ok.style.cssText = 'border-color:var(--accent);color:var(--accent);font-weight:600';
  ok.addEventListener('click', () => accept());
  row.append(cancel, ok);
  modal.append(row);

  backdrop.append(modal);
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) backdrop.remove();
  });
  document.body.append(backdrop);
  inputs.get(def.params[0].key)?.select();
  inputs.get(def.params[0].key)?.focus();

  function accept(): void {
    const values: Record<string, number> = {};
    for (const param of def.params) {
      const raw = inputs.get(param.key)!.value.trim();
      if (param.kind === 'length') {
        const v = parseLength(raw, { defaultUnit: editor.units.unit, allowNegative: false });
        if (v === null || v <= 0) {
          errorEl.textContent = `«${param.label}» no es una medida válida.`;
          inputs.get(param.key)!.focus();
          return;
        }
        values[param.key] = v;
      } else {
        const n = Number.parseInt(raw, 10);
        const min = param.min ?? 1;
        if (!Number.isInteger(n) || n < min) {
          errorEl.textContent = `«${param.label}» debe ser un número entero ≥ ${min}.`;
          inputs.get(param.key)!.focus();
          return;
        }
        values[param.key] = n;
      }
    }

    backdrop.remove();
    insertSolid(editor, def, values);
  }
}

/**
 * Crea el sólido dentro de un grupo nuevo y lo coloca sobre el suelo, centrado
 * en el punto al que mira la cámara para que aparezca a la vista.
 */
export function insertSolid(
  editor: Editor,
  def: SolidDefinition,
  values: Record<string, number>,
): void {
  const target = editor.viewport.cameraCtl.target;
  const step = Math.max(0.001, editor.viewport.cameraCtl.distance * 0.02);
  const origin = v3(quantize(target.x, step), quantize(target.y, step), 0);

  editor.edit(`Insertar ${def.label.toLowerCase()}`, () => {
    const definition = editor.model.createDefinition('group', def.label);
    def.build(definition.geometry, values);
    const instId = editor.geometry.addInstance({
      definitionId: definition.id,
      transform: matTranslation(editor.toContext(origin)),
      name: def.label,
      materialId: null,
      hidden: false,
      locked: false,
    });
    editor.model.recountInstances();
    editor.selection.faces.clear();
    editor.selection.edges.clear();
    editor.selection.vertices.clear();
    editor.selection.instances.clear();
    editor.selection.instances.add(instId);
  });

  editor.setStatus(`${def.label} insertado. Doble clic para editarlo, M para moverlo.`);
}
