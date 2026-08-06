import * as THREE from 'three';
import { Vec3, v3, add, sub, mul, dot, cross, normalize, length, addScaled } from '../core/math/vec';
import { Box3, boxCenter, boxDiagonal, boxIsEmpty, Ray } from '../core/math/geom';
import { clamp } from '../core/math/tolerance';

export type ProjectionMode = 'perspective' | 'parallel';

/**
 * Cámara orbital con el eje Z hacia arriba, como en SketchUp.
 *
 * El estado se guarda en coordenadas esféricas alrededor de un punto de interés
 * (`target`), lo que hace que orbitar sea estable y que el cambio entre
 * proyección en perspectiva y paralela sea continuo.
 */
export class CameraController {
  target: Vec3 = v3(0, 0, 0);
  /** Distancia del ojo al objetivo. */
  distance = 20;
  /** Ángulo en el plano XY, en radianes. 0 = mirando hacia +X. */
  azimuth = -Math.PI * 0.75;
  /** Ángulo sobre el plano XY, en radianes. π/2 = cenital. */
  elevation = Math.PI * 0.28;

  mode: ProjectionMode = 'perspective';
  /** Campo de visión vertical en grados (35° es el valor de SketchUp). */
  fov = 35;

  readonly perspective: THREE.PerspectiveCamera;
  readonly orthographic: THREE.OrthographicCamera;

  private aspect = 1;

  constructor() {
    this.perspective = new THREE.PerspectiveCamera(this.fov, 1, 0.01, 100000);
    this.perspective.up.set(0, 0, 1);
    this.orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
    this.orthographic.up.set(0, 0, 1);
    this.update();
  }

  get camera(): THREE.Camera {
    return this.mode === 'perspective' ? this.perspective : this.orthographic;
  }

  /** Posición del ojo en coordenadas del mundo. */
  get eye(): Vec3 {
    const ce = Math.cos(this.elevation);
    return add(this.target, v3(
      Math.cos(this.azimuth) * ce * this.distance,
      Math.sin(this.azimuth) * ce * this.distance,
      Math.sin(this.elevation) * this.distance,
    ));
  }

  /** Dirección de vista (del ojo hacia el objetivo). */
  get forward(): Vec3 {
    return normalize(sub(this.target, this.eye));
  }

  /** Vector "derecha" de la pantalla. */
  get right(): Vec3 {
    return normalize(cross(this.forward, v3(0, 0, 1)));
  }

  /** Vector "arriba" de la pantalla. */
  get up(): Vec3 {
    return normalize(cross(this.right, this.forward));
  }

  setAspect(aspect: number): void {
    this.aspect = aspect > 0 ? aspect : 1;
    this.update();
  }

  /** Altura visible del encuadre a la distancia del objetivo. */
  get frustumHeight(): number {
    return 2 * this.distance * Math.tan((this.fov * Math.PI) / 360);
  }

  update(): void {
    const eye = this.eye;

    this.perspective.fov = this.fov;
    this.perspective.aspect = this.aspect;
    this.perspective.near = Math.max(this.distance * 1e-4, 1e-3);
    this.perspective.far = Math.max(this.distance * 1000, 1000);
    this.perspective.position.set(eye.x, eye.y, eye.z);
    this.perspective.up.set(0, 0, 1);
    this.perspective.lookAt(this.target.x, this.target.y, this.target.z);
    this.perspective.updateProjectionMatrix();
    this.perspective.updateMatrixWorld(true);

    const h = this.frustumHeight / 2;
    const w = h * this.aspect;
    this.orthographic.left = -w;
    this.orthographic.right = w;
    this.orthographic.top = h;
    this.orthographic.bottom = -h;
    this.orthographic.near = -Math.max(this.distance * 100, 1000);
    this.orthographic.far = Math.max(this.distance * 100, 1000);
    this.orthographic.position.set(eye.x, eye.y, eye.z);
    this.orthographic.up.set(0, 0, 1);
    this.orthographic.lookAt(this.target.x, this.target.y, this.target.z);
    this.orthographic.updateProjectionMatrix();
    this.orthographic.updateMatrixWorld(true);
  }

  // -------------------------------------------------------------------------
  // Navegación
  // -------------------------------------------------------------------------

  /** Orbita: `dx`/`dy` en píxeles. */
  orbit(dx: number, dy: number, speed = 0.0075): void {
    this.azimuth -= dx * speed;
    this.elevation = clamp(
      this.elevation + dy * speed,
      -Math.PI / 2 + 1e-3,
      Math.PI / 2 - 1e-3,
    );
    this.update();
  }

  /** Desplaza la cámara paralelamente a la pantalla. */
  pan(dx: number, dy: number, viewportHeight: number): void {
    const scale = this.frustumHeight / Math.max(1, viewportHeight);
    const move = add(mul(this.right, -dx * scale), mul(this.up, dy * scale));
    this.target = add(this.target, move);
    this.update();
  }

