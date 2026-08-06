import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import { Model, ContextPath } from '../core/model/model';
import { Geometry } from '../core/model/geometry';
import { Id } from '../core/model/types';
import { Vec3, v3 } from '../core/math/vec';
import { Mat4, IDENTITY, matMul, transformPoint, transformNormal, matFlipsOrientation } from '../core/math/mat';
import { Box3, emptyBox, expandBox } from '../core/math/geom';
import { triangulateFace } from '../core/topology/triangulate';
import { THEME, LINE_WIDTH, hexToInt } from './theme';
import { Selection } from '../core/selection';

// ---------------------------------------------------------------------------
// Caché de selección (picking)
// ---------------------------------------------------------------------------

export interface PickTriangle {
  a: Vec3; b: Vec3; c: Vec3;
  faceId: Id;
  path: Id[];
  /** true si el triángulo pertenece al contexto de edición activo. */
  active: boolean;
  /** Instancia de nivel superior que lo contiene (null en el contexto activo). */
  topInstance: Id | null;
}

export interface PickSegment {
  a: Vec3; b: Vec3;
  edgeId: Id;
  path: Id[];
  active: boolean;
  topInstance: Id | null;
}

export interface PickVertex {
  p: Vec3;
  vertexId: Id;
  path: Id[];
  active: boolean;
}

export interface SceneLabel {
  text: string;
  position: Vec3;
  kind: 'dimension';
  id: Id;
}

export interface PickCache {
  triangles: PickTriangle[];
  segments: PickSegment[];
  vertices: PickVertex[];
  /** Textos anclados en el espacio 3D (cotas). */
  labels: SceneLabel[];
  /** Caja envolvente en coordenadas del mundo de cada instancia visible. */
  instanceBoxes: Array<{ instanceId: Id; path: Id[]; box: Box3; active: boolean }>;
  bounds: Box3;
}

export interface RenderOptions {
  context: ContextPath;
  selection: Selection;
  /** Cara resaltada bajo el cursor. */
  hover: { kind: 'face' | 'edge' | 'instance'; id: Id } | null;
  showHiddenGeometry: boolean;
  /** Estilo de caras: 'shaded' | 'monochrome' | 'wireframe' | 'hiddenline' */
  faceStyle: 'shaded' | 'monochrome' | 'wireframe' | 'hiddenline';
  /** Mostrar aristas. */
  showEdges: boolean;
  /** Mostrar contornos (aristas de silueta más gruesas). */
  showProfiles: boolean;
  /** Transparencia del contenido fuera del contexto de edición. */
  dimOutsideContext: boolean;
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  context: [],
  selection: { faces: new Set(), edges: new Set(), vertices: new Set(), instances: new Set() },
  hover: null,
  showHiddenGeometry: false,
  faceStyle: 'shaded',
  showEdges: true,
  showProfiles: true,
  dimOutsideContext: true,
};

// ---------------------------------------------------------------------------
// Constructor de la escena
// ---------------------------------------------------------------------------

interface FaceBatch {
  positions: number[];
  normals: number[];
  frontColors: number[];
  backColors: number[];
}

function newBatch(): FaceBatch {
  return { positions: [], normals: [], frontColors: [], backColors: [] };
}

interface EdgeBatch {
  positions: number[];
  colors: number[];
}

function newEdgeBatch(): EdgeBatch {
  return { positions: [], colors: [] };
}

const tmpColor = new THREE.Color();

function colorOf(hex: string, alpha = 1): [number, number, number] {
  tmpColor.set(hex);
  return [tmpColor.r * alpha, tmpColor.g * alpha, tmpColor.b * alpha];
}

