import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import { CameraController } from './camera';
import { SceneBuilder, RenderOptions } from './scene';
import { Overlay } from './overlay';
import { THEME, hexToInt } from './theme';
import { Model } from '../core/model/model';
import { Vec3, v3 } from '../core/math/vec';
import { Ray } from '../core/math/geom';
import { quantize } from '../core/math/tolerance';

export interface ViewportOptions {
  showGrid: boolean;
  showAxes: boolean;
  showGround: boolean;
  showShadows: boolean;
}

export const DEFAULT_VIEWPORT_OPTIONS: ViewportOptions = {
  showGrid: true,
  showAxes: true,
  showGround: true,
  showShadows: true,
};

/**
 * Contenedor de la vista 3D: renderizador, cámara, luces, suelo, ejes y las
 * capas de modelo y de superposición.
 */
export class Viewport {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cameraCtl = new CameraController();
  readonly builder = new SceneBuilder();
  readonly overlay = new Overlay();

  options: ViewportOptions = { ...DEFAULT_VIEWPORT_OPTIONS };

  private ground: THREE.Mesh | null = null;
  private gridLines: THREE.LineSegments | null = null;
  private axisLines: LineSegments2 | null = null;
  private axisMaterial: LineMaterial;
  private sun: THREE.DirectionalLight;
  private ambient: THREE.HemisphereLight;