  /**
   * Acerca o aleja. `amount` positivo acerca.
   * Si se indica `focus`, se conserva bajo el cursor (zoom hacia el puntero).
   */
  zoom(amount: number, focus?: Vec3): void {
    const factor = Math.pow(0.9, amount);
    const newDistance = clamp(this.distance * factor, 1e-4, 1e7);

    if (focus) {
      // Mantener el punto de interés fijo: se mueve el objetivo hacia él en la
      // misma proporción en que se reduce la distancia.
      const t = 1 - newDistance / this.distance;
      this.target = addScaled(this.target, sub(focus, this.target), t);
    }
    this.distance = newDistance;
    this.update();
  }

  /** Encuadra una caja envolvente. */
  zoomExtents(box: Box3, margin = 1.25): void {
    if (boxIsEmpty(box)) {
      this.target = v3(0, 0, 0);
      this.distance = 20;
      this.update();
      return;
    }
    const center = boxCenter(box);
    const radius = Math.max(boxDiagonal(box) / 2, 1e-3);
    this.target = center;
    const halfFov = (this.fov * Math.PI) / 360;
    const distV = radius / Math.tan(halfFov);
    const distH = radius / Math.tan(Math.atan(Math.tan(halfFov) * this.aspect));
    this.distance = Math.max(distV, distH) * margin;
    this.update();
  }

  /** Vistas normalizadas. */
  setStandardView(view: StandardView): void {
    switch (view) {
      case 'top': this.azimuth = -Math.PI / 2; this.elevation = Math.PI / 2 - 1e-3; break;
      case 'bottom': this.azimuth = -Math.PI / 2; this.elevation = -Math.PI / 2 + 1e-3; break;
      case 'front': this.azimuth = -Math.PI / 2; this.elevation = 0; break;
      case 'back': this.azimuth = Math.PI / 2; this.elevation = 0; break;
      case 'left': this.azimuth = Math.PI; this.elevation = 0; break;
      case 'right': this.azimuth = 0; this.elevation = 0; break;
      case 'iso': this.azimuth = -Math.PI * 0.75; this.elevation = Math.PI * 0.28; break;
    }
    this.update();
  }

  setMode(mode: ProjectionMode): void {
    this.mode = mode;
    this.update();
  }

  // -------------------------------------------------------------------------
  // Conversiones pantalla ↔ mundo
  // -------------------------------------------------------------------------

  /** Rayo que parte del ojo y pasa por el píxel indicado (coordenadas NDC). */
  rayFromNDC(ndcX: number, ndcY: number): Ray {
    if (this.mode === 'perspective') {
      const origin = this.eye;
      const halfH = Math.tan((this.fov * Math.PI) / 360);
      const halfW = halfH * this.aspect;
      const dir = normalize(add(
        add(mul(this.right, ndcX * halfW), mul(this.up, ndcY * halfH)),
        this.forward,
      ));
      return { origin, dir };
    }
    const h = this.frustumHeight / 2;
    const w = h * this.aspect;
    const origin = add(
      addScaled(this.eye, this.right, ndcX * w),
      mul(this.up, ndcY * h),
    );
    return { origin, dir: this.forward };
  }

  /** Proyecta un punto del mundo a NDC y devuelve también su profundidad. */
  projectToNDC(p: Vec3): { x: number; y: number; depth: number } {
    const rel = sub(p, this.eye);
    const depth = dot(rel, this.forward);
    if (this.mode === 'perspective') {
      if (depth <= 1e-9) return { x: NaN, y: NaN, depth };
      const halfH = Math.tan((this.fov * Math.PI) / 360);
      const halfW = halfH * this.aspect;
      return {
        x: dot(rel, this.right) / (depth * halfW),
        y: dot(rel, this.up) / (depth * halfH),
        depth,
      };
    }
    const h = this.frustumHeight / 2;
    const w = h * this.aspect;
    return { x: dot(rel, this.right) / w, y: dot(rel, this.up) / h, depth };
  }

  /**
   * Tamaño en unidades del mundo de un píxel a la altura del punto indicado.
   * Es la escala que necesitan los radios de captura y los glifos.
   */
  worldPerPixel(atPoint: Vec3, viewportHeight: number): number {
    if (this.mode === 'parallel') {
      return this.frustumHeight / Math.max(1, viewportHeight);
    }
    const depth = Math.max(1e-6, dot(sub(atPoint, this.eye), this.forward));
    const h = 2 * depth * Math.tan((this.fov * Math.PI) / 360);
    return h / Math.max(1, viewportHeight);
  }

  /** Serializa la posición de la cámara (para guardar escenas). */
  toJSON(): CameraState {
    return {
      target: [this.target.x, this.target.y, this.target.z],
      distance: this.distance,
      azimuth: this.azimuth,
      elevation: this.elevation,
      mode: this.mode,
      fov: this.fov,
    };
  }

  fromJSON(s: CameraState): void {
    this.target = v3(s.target[0], s.target[1], s.target[2]);
    this.distance = s.distance;
    this.azimuth = s.azimuth;
    this.elevation = s.elevation;
    this.mode = s.mode;
    this.fov = s.fov;
    this.update();
  }
}

export type StandardView = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso';

export interface CameraState {
  target: [number, number, number];
  distance: number;
  azimuth: number;
  elevation: number;
  mode: ProjectionMode;
  fov: number;
}

/** Reexport de utilidades usadas por las herramientas de navegación. */
export { length as vecLength };