function mixColor(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Construye la representación en three.js del modelo y, en la misma pasada,
 * la caché que usa el selector de entidades.
 *
 * Se reconstruye por completo en cada cambio del modelo. Para los tamaños de
 * modelo habituales (decenas de miles de triángulos) es más que suficiente y
 * evita por completo los errores de sincronización incremental.
 */
export class SceneBuilder {
  readonly group = new THREE.Group();

  private opaqueFront: THREE.Mesh | null = null;
  private opaqueBack: THREE.Mesh | null = null;
  private transparentFront: THREE.Mesh | null = null;
  private transparentBack: THREE.Mesh | null = null;
  private edgeLines: LineSegments2 | null = null;
  private profileLines: LineSegments2 | null = null;
  private selectedLines: LineSegments2 | null = null;
  private guideLines: LineSegments2 | null = null;

  private edgeMaterial: LineMaterial;
  private profileMaterial: LineMaterial;
  private selectedMaterial: LineMaterial;
  private guideMaterial: LineMaterial;

  pick: PickCache = {
    triangles: [], segments: [], vertices: [], labels: [], instanceBoxes: [], bounds: emptyBox(),
  };

  constructor() {
    this.group.name = 'modelo';
    this.edgeMaterial = new LineMaterial({
      color: 0xffffff,
      vertexColors: true,
      linewidth: LINE_WIDTH.edge,
      worldUnits: false,
      dashed: false,
      alphaToCoverage: true,
    });
    this.profileMaterial = new LineMaterial({
      color: 0xffffff,
      vertexColors: true,
      linewidth: LINE_WIDTH.profile,
      worldUnits: false,
      alphaToCoverage: true,
    });
    this.selectedMaterial = new LineMaterial({
      color: 0xffffff,
      vertexColors: true,
      linewidth: LINE_WIDTH.selected,
      worldUnits: false,
      alphaToCoverage: true,
      depthTest: false,
    });
    this.guideMaterial = new LineMaterial({
      color: 0xffffff,
      vertexColors: true,
      linewidth: LINE_WIDTH.guide,
      worldUnits: false,
      dashed: true,
      dashSize: 5,
      gapSize: 4,
      transparent: true,
      opacity: 0.85,
      alphaToCoverage: true,
    });
  }

  setResolution(width: number, height: number): void {
    this.edgeMaterial.resolution.set(width, height);
    this.profileMaterial.resolution.set(width, height);
    this.selectedMaterial.resolution.set(width, height);
    this.guideMaterial.resolution.set(width, height);
  }

  dispose(): void {
    this.clear();
    this.edgeMaterial.dispose();
    this.profileMaterial.dispose();
    this.selectedMaterial.dispose();
    this.guideMaterial.dispose();
  }

  private clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      const anyChild = child as unknown as { geometry?: THREE.BufferGeometry; material?: THREE.Material };
      anyChild.geometry?.dispose();
      if (anyChild.material && anyChild.material !== this.edgeMaterial
        && anyChild.material !== this.profileMaterial && anyChild.material !== this.selectedMaterial
        && anyChild.material !== this.guideMaterial) {
        anyChild.material.dispose();
      }
    }
    this.opaqueFront = null;
    this.opaqueBack = null;
    this.transparentFront = null;
    this.transparentBack = null;
    this.edgeLines = null;
    this.profileLines = null;
    this.selectedLines = null;
    this.guideLines = null;
  }

  /** Reconstruye toda la escena a partir del modelo. */
  build(model: Model, options: RenderOptions): void {
    this.clear();

    const opaque = newBatch();
    const transparent = newBatch();
    const edges = newEdgeBatch();
    const profiles = newEdgeBatch();
    const selected = newEdgeBatch();
    const guides = newEdgeBatch();

    const pick: PickCache = {
      triangles: [], segments: [], vertices: [], labels: [], instanceBoxes: [], bounds: emptyBox(),
    };

    const contextPath = [...options.context];

    this.walk(
      model,
      model.rootId,
      IDENTITY,
      [],
      contextPath,
      0,
      options,
      { opaque, transparent, edges, profiles, selected },
      pick,
      new Set(),
    );

    // --- Cotas y guías (viven en el espacio raíz) --------------------------
    buildDimensions(model, guides, pick);
    buildGuides(model, guides);

    this.pick = pick;

    // --- Mallas de caras ---------------------------------------------------
    if (options.faceStyle !== 'wireframe') {
      const monochrome = options.faceStyle === 'monochrome' || options.faceStyle === 'hiddenline';
      if (opaque.positions.length > 0) {
        const geom = buildFaceGeometry(opaque, 'front', monochrome, options.faceStyle === 'hiddenline');
        this.opaqueFront = new THREE.Mesh(geom, faceMaterial(false, false));
        this.opaqueFront.renderOrder = 0;
        this.group.add(this.opaqueFront);

        const geomBack = buildFaceGeometry(opaque, 'back', monochrome, options.faceStyle === 'hiddenline');
        this.opaqueBack = new THREE.Mesh(geomBack, faceMaterial(false, true));
        this.opaqueBack.renderOrder = 0;
        this.group.add(this.opaqueBack);
      }
      if (transparent.positions.length > 0) {
        const geom = buildFaceGeometry(transparent, 'front', monochrome, false);
        this.transparentFront = new THREE.Mesh(geom, faceMaterial(true, false));
        this.transparentFront.renderOrder = 2;
        this.group.add(this.transparentFront);

        const geomBack = buildFaceGeometry(transparent, 'back', monochrome, false);
        this.transparentBack = new THREE.Mesh(geomBack, faceMaterial(true, true));
        this.transparentBack.renderOrder = 2;
        this.group.add(this.transparentBack);
      }
    }

    // --- Aristas ------------------------------------------------------------
    if (edges.positions.length > 0) {
      this.edgeLines = makeLines(edges, this.edgeMaterial);
      this.edgeLines.renderOrder = 3;
      this.group.add(this.edgeLines);
    }
    if (profiles.positions.length > 0) {
      this.profileLines = makeLines(profiles, this.profileMaterial);
      this.profileLines.renderOrder = 3;
      this.group.add(this.profileLines);
    }
    if (selected.positions.length > 0) {
      this.selectedLines = makeLines(selected, this.selectedMaterial);
      this.selectedLines.renderOrder = 5;
      this.group.add(this.selectedLines);
    }
    if (guides.positions.length > 0) {
      this.guideLines = makeLines(guides, this.guideMaterial);
      this.guideLines.computeLineDistances();
      this.guideLines.renderOrder = 4;
      this.group.add(this.guideLines);
    }
  }

  /** Recorre la jerarquía acumulando geometría. */
  private walk(
    model: Model,
    defId: Id,
    transform: Mat4,
    path: Id[],
    contextPath: Id[],
    depth: number,
    options: RenderOptions,
    batches: {
      opaque: FaceBatch; transparent: FaceBatch;
      edges: EdgeBatch; profiles: EdgeBatch; selected: EdgeBatch;
    },
    pick: PickCache,
    visiting: Set<Id>,
  ): void {
    const def = model.definitions.get(defId);
    if (!def || visiting.has(defId)) return;
    visiting.add(defId);

    // ¿Este nivel es el contexto activo o está dentro de él?
    const inContextChain = path.length <= contextPath.length
      && path.every((id, i) => contextPath[i] === id);
    const isActiveContext = inContextChain && path.length === contextPath.length;
    const dimmed = options.dimOutsideContext && contextPath.length > 0 && !isActiveContext;
    const topInstance = path.length > contextPath.length ? path[contextPath.length] : null;

    const geo = def.geometry;
    const flip = matFlipsOrientation(transform);

    // --- Caras --------------------------------------------------------------
    for (const face of geo.faces.values()) {
      if (face.hidden && !options.showHiddenGeometry) continue;
      const tri = triangulateFace(geo, face.id);
      if (!tri) continue;

      const selectedFace = isActiveContext && options.selection.faces.has(face.id);
      const hovered = isActiveContext && options.hover?.kind === 'face' && options.hover.id === face.id;

      const frontMat = model.materialOrDefault(face.frontMaterial)
        ?? inheritedMaterial(model, geo, path, defId);
      const backMat = model.materialOrDefault(face.backMaterial);

      const opacity = frontMat?.opacity ?? 1;
      const batch = opacity < 0.99 ? batches.transparent : batches.opaque;

      let fc = colorOf(frontMat?.color ?? THEME.faceFront);
      let bc = colorOf(backMat?.color ?? THEME.faceBack);
      if (dimmed) {
        fc = mixColor(fc, [1, 1, 1], 0.55);
        bc = mixColor(bc, [1, 1, 1], 0.55);
      }
      if (selectedFace) {
        const sel = colorOf(THEME.selectionFace);
        fc = mixColor(fc, sel, 0.5);
        bc = mixColor(bc, sel, 0.5);
      } else if (hovered) {
        const hl = colorOf(THEME.highlight);
        fc = mixColor(fc, hl, 0.25);
        bc = mixColor(bc, hl, 0.25);
      }

      const world = tri.positions.map((p) => transformPoint(transform, p));
      const normal = transformNormal(transform, tri.normal);

      for (let i = 0; i < tri.indices.length; i += 3) {
        let ia = tri.indices[i];
        let ib = tri.indices[i + 1];
        const ic = tri.indices[i + 2];
        if (flip) {
          const t = ia;
          ia = ib;
          ib = t;
        }
        const A = world[ia];
        const B = world[ib];
        const C = world[ic];
        batch.positions.push(A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z);
        for (let k = 0; k < 3; k++) {
          batch.normals.push(normal.x, normal.y, normal.z);
          batch.frontColors.push(fc[0], fc[1], fc[2]);
          batch.backColors.push(bc[0], bc[1], bc[2]);
        }
        pick.triangles.push({
          a: A, b: B, c: C, faceId: face.id, path: [...path],
          active: isActiveContext, topInstance,
        });
      }
    }

    // --- Aristas ------------------------------------------------------------
    for (const edge of geo.edges.values()) {
      const soft = edge.soft || edge.hidden;
      if (soft && !options.showHiddenGeometry) {
        // Las aristas suaves no se dibujan, pero sí participan en la selección.
        const a = transformPoint(transform, geo.vertexPos(edge.a));
        const b = transformPoint(transform, geo.vertexPos(edge.b));
        pick.segments.push({ a, b, edgeId: edge.id, path: [...path], active: isActiveContext, topInstance });
        expandBox(pick.bounds, a);
        expandBox(pick.bounds, b);
        continue;
      }

      const a = transformPoint(transform, geo.vertexPos(edge.a));
      const b = transformPoint(transform, geo.vertexPos(edge.b));
      expandBox(pick.bounds, a);
      expandBox(pick.bounds, b);

      pick.segments.push({ a, b, edgeId: edge.id, path: [...path], active: isActiveContext, topInstance });

      const isSelected = isActiveContext && options.selection.edges.has(edge.id);
      const hovered = isActiveContext && options.hover?.kind === 'edge' && options.hover.id === edge.id;
      const faceCount = geo.edgeFaces.get(edge.id)?.size ?? 0;
      const isProfile = options.showProfiles && faceCount < 2;

      let col = colorOf(soft ? THEME.softEdge : isProfile ? THEME.profile : THEME.edge);
      if (dimmed) col = mixColor(col, [0.85, 0.85, 0.85], 0.7);
      if (hovered) col = colorOf(THEME.highlight);

      const target = isSelected
        ? batches.selected
        : isProfile ? batches.profiles : batches.edges;
      if (isSelected) col = colorOf(THEME.selection);

      target.positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      target.colors.push(col[0], col[1], col[2], col[0], col[1], col[2]);
    }

    // --- Vértices (sólo para enganche en el contexto activo) ----------------
    if (isActiveContext) {
      for (const v of geo.vertices.values()) {
        pick.vertices.push({
          p: transformPoint(transform, v.p),
          vertexId: v.id,
          path: [...path],
          active: true,
        });
      }
    }

    // --- Instancias ----------------------------------------------------------
    for (const inst of geo.instances.values()) {
      if (inst.hidden && !options.showHiddenGeometry) continue;
      const childTransform = matMul(transform, inst.transform);
      const childPath = [...path, inst.id];

      const box = emptyBox();
      const childDef = model.definitions.get(inst.definitionId);
      if (childDef) {
        for (const v of childDef.geometry.vertices.values()) {
          expandBox(box, transformPoint(childTransform, v.p));
        }
      }
      pick.instanceBoxes.push({
        instanceId: inst.id, path: [...path], box, active: isActiveContext,
      });

      this.walk(
        model, inst.definitionId, childTransform, childPath, contextPath,
        depth + 1, options, batches, pick, visiting,
      );

      // Recuadro de selección de la instancia.
      if (isActiveContext && options.selection.instances.has(inst.id)) {
        addBoxEdges(batches.selected, box, colorOf(THEME.selection));
      } else if (isActiveContext && options.hover?.kind === 'instance' && options.hover.id === inst.id) {
        addBoxEdges(batches.selected, box, colorOf(THEME.highlight));
      }
    }

    visiting.delete(defId);
  }
}