  private dirty = true;
  private lastGridStep = 0;
  private width = 1;
  private height = 1;

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.ambient = new THREE.HemisphereLight(0xffffff, 0xbfc4c9, 2.1);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xfff6e8, 1.35);
    this.sun.position.set(-30, -45, 60);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.axisMaterial = new LineMaterial({
      vertexColors: true,
      linewidth: 2,
      worldUnits: false,
      alphaToCoverage: true,
      transparent: true,
      opacity: 0.9,
    });

    this.scene.add(this.builder.group);
    this.scene.add(this.overlay.group);

    this.buildGround();
    this.buildAxes();
    this.resize();
  }

  // -------------------------------------------------------------------------
  // Ciclo de vida
  // -------------------------------------------------------------------------

  invalidate(): void {
    this.dirty = true;
  }

  resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, Math.floor(rect.width));
    this.height = Math.max(1, Math.floor(rect.height));
    this.renderer.setSize(this.width, this.height, false);
    this.cameraCtl.setAspect(this.width / this.height);
    const ratio = this.renderer.getPixelRatio();
    this.builder.setResolution(this.width * ratio, this.height * ratio);
    this.overlay.setResolution(this.width * ratio, this.height * ratio);
    this.axisMaterial.resolution.set(this.width * ratio, this.height * ratio);
    this.dirty = true;
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /** Reconstruye la representación del modelo. */
  rebuild(model: Model, options: RenderOptions): void {
    this.builder.build(model, options);
    this.applyShadowSettings();
    this.dirty = true;
  }

  private applyShadowSettings(): void {
    const enabled = this.options.showShadows;
    this.sun.castShadow = enabled;
    this.builder.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = enabled;
        mesh.receiveShadow = enabled;
      }
    });
    if (this.ground) this.ground.receiveShadow = enabled;
  }

  /** Dibuja si algo ha cambiado. Debe llamarse en cada frame. */
  renderIfNeeded(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.updateGrid();
    this.updateSun();
    this.renderer.render(this.scene, this.cameraCtl.camera);
  }

  forceRender(): void {
    this.dirty = true;
    this.renderIfNeeded();
  }

  // -------------------------------------------------------------------------
  // Conversión de coordenadas
  // -------------------------------------------------------------------------

  /** Rayo bajo el cursor a partir de coordenadas de cliente. */
  rayFromClient(clientX: number, clientY: number): Ray {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    return this.cameraCtl.rayFromNDC(x, y);
  }

  /** Coordenadas de píxel dentro del lienzo. */
  toLocal(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  /** Proyecta un punto del mundo a píxeles del lienzo. */
  worldToScreen(p: Vec3): { x: number; y: number; depth: number } {
    const ndc = this.cameraCtl.projectToNDC(p);
    return {
      x: ((ndc.x + 1) / 2) * this.width,
      y: ((1 - ndc.y) / 2) * this.height,
      depth: ndc.depth,
    };
  }

  /** Unidades del mundo por píxel a la altura del punto indicado. */
  worldPerPixel(at: Vec3): number {
    return this.cameraCtl.worldPerPixel(at, this.height);
  }

  // -------------------------------------------------------------------------
  // Elementos del entorno
  // -------------------------------------------------------------------------

  private buildGround(): void {
    const geom = new THREE.CircleGeometry(1, 96);
    // Lambert (no Basic) para que el plano del suelo reciba las sombras.
    const mat = new THREE.MeshLambertMaterial({
      color: hexToInt(THEME.ground),
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ground = new THREE.Mesh(geom, mat);
    this.ground.renderOrder = -2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
  }

  private buildAxes(): void {
    const positions: number[] = [];
    const colors: number[] = [];
    const col = new THREE.Color();

    const addAxis = (dir: Vec3, hex: string, hexLight: string) => {
      col.set(hex);
      positions.push(0, 0, 0, dir.x, dir.y, dir.z);
      colors.push(col.r, col.g, col.b, col.r, col.g, col.b);
      col.set(hexLight);
      positions.push(0, 0, 0, -dir.x, -dir.y, -dir.z);
      colors.push(col.r, col.g, col.b, col.r, col.g, col.b);
    };

    addAxis(v3(1, 0, 0), THEME.axisX, THEME.axisXLight);
    addAxis(v3(0, 1, 0), THEME.axisY, THEME.axisYLight);
    addAxis(v3(0, 0, 1), THEME.axisZ, THEME.axisZLight);

    const geom = new LineSegmentsGeometry();
    geom.setPositions(positions);
    geom.setColors(colors);
    this.axisLines = new LineSegments2(geom, this.axisMaterial);
    this.axisLines.renderOrder = -1;
    this.scene.add(this.axisLines);
  }

  /** Ajusta rejilla, suelo y ejes al encuadre actual. */
  private updateGrid(): void {
    const ctl = this.cameraCtl;
    const span = ctl.distance;

    if (this.ground) {
      this.ground.visible = this.options.showGround;
      this.ground.position.set(ctl.target.x, ctl.target.y, 0);
      const r = span * 60;
      this.ground.scale.set(r, r, 1);
    }

    if (this.axisLines) {
      this.axisLines.visible = this.options.showAxes;
      const s = span * 3;
      this.axisLines.scale.set(s, s, s);
    }

    // Paso de rejilla "redondo" adaptado al zoom: entre 40 y 400 px por celda.
    const targetWorld = span * 0.08;
    const exp = Math.floor(Math.log10(targetWorld));
    const base = Math.pow(10, exp);
    const ratio = targetWorld / base;
    const step = base * (ratio < 2 ? 1 : ratio < 5 ? 2 : 5);

    if (this.gridLines && Math.abs(step - this.lastGridStep) < 1e-12) {
      this.gridLines.visible = this.options.showGrid;
      this.gridLines.position.set(
        quantize(ctl.target.x, step * 10),
        quantize(ctl.target.y, step * 10),
        0,
      );
      return;
    }
    this.lastGridStep = step;

    if (this.gridLines) {
      this.scene.remove(this.gridLines);
      this.gridLines.geometry.dispose();
      (this.gridLines.material as THREE.Material).dispose();
    }

    const half = 60;
    const positions: number[] = [];
    const colors: number[] = [];
    const minor = new THREE.Color(THEME.grid);
    const major = new THREE.Color(THEME.gridMajor);
    const extent = half * step;
    for (let i = -half; i <= half; i++) {
      const c = i % 10 === 0 ? major : minor;
      const p = i * step;
      positions.push(p, -extent, 0, p, extent, 0);
      positions.push(-extent, p, 0, extent, p, 0);
      for (let k = 0; k < 4; k++) colors.push(c.r, c.g, c.b);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false,
    });
    this.gridLines = new THREE.LineSegments(geom, mat);
    this.gridLines.renderOrder = -1;
    this.gridLines.visible = this.options.showGrid;
    this.gridLines.position.set(
      quantize(ctl.target.x, step * 10),
      quantize(ctl.target.y, step * 10),
      0,
    );
    this.scene.add(this.gridLines);
  }

  /** Coloca el sol para que las sombras cubran la escena visible. */
  private updateSun(): void {
    const ctl = this.cameraCtl;
    const d = Math.max(ctl.distance, 1);
    this.sun.position.set(
      ctl.target.x - d * 0.6,
      ctl.target.y - d * 0.9,
      ctl.target.z + d * 1.2,
    );
    this.sun.target.position.set(ctl.target.x, ctl.target.y, ctl.target.z);
    this.sun.target.updateMatrixWorld();
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
    const r = d * 1.4;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.01;
    cam.far = d * 6;
    cam.updateProjectionMatrix();
  }

  dispose(): void {
    this.builder.dispose();
    this.overlay.dispose();
    this.axisMaterial.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
