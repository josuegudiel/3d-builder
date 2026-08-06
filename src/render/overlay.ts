import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { Vec3 } from '../core/math/vec';
import { LINE_WIDTH } from './theme';

export type GlyphShape = 'square' | 'diamond' | 'circle' | 'cross' | 'triangle';

const GLYPH_SHAPES: GlyphShape[] = ['square', 'diamond', 'circle', 'cross', 'triangle'];

/** Crea una textura con la forma del glifo de enganche. */
function glyphTexture(shape: GlyphShape): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 8;
  ctx.lineJoin = 'round';
  const c = size / 2;
  const r = size / 2 - 8;

  switch (shape) {
    case 'square':
      ctx.fillRect(c - r * 0.72, c - r * 0.72, r * 1.44, r * 1.44);
      break;
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(c, c - r);
      ctx.lineTo(c + r, c);
      ctx.lineTo(c, c + r);
      ctx.lineTo(c - r, c);
      ctx.closePath();
      ctx.fill();
      break;
    case 'circle':
      ctx.beginPath();
      ctx.arc(c, c, r * 0.85, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'cross':
      ctx.beginPath();
      ctx.moveTo(c - r * 0.8, c - r * 0.8);
      ctx.lineTo(c + r * 0.8, c + r * 0.8);
      ctx.moveTo(c + r * 0.8, c - r * 0.8);
      ctx.lineTo(c - r * 0.8, c + r * 0.8);
      ctx.stroke();
      break;
    case 'triangle':
      ctx.beginPath();
      ctx.moveTo(c, c - r);
      ctx.lineTo(c + r * 0.9, c + r * 0.75);
      ctx.lineTo(c - r * 0.9, c + r * 0.75);
      ctx.closePath();
      ctx.fill();
      break;
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

interface LineBuffer {
  positions: number[];
  colors: number[];
}

/**
 * Capa de superposición: previsualizaciones de las herramientas, glifos de
 * inferencia, líneas de guía y caras fantasma.
 *
 * Se vacía y se vuelve a llenar en cada movimiento del ratón; por eso usa
 * buffers sencillos que se reconstruyen enteros.
 */
export class Overlay {
  readonly group = new THREE.Group();

  private solid: LineBuffer = { positions: [], colors: [] };
  private dashed: LineBuffer = { positions: [], colors: [] };
  private glyphs = new Map<GlyphShape, { positions: number[]; colors: number[]; sizes: number[] }>();
  private ghostTriangles: { positions: number[]; colors: number[] } = { positions: [], colors: [] };

  private solidMat: LineMaterial;
  private dashedMat: LineMaterial;
  private glyphMats = new Map<GlyphShape, THREE.PointsMaterial>();
  private ghostMat: THREE.MeshBasicMaterial;

  private solidObj: LineSegments2 | null = null;
  private dashedObj: LineSegments2 | null = null;
  private glyphObjs = new Map<GlyphShape, THREE.Points>();
  private ghostObj: THREE.Mesh | null = null;

  private color = new THREE.Color();

  constructor() {
    this.group.name = 'superposicion';
    this.group.renderOrder = 10;

    this.solidMat = new LineMaterial({
      vertexColors: true,
      linewidth: LINE_WIDTH.preview,
      worldUnits: false,
      transparent: true,
      depthTest: false,
      alphaToCoverage: true,
    });
    this.dashedMat = new LineMaterial({
      vertexColors: true,
      linewidth: LINE_WIDTH.guide,
      worldUnits: false,
      dashed: true,
      dashScale: 1,
      dashSize: 6,
      gapSize: 5,
      transparent: true,
      depthTest: false,
      alphaToCoverage: true,
    });
    this.ghostMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });

    for (const shape of GLYPH_SHAPES) {
      const mat = new THREE.PointsMaterial({
        size: 11,
        sizeAttenuation: false,
        map: glyphTexture(shape),
        transparent: true,
        depthTest: false,
        alphaTest: 0.25,
        vertexColors: true,
      });
      this.glyphMats.set(shape, mat);
      this.glyphs.set(shape, { positions: [], colors: [], sizes: [] });
    }
  }

  setResolution(width: number, height: number): void {
    this.solidMat.resolution.set(width, height);
    this.dashedMat.resolution.set(width, height);
  }

  /** Vacía todas las primitivas acumuladas. */
  clear(): void {
    this.solid = { positions: [], colors: [] };
    this.dashed = { positions: [], colors: [] };
    this.ghostTriangles = { positions: [], colors: [] };
    for (const shape of GLYPH_SHAPES) {
      this.glyphs.set(shape, { positions: [], colors: [], sizes: [] });
    }
  }

  private rgb(hex: string): [number, number, number] {
    this.color.set(hex);
    return [this.color.r, this.color.g, this.color.b];
  }

  addLine(a: Vec3, b: Vec3, hex: string, dashed = false): void {
    const buf = dashed ? this.dashed : this.solid;
    const c = this.rgb(hex);
    buf.positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    buf.colors.push(c[0], c[1], c[2], c[0], c[1], c[2]);
  }

  addPolyline(points: readonly Vec3[], hex: string, closed = false, dashed = false): void {
    const n = points.length;
    if (n < 2) return;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      this.addLine(points[i], points[(i + 1) % n], hex, dashed);
    }
  }

  addGlyph(p: Vec3, hex: string, shape: GlyphShape = 'square'): void {
    const buf = this.glyphs.get(shape)!;
    const c = this.rgb(hex);
    buf.positions.push(p.x, p.y, p.z);
    buf.colors.push(c[0], c[1], c[2]);
  }

  /** Cara fantasma: polígono convexo o triangulado por abanico. */
  addGhostPolygon(points: readonly Vec3[], hex: string): void {
    if (points.length < 3) return;
    const c = this.rgb(hex);
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[0];
      const b = points[i];
      const d = points[i + 1];
      this.ghostTriangles.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z);
      for (let k = 0; k < 3; k++) this.ghostTriangles.colors.push(c[0], c[1], c[2]);
    }
  }

  /** Caja de arista a arista (previsualización de extrusión). */
  addGhostBox(corners: readonly Vec3[], hex: string): void {
    if (corners.length !== 8) return;
    const faces: number[][] = [
      [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4],
      [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
    ];
    for (const f of faces) {
      this.addGhostPolygon(f.map((i) => corners[i]), hex);
    }
  }

  /** Sube los buffers a la GPU. Debe llamarse tras terminar de añadir. */
  commit(): void {
    this.disposeObjects();

    if (this.solid.positions.length > 0) {
      const geom = new LineSegmentsGeometry();
      geom.setPositions(this.solid.positions);
      geom.setColors(this.solid.colors);
      this.solidObj = new LineSegments2(geom, this.solidMat);
      this.solidObj.renderOrder = 11;
      this.group.add(this.solidObj);
    }

    if (this.dashed.positions.length > 0) {
      const geom = new LineSegmentsGeometry();
      geom.setPositions(this.dashed.positions);
      geom.setColors(this.dashed.colors);
      this.dashedObj = new LineSegments2(geom, this.dashedMat);
      this.dashedObj.computeLineDistances();
      this.dashedObj.renderOrder = 11;
      this.group.add(this.dashedObj);
    }

    if (this.ghostTriangles.positions.length > 0) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(this.ghostTriangles.positions, 3));
      geom.setAttribute('color', new THREE.Float32BufferAttribute(this.ghostTriangles.colors, 3));
      this.ghostObj = new THREE.Mesh(geom, this.ghostMat);
      this.ghostObj.renderOrder = 9;
      this.group.add(this.ghostObj);
    }

    for (const shape of GLYPH_SHAPES) {
      const buf = this.glyphs.get(shape)!;
      if (buf.positions.length === 0) continue;
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
      geom.setAttribute('color', new THREE.Float32BufferAttribute(buf.colors, 3));
      const pts = new THREE.Points(geom, this.glyphMats.get(shape)!);
      pts.renderOrder = 12;
      this.glyphObjs.set(shape, pts);
      this.group.add(pts);
    }
  }

  private disposeObjects(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      const c = child as unknown as { geometry?: THREE.BufferGeometry };
      c.geometry?.dispose();
    }
    this.solidObj = null;
    this.dashedObj = null;
    this.ghostObj = null;
    this.glyphObjs.clear();
  }

  dispose(): void {
    this.disposeObjects();
    this.solidMat.dispose();
    this.dashedMat.dispose();
    this.ghostMat.dispose();
    for (const m of this.glyphMats.values()) {
      m.map?.dispose();
      m.dispose();
    }
  }
}