/** Material heredado de la instancia contenedora, si la cara no tiene el suyo. */
function inheritedMaterial(model: Model, _geo: Geometry, path: Id[], _defId: Id) {
  if (path.length === 0) return null;
  // Se busca de dentro hacia fuera el primer material de instancia definido.
  let def = model.root;
  let material: string | null = null;
  for (const instId of path) {
    const inst = def.geometry.instances.get(instId);
    if (!inst) break;
    if (inst.materialId) material = inst.materialId;
    const next = model.definitions.get(inst.definitionId);
    if (!next) break;
    def = next;
  }
  return model.materialOrDefault(material);
}

function buildFaceGeometry(
  batch: FaceBatch,
  side: 'front' | 'back',
  monochrome: boolean,
  white: boolean,
): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
  const normals = side === 'front'
    ? batch.normals
    : batch.normals.map((n) => -n);
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

  let colors = side === 'front' ? batch.frontColors : batch.backColors;
  if (white) {
    colors = colors.map(() => 1);
  } else if (monochrome) {
    const base = side === 'front' ? colorOf(THEME.faceFront) : colorOf(THEME.faceBack);
    colors = colors.map((_, i) => base[i % 3]);
  }
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geom;
}

function faceMaterial(transparent: boolean, back: boolean): THREE.Material {
  return new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: back ? THREE.BackSide : THREE.FrontSide,
    transparent,
    opacity: transparent ? 0.45 : 1,
    depthWrite: !transparent,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    flatShading: false,
  });
}

