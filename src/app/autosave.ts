import { Model } from '../core/model/model';
import { serializeToJSON, deserializeModel } from '../core/io/serialize';

const KEY = 'form3d.autoguardado.v1';
const CAMERA_KEY = 'form3d.camara.v1';

/**
 * Guardado automático en el almacenamiento local del navegador.
 *
 * Se escribe como mucho una vez cada `intervalMs` y sólo si el modelo ha
 * cambiado, para no penalizar la interacción. Si el modelo excede el tamaño que
 * admite localStorage se descarta silenciosamente el guardado: es una comodidad,
 * no un sustituto de "Guardar".
 */
export class AutoSave {
  private timer: number | null = null;
  private dirty = false;
  private lastError: string | null = null;

  constructor(
    private readonly getModel: () => Model,
    private readonly intervalMs = 4000,
  ) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.flush(), this.intervalMs);
    window.addEventListener('beforeunload', () => this.flush());
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Marca que hay cambios pendientes de guardar. */
  touch(): void {
    this.dirty = true;
  }

  /** Escribe ahora mismo si hay cambios. */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      window.localStorage.setItem(KEY, serializeToJSON(this.getModel()));
      this.lastError = null;
    } catch (err) {
      // Cuota agotada o almacenamiento no disponible (modo privado).
      this.lastError = (err as Error).message;
    }
  }

  /** Recupera el modelo guardado, o null si no hay ninguno válido. */
  static restore(): Model | null {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return null;
      return deserializeModel(raw);
    } catch {
      return null;
    }
  }

  /** ¿Hay una sesión anterior guardada? */
  static hasSaved(): boolean {
    try {
      return window.localStorage.getItem(KEY) !== null;
    } catch {
      return false;
    }
  }

  static clear(): void {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* sin almacenamiento: nada que limpiar */
    }
  }

  /** Guarda la posición de la cámara para restaurar el encuadre. */
  static saveCamera(state: unknown): void {
    try {
      window.localStorage.setItem(CAMERA_KEY, JSON.stringify(state));
    } catch {
      /* ignorado */
    }
  }

  static restoreCamera<T>(): T | null {
    try {
      const raw = window.localStorage.getItem(CAMERA_KEY);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  get error(): string | null {
    return this.lastError;
  }
}
