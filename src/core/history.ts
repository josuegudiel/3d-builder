import { Model } from './model/model';
import { serializeModel, deserializeModel, ModelFile } from './io/serialize';

interface Snapshot {
  label: string;
  data: ModelFile;
}

/**
 * Pila de deshacer/rehacer basada en instantáneas completas del modelo.
 *
 * Es la estrategia más segura para un modelador con topología derivada: no hay
 * forma de que una operación inversa mal implementada deje el modelo en un
 * estado incoherente. Los modelos de trabajo son pequeños (miles de entidades),
 * así que el coste de serializar es despreciable frente a la fiabilidad.
 */
export class History {
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private pending: Snapshot | null = null;
  private depth = 0;

  constructor(
    private readonly limit = 100,
    private readonly onChange?: () => void,
  ) {}

  /** Estado inicial: se registra el modelo tal y como está. */
  reset(model: Model): void {
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
    this.depth = 0;
    void model;
    this.onChange?.();
  }

  /**
   * Marca el comienzo de una operación. Debe llamarse ANTES de modificar el
   * modelo. Las llamadas anidadas se agrupan en una sola entrada.
   */
  begin(model: Model, label: string): void {
    if (this.depth === 0) {
      this.pending = { label, data: serializeModel(model) };
    }
    this.depth++;
  }

  /** Confirma la operación iniciada con `begin`. */
  commit(): void {
    if (this.depth === 0) return;
    this.depth--;
    if (this.depth > 0 || !this.pending) return;

    this.undoStack.push(this.pending);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.pending = null;
    this.onChange?.();
  }

  /** Descarta la operación en curso (no se registra nada). */
  abort(): void {
    if (this.depth === 0) return;
    this.depth--;
    if (this.depth === 0) this.pending = null;
  }

  /** Ejecuta `fn` como una única operación deshacible. */
  run<T>(model: Model, label: string, fn: () => T): T {
    this.begin(model, label);
    try {
      const result = fn();
      this.commit();
      return result;
    } catch (err) {
      this.abort();
      throw err;
    }
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undoLabel(): string | null {
    const top = this.undoStack[this.undoStack.length - 1];
    return top ? top.label : null;
  }

  redoLabel(): string | null {
    const top = this.redoStack[this.redoStack.length - 1];
    return top ? top.label : null;
  }

  /** Deshace la última operación y devuelve el modelo restaurado. */
  undo(current: Model): Model | null {
    const snap = this.undoStack.pop();
    if (!snap) return null;
    this.redoStack.push({ label: snap.label, data: serializeModel(current) });
    this.onChange?.();
    return deserializeModel(snap.data);
  }

  /** Rehace la última operación deshecha. */
  redo(current: Model): Model | null {
    const snap = this.redoStack.pop();
    if (!snap) return null;
    this.undoStack.push({ label: snap.label, data: serializeModel(current) });
    this.onChange?.();
    return deserializeModel(snap.data);
  }

  /** Número de operaciones almacenadas (para diagnósticos y pruebas). */
  size(): { undo: number; redo: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length };
  }
}