function makeLines(batch: EdgeBatch, material: LineMaterial): LineSegments2 {
  const geom = new LineSegmentsGeometry();
  geom.setPositions(batch.positions);
  geom.setColors(batch.colors);
  const lines = new LineSegments2(geom, material);
  lines.computeLineDistances();
  return lines;
}

function addBoxEdges(batch: EdgeBatch, box: Box3, color: [number, number, number]): void {
  if (box.min.x > box.max.x) return;
  const { min, max } = box;
  const c = [
    v3(min.x, min.y, min.z), v3(max.x, min.y, min.z), v3(max.x, max.y, min.z), v3(min.x, max.y, min.z),
    v3(min.x, min.y, max.z), v3(max.x, min.y, max.z), v3(max.x, max.y, max.z), v3(min.x, max.y, max.z),
  ];
  const pairs: Array<[number, number]> = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  for (const [i, j] of pairs) {
    batch.positions.push(c[i].x, c[i].y, c[i].z, c[j].x, c[j].y, c[j].z);
    batch.colors.push(color[0], color[1], color[2], color[0], color[1], color[2]);
  }
}

export { hexToInt };


// ---------------------------------------------------------------------------
// Cotas y guías
// ---------------------------------------------------------------------------

/**
 * Dibuja las cotas: líneas de referencia desde los puntos medidos, línea de
 * cota desplazada y marcas en los extremos. El texto lo coloca la interfaz.
 */
function buildDimensions(model: Model, batch: EdgeBatch, pick: PickCache): void {
  const color = colorOf(THEME.dimension);
  for (const dim of model.dimensions.values()) {
    const a = dim.a;
    const b = dim.b;
    const off = dim.offset;
    const a2 = { x: a.x + off.x, y: a.y + off.y, z: a.z + off.z };
    const b2 = { x: b.x + off.x, y: b.y + off.y, z: b.z + off.z };

    pushSeg(batch, a, a2, color);
    pushSeg(batch, b, b2, color);
    pushSeg(batch, a2, b2, color);

    // Marcas oblicuas en los extremos de la línea de cota.
    const dx = b2.x - a2.x;
    const dy = b2.y - a2.y;
    const dz = b2.z - a2.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const ox = Math.hypot(off.x, off.y, off.z) || 1;
    const tick = Math.min(len, ox) * 0.12;
    const ux = (dx / len) * tick;
    const uy = (dy / len) * tick;
    const uz = (dz / len) * tick;
    const vx = (off.x / ox) * tick;
    const vy = (off.y / ox) * tick;
    const vz = (off.z / ox) * tick;
    pushSeg(batch,
      { x: a2.x - ux - vx, y: a2.y - uy - vy, z: a2.z - uz - vz },
      { x: a2.x + ux + vx, y: a2.y + uy + vy, z: a2.z + uz + vz }, color);
    pushSeg(batch,
      { x: b2.x - ux - vx, y: b2.y - uy - vy, z: b2.z - uz - vz },
      { x: b2.x + ux + vx, y: b2.y + uy + vy, z: b2.z + uz + vz }, color);

    pick.labels.push({
      text: dim.text,
      position: { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2, z: (a2.z + b2.z) / 2 },
      kind: 'dimension',
      id: dim.id,
    });
  }
}

/** Dibuja las guías de construcción con trazo discontinuo. */
function buildGuides(model: Model, batch: EdgeBatch): void {
  const color = colorOf(THEME.guide);
  for (const g of model.guides.values()) {
    if (g.kind === 'point') {
      const s = 0.02;
      pushSeg(batch, { x: g.a.x - s, y: g.a.y, z: g.a.z }, { x: g.a.x + s, y: g.a.y, z: g.a.z }, color);
      pushSeg(batch, { x: g.a.x, y: g.a.y - s, z: g.a.z }, { x: g.a.x, y: g.a.y + s, z: g.a.z }, color);
      pushSeg(batch, { x: g.a.x, y: g.a.y, z: g.a.z - s }, { x: g.a.x, y: g.a.y, z: g.a.z + s }, color);
    } else {
      pushSeg(batch, g.a, g.b, color);
    }
  }
}

function pushSeg(batch: EdgeBatch, a: Vec3, b: Vec3, c: [number, number, number]): void {
  batch.positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  batch.colors.push(c[0], c[1], c[2], c[0], c[1], c[2]);
}
