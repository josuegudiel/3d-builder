import { BaseTool } from './base';
import { PointerInfo } from '../app/editor';
import { Overlay } from '../render/overlay';
import { THEME } from '../render/theme';
import {
  Vec3, v3, add, sub, mul, dot, cross, normalize, length, addScaled,
  AXIS_X, AXIS_Z, signedAngle,
} from '../core/math/vec';
import { EPS, clamp } from '../core/math/tolerance';
import { Box3, emptyBox, expandBox, boxIsEmpty, boxCenter, boxSize } from '../core/math/geom';
import { Id } from '../core/model/types';
import { pickEntity, pickFace } from '../pick/picker';
import { closestPointOnLineToRay } from '../pick/inference';
import { pushPull } from '../core/ops/pushpull';
import { moveEntities, copyEntities, rotateEntities, scaleEntities, resolveVertices } from '../core/ops/transform';
import { offsetFace, offsetPolygon2, offsetSignTowards } from '../core/ops/offset';
import { followMe } from '../core/ops/followme';
import { selectedEdgeSet, clearSelection, selectionSize } from '../core/selection';
import { formatLength, formatAngle, parseLength, parseLengthList, parseAngle } from '../core/units';
import { matTranslation, matRotation } from '../core/math/mat';
import { planeBasis, to2D, to3D } from '../core/math/plane';

// ---------------------------------------------------------------------------
// Empujar/tirar
// ---------------------------------------------------------------------------

/**
 * Herramienta Empujar/Tirar. Es la operación característica de SketchUp:
 * convierte una cara plana en un volumen, o desplaza la cara de un sólido.
 */
export class PushPullTool extends BaseTool {
  readonly id = 'pushpull';
  readonly name = 'Empujar/Tirar';
  readonly statusHint = 'Clic en una cara y arrastra. Escribe la distancia para un valor exacto. Ctrl crea geometría nueva.';

  private faceId: Id | null = null;
  private hoverFace: Id | null = null;
  private startPoint: Vec3 | null = null;
  private normalWorld: Vec3 = AXIS_Z;
  private currentDistance = 0;
  private lastDistance = 0;
  private createNew = false;

  override onPointerMove(e: PointerInfo): void {
    this.createNew = e.ctrlKey;

    if (this.faceId === null) {
      const hit = pickFace(
        this.editor.viewport.builder.pick, this.editor.viewport, e.clientX, e.clientY,
      );
      const id = hit ? hit.id : null;
      if (id !== this.hoverFace) {
        this.hoverFace = id;
        this.editor.renderOptions.hover = id !== null ? { kind: 'face', id } : null;
        this.editor.refreshModel();
      }
      return;
    }

    const ray = this.editor.viewport.rayFromClient(e.clientX, e.clientY);
    const p = closestPointOnLineToRay(this.startPoint!, this.normalWorld, ray);
    this.currentDistance = dot(sub(p, this.startPoint!), this.normalWorld);
    this.editor.showMeasurement('Distancia', formatLength(this.currentDistance, this.editor.units));
    this.editor.refreshOverlay();
  }

  override onPointerDown(e: PointerInfo): void {
    if (e.button !== 0) return;

    if (this.faceId === null) {
      const hit = pickFace(
        this.editor.viewport.builder.pick, this.editor.viewport, e.clientX, e.clientY,
      );
      if (!hit) return;
      this.beginOn(hit.id, hit.point);
      return;
    }

    this.apply(this.currentDistance);
  }

  private beginOn(faceId: Id, worldPoint: Vec3): void {
    const face = this.editor.geometry.faces.get(faceId);
    if (!face) return;
    this.faceId = faceId;
    this.startPoint = worldPoint;
    this.normalWorld = normalize(this.editor.toWorldVector(face.plane.n));
    this.currentDistance = 0;
    this.editor.showMeasurement('Distancia', formatLength(0, this.editor.units));
  }

  override onDoubleClick(e: PointerInfo): void {
    // Repite la última distancia sobre la cara señalada.
    if (this.faceId !== null || Math.abs(this.lastDistance) <= EPS) return;
    const hit = pickFace(
      this.editor.viewport.builder.pick, this.editor.viewport, e.clientX, e.clientY,
    );
    if (!hit) return;
    this.beginOn(hit.id, hit.point);
    this.apply(this.lastDistance);
  }

  private apply(dist: number): void {
    const faceId = this.faceId;
    if (faceId === null || Math.abs(dist) <= EPS) {
      this.cancel();
      return;
    }
    const createNew = this.createNew;
    this.editor.edit('Empujar/Tirar', () => {
      pushPull(this.editor.geometry, faceId, dist, { createNew });
    });
    this.lastDistance = dist;
    this.cancel();
  }

  override onMeasurement(text: string): boolean {
    if (this.faceId === null) return false;
    const value = parseLength(text, { defaultUnit: this.editor.units.unit });
    if (value === null) return false;
    // Se conserva el sentido hacia el que se estaba arrastrando.
    const signed = this.currentDistance < 0 ? -Math.abs(value) : Math.abs(value);
    this.apply(signed);
    return true;
  }

  override cancel(): void {
    this.faceId = null;
    this.startPoint = null;
    this.currentDistance = 0;
    this.hoverFace = null;
    this.editor.renderOptions.hover = null;
    super.cancel();
  }

  override drawOverlay(overlay: Overlay): void {
    if (this.faceId === null || !this.startPoint) return;
    const face = this.editor.geometry.faces.get(this.faceId);
    if (!face) return;

    const offsetWorld = mul(this.normalWorld, this.currentDistance);
    for (const loop of face.loops) {
      const worldRing = loop.vertices.map((v) => this.world(this.editor.geometry.vertexPos(v)));
      const moved = worldRing.map((p) => add(p, offsetWorld));
      overlay.addPolyline(moved, THEME.selection, true);
      overlay.addGhostPolygon(moved, THEME.selectionFace);
      for (let i = 0; i < worldRing.length; i++) {
        overlay.addLine(worldRing[i], moved[i], THEME.selection);
      }
    }
    overlay.addLine(
      this.startPoint,
      add(this.startPoint, offsetWorld),
      THEME.axisZ, true,
    );
  }
}

// ---------------------------------------------------------------------------
// Mover
// ---------------------------------------------------------------------------

/** Herramienta Mover, con copia (Ctrl) y bloqueo de ejes. */
export class MoveTool extends BaseTool {
  readonly id = 'move';
  readonly name = 'Mover';
  readonly statusHint = 'Selecciona, clic en el punto base y clic en el destino. Ctrl copia. Flechas bloquean el eje.';

  protected basePoint: Vec3 | null = null;
  protected delta: Vec3 = v3(0, 0, 0);
  protected copyMode = false;

  override onPointerMove(e: PointerInfo): void {
    this.copyMode = e.ctrlKey;
    const hit = this.updateInference(e);
    if (this.basePoint) {
      this.delta = sub(hit.point, this.basePoint);
      this.editor.showMeasurement('Distancia', formatLength(length(this.delta), this.editor.units));
    }
    this.editor.refreshOverlay();
  }

  override onPointerDown(e: PointerInfo): void {
    if (e.button !== 0) return;
    const hit = this.updateInference(e);

    if (this.basePoint === null) {
      // Sin selección previa se toma la entidad bajo el cursor.
      if (selectionSize(this.editor.selection) === 0) {
        const picked = pickEntity(
          this.editor.viewport.builder.pick, this.editor.viewport, e.clientX, e.clientY,
        );
        if (picked) {
          clearSelection(this.editor.selection);
          if (picked.kind === 'face') this.editor.selection.faces.add(picked.id);
          else if (picked.kind === 'edge') this.editor.selection.edges.add(picked.id);
          else if (picked.kind === 'vertex') this.editor.selection.vertices.add(picked.id);
          else if (picked.kind === 'instance') this.editor.selection.instances.add(picked.id);
          this.editor.refreshModel();
        }
      }
      if (selectionSize(this.editor.selection) === 0) return;
      this.basePoint = hit.point;
      this.anchor = hit.point;
      return;
    }

    this.applyDelta(this.delta);
  }

  protected applyDelta(delta: Vec3): void {
    if (length(delta) <= EPS) {
      this.cancel();
      return;
    }
    const local = this.editor.toContextVector(delta);
    const sel = this.editor.selection;
    const targets = {
      vertices: [...sel.vertices],
      edges: [...sel.edges],
      faces: [...sel.faces],
      instances: [...sel.instances],
    };
    const copy = this.copyMode;
    this.editor.edit(copy ? 'Copiar' : 'Mover', () => {
      if (copy) copyEntities(this.editor.geometry, targets, matTranslation(local));
      else moveEntities(this.editor.geometry, targets, local);
    });
    this.cancel();
  }

  override onMeasurement(text: string): boolean {
    if (!this.basePoint) return false;
    const list = parseLengthList(text, { defaultUnit: this.editor.units.unit });
    if (!list) return false;
    if (list.length >= 3) {
      this.applyDelta(v3(list[0], list[1], list[2]));
      return true;
    }
    const value = list[0];
    const dir = length(this.delta) > EPS ? normalize(this.delta) : null;
    if (!dir) return false;
    this.applyDelta(mul(dir, value));
    return true;
  }

  override cancel(): void {
    this.basePoint = null;
    this.delta = v3(0, 0, 0);
    super.cancel();
  }

  override drawOverlay(overlay: Overlay): void {
    this.drawInference(overlay);
    if (!this.basePoint) return;
    const target = add(this.basePoint, this.delta);
    overlay.addLine(this.basePoint, target, THEME.selection);
    overlay.addGlyph(this.basePoint, THEME.selection, 'cross');
    drawSelectionGhost(this.editor, overlay, (p) => add(p, this.delta));
  }
}

// ---------------------------------------------------------------------------
// Rotar
// ---------------------------------------------------------------------------

/** Herramienta Rotar con transportador. */
export class RotateTool extends BaseTool {
  readonly id = 'rotate';
  readonly name = 'Rotar';
  readonly statusHint = 'Clic en el centro, clic en el punto de referencia y gira. Escribe el ángulo en grados.';

  private center: Vec3 | null = null;
  private axis: Vec3 = AXIS_Z;
  private startDir: Vec3 | null = null;
  private angle = 0;
  private copyMode = false;

  override onPointerMove(e: PointerInfo): void {
    this.copyMode = e.ctrlKey;
    const hit = this.updateInference(e);

    if (!this.center) {
      // El eje de giro se toma de la cara señalada, si la hay.
      if (hit.plane) this.axis = normalize(this.editor.toWorldVector(hit.plane.n));
      else this.axis = AXIS_Z;
      this.editor.refreshOverlay();
      return;
    }

    const flat = projectToPlane(sub(hit.point, this.center), this.axis);
    if (!this.startDir) {
      this.editor.showMeasurement('Radio', formatLength(length(flat), this.editor.units));
    } else if (length(flat) > EPS) {
      this.angle = signedAngle(this.startDir, flat, this.axis);
      this.editor.showMeasurement('Ángulo', formatAngle(this.angle, this.editor.units));
    }
    this.editor.refreshOverlay();
  }

  override onPointerDown(e: PointerInfo): void {
    if (e.button !== 0) return;
    const hit = this.updateInference(e);

    if (!this.center) {
      if (selectionSize(this.editor.selection) === 0) return;
      this.center = hit.point;
      this.anchor = hit.point;
      if (hit.plane) this.axis = normalize(this.editor.toWorldVector(hit.plane.n));
      return;
    }
    if (!this.startDir) {
      const flat = projectToPlane(sub(hit.point, this.center), this.axis);
      if (length(flat) <= EPS) return;
      this.startDir = normalize(flat);
      return;
    }
    this.apply(this.angle);
  }

  private apply(angle: number): void {
    if (!this.center || Math.abs(angle) <= 1e-9) {
      this.cancel();
      return;
    }
    const localCenter = this.editor.toContext(this.center);
    const localAxis = normalize(this.editor.toContextVector(this.axis));
    const sel = this.editor.selection;
    const targets = {
      vertices: [...sel.vertices],
      edges: [...sel.edges],
      faces: [...sel.faces],
      instances: [...sel.instances],
    };
    const copy = this.copyMode;
    this.editor.edit(copy ? 'Copiar girando' : 'Rotar', () => {
      if (copy) {
        copyEntities(this.editor.geometry, targets, matRotation(localAxis, angle, localCenter));
      } else {
        rotateEntities(this.editor.geometry, targets, localAxis, angle, localCenter);
      }
    });
    this.cancel();
  }

  override onMeasurement(text: string): boolean {
    if (!this.center || !this.startDir) return false;
    const a = parseAngle(text);
    if (a === null) return false;
    this.apply(a);
    return true;
  }

  override cancel(): void {
    this.center = null;
    this.startDir = null;
    this.angle = 0;
    super.cancel();
  }

  override drawOverlay(overlay: Overlay): void {
    this.drawInference(overlay);
    if (!this.center) return;

    const radius = this.startDir
      ? Math.max(length(sub(this.hit?.point ?? this.center, this.center)), 1e-3)
      : this.editor.viewport.cameraCtl.distance * 0.12;

    // Transportador
    const u = normalize(projectToPlane(
      this.startDir ?? perpendicular(this.axis), this.axis,
    ));
    const w = cross(this.axis, u);
    const ring: Vec3[] = [];
    for (let i = 0; i < 48; i++) {
      const t = (i / 48) * Math.PI * 2;
      ring.push(add(this.center, add(mul(u, Math.cos(t) * radius), mul(w, Math.sin(t) * radius))));
    }
    overlay.addPolyline(ring, THEME.guide, true, true);

    if (this.startDir) {
      overlay.addLine(this.center, addScaled(this.center, this.startDir, radius), THEME.guide);
      const rotated = add(
        mul(this.startDir, Math.cos(this.angle)),
        mul(cross(this.axis, this.startDir), Math.sin(this.angle)),
      );
      overlay.addLine(this.center, addScaled(this.center, rotated, radius), THEME.selection);
      const angleRotate = this.angle;
      const axis = this.axis;
      const center = this.center;
      drawSelectionGhost(this.editor, overlay, (p) => {
        const rel = sub(p, center);
        const par = mul(axis, dot(rel, axis));
        const perp = sub(rel, par);
        const rot = add(
          mul(perp, Math.cos(angleRotate)),
          mul(cross(axis, perp), Math.sin(angleRotate)),
        );
        return add(center, add(par, rot));
      });
    }
    overlay.addGlyph(this.center, THEME.selection, 'cross');
  }
}

// ---------------------------------------------------------------------------
// Escalar
// ---------------------------------------------------------------------------

/**
 * Tirador de la caja envolvente. Las posiciones están en el espacio del
 * CONTEXTO de edición, no del mundo: si se está editando un grupo girado, los
 * factores de escala deben referirse a sus ejes locales, que es lo que espera
 * `scaleEntities`.
 */
interface Grip {
  /** Índice (-1, 0, 1) en cada eje. */
  ix: number;
  iy: number;
  iz: number;
  position: Vec3;
  opposite: Vec3;
}

/**
 * Herramienta Escalar con los 26 tiradores de la caja envolvente:
 * esquinas (escala uniforme), centros de arista (dos ejes) y centros de cara
 * (un solo eje).
 */
export class ScaleTool extends BaseTool {
  readonly id = 'scale';
  readonly name = 'Escalar';
  readonly statusHint = 'Selecciona y arrastra un tirador. Escribe el factor, o una longitud con unidad.';

  private box: Box3 = emptyBox();
  private grips: Grip[] = [];
  private active: Grip | null = null;
  private factors: Vec3 = v3(1, 1, 1);
  private uniform = false;

  override activate(): void {
    super.activate();
    this.recomputeBox();
  }

  private recomputeBox(): void {
    const geo = this.editor.geometry;
    const sel = this.editor.selection;
    const box = emptyBox();
    for (const v of resolveVertices(geo, {
      vertices: [...sel.vertices], edges: [...sel.edges], faces: [...sel.faces],
    })) {
      expandBox(box, geo.vertexPos(v));
    }
    for (const instId of sel.instances) {
      const inst = geo.instances.get(instId);
      if (!inst) continue;
      // `instanceBoxCorners` ya aplica la transformación de la instancia, así
      // que sus esquinas están en el espacio del contenedor.
      for (const c of this.editor.model.instanceBoxCorners(inst)) expandBox(box, c);
    }
    this.box = box;
    this.grips = [];
    if (boxIsEmpty(box)) return;

    const c = boxCenter(box);
    const s = boxSize(box);
    const coord = (i: number, min: number, mid: number, max: number) =>
      i < 0 ? min : i > 0 ? max : mid;

    for (let ix = -1; ix <= 1; ix++) {
      for (let iy = -1; iy <= 1; iy++) {
        for (let iz = -1; iz <= 1; iz++) {
          if (ix === 0 && iy === 0 && iz === 0) continue;
          // Se omiten los tiradores de ejes con tamaño nulo (geometría plana).
          if (ix !== 0 && s.x <= EPS) continue;
          if (iy !== 0 && s.y <= EPS) continue;
          if (iz !== 0 && s.z <= EPS) continue;
          const position = v3(
            coord(ix, box.min.x, c.x, box.max.x),
            coord(iy, box.min.y, c.y, box.max.y),
            coord(iz, box.min.z, c.z, box.max.z),
          );
          const opposite = v3(
            coord(-ix, box.min.x, c.x, box.max.x),
            coord(-iy, box.min.y, c.y, box.max.y),
            coord(-iz, box.min.z, c.z, box.max.z),
          );
          this.grips.push({ ix, iy, iz, position, opposite });
        }
      }
    }
  }

  override onPointerMove(e: PointerInfo): void {
    this.uniform = e.shiftKey;
    if (!this.active) {
      this.recomputeBox();
      this.editor.refreshOverlay();
      return;
    }

    const worldRay = this.editor.viewport.rayFromClient(e.clientX, e.clientY);
    // El rayo se lleva al espacio del contexto para razonar en los mismos ejes
    // que la caja envolvente y que la propia escala.
    const ray = {
      origin: this.editor.toContext(worldRay.origin),
      dir: normalize(this.editor.toContextVector(worldRay.dir)),
    };
    const g = this.active;
    const original = sub(g.position, g.opposite);
    // Se busca el punto del rayo más cercano a la recta tirador-opuesto.
    const p = closestPointOnLineToRay(g.opposite, normalize(original), ray);
    const moved = sub(p, g.opposite);

    const ratio = (o: number, m: number) => (Math.abs(o) <= EPS ? 1 : m / o);
    let fx = g.ix !== 0 ? ratio(original.x, moved.x) : 1;
    let fy = g.iy !== 0 ? ratio(original.y, moved.y) : 1;
    let fz = g.iz !== 0 ? ratio(original.z, moved.z) : 1;

    const axesUsed = (g.ix !== 0 ? 1 : 0) + (g.iy !== 0 ? 1 : 0) + (g.iz !== 0 ? 1 : 0);
    if (axesUsed === 3 || this.uniform) {
      const f = axesUsed === 3
        ? (fx + fy + fz) / 3
        : [fx, fy, fz].filter((_, i) => [g.ix, g.iy, g.iz][i] !== 0).reduce((a, b) => a + b, 0) / axesUsed;
      fx = g.ix !== 0 || this.uniform ? f : 1;
      fy = g.iy !== 0 || this.uniform ? f : 1;
      fz = g.iz !== 0 || this.uniform ? f : 1;
    }

    this.factors = v3(fx, fy, fz);
    this.editor.showMeasurement('Escala', formatFactors(this.factors));
    this.editor.refreshOverlay();
  }

  override onPointerDown(e: PointerInfo): void {
    if (e.button !== 0) return;
    if (this.active) {
      this.apply(this.factors);
      return;
    }
    if (selectionSize(this.editor.selection) === 0) return;

    // Tirador más cercano al cursor, en píxeles.
    const cursor = this.editor.viewport.toLocal(e.clientX, e.clientY);
    let best: Grip | null = null;
    let bestD = 14;
    for (const g of this.grips) {
      const s = this.editor.viewport.worldToScreen(this.world(g.position));
      const d = Math.hypot(s.x - cursor.x, s.y - cursor.y);
      if (d < bestD) {
        bestD = d;
        best = g;
      }
    }
    if (!best) return;
    this.active = best;
    this.factors = v3(1, 1, 1);
    this.editor.showMeasurement('Escala', formatFactors(this.factors));
  }

  private apply(factors: Vec3): void {
    const g = this.active;
    if (!g) {
      this.cancel();
      return;
    }
    if (Math.abs(factors.x - 1) < 1e-9 && Math.abs(factors.y - 1) < 1e-9 && Math.abs(factors.z - 1) < 1e-9) {
      this.cancel();
      return;
    }
    const origin = g.opposite;
    const sel = this.editor.selection;
    const targets = {
      vertices: [...sel.vertices],
      edges: [...sel.edges],
      faces: [...sel.faces],
      instances: [...sel.instances],
    };
    this.editor.edit('Escalar', () => {
      scaleEntities(this.editor.geometry, targets, factors, origin);
    });
    this.cancel();
  }

  override onMeasurement(text: string): boolean {
    if (!this.active) return false;
    const t = text.trim();
    // Varios factores separados: "2;1;0.5"
    const parts = t.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
    const nums = parts.map((s) => Number(s.replace(',', '.')));
    if (nums.length >= 1 && nums.every((n) => Number.isFinite(n) && n !== 0) && !/[a-zA-Z"']/.test(t)) {
      const g = this.active;
      if (nums.length === 1) {
        const f = nums[0];
        const axes = (g.ix !== 0 ? 1 : 0) + (g.iy !== 0 ? 1 : 0) + (g.iz !== 0 ? 1 : 0);
        this.apply(v3(
          g.ix !== 0 || axes === 3 ? f : 1,
          g.iy !== 0 || axes === 3 ? f : 1,
          g.iz !== 0 || axes === 3 ? f : 1,
        ));
      } else {
        this.apply(v3(nums[0] ?? 1, nums[1] ?? 1, nums[2] ?? 1));
      }
      return true;
    }

    // Longitud con unidad: se escala para que la dimensión resulte exacta.
    const value = parseLength(t, { defaultUnit: this.editor.units.unit, allowNegative: false });
    if (value === null || value <= EPS) return false;
    const g = this.active;
    const original = sub(g.position, g.opposite);
    const len = length(original);
    if (len <= EPS) return false;
    const f = value / len;
    const axes = (g.ix !== 0 ? 1 : 0) + (g.iy !== 0 ? 1 : 0) + (g.iz !== 0 ? 1 : 0);
    this.apply(v3(
      g.ix !== 0 || axes === 3 ? f : 1,
      g.iy !== 0 || axes === 3 ? f : 1,
      g.iz !== 0 || axes === 3 ? f : 1,
    ));
    return true;
  }

  override cancel(): void {
    this.active = null;
    this.factors = v3(1, 1, 1);
    this.recomputeBox();
    super.cancel();
  }

  override drawOverlay(overlay: Overlay): void {
    if (boxIsEmpty(this.box)) return;

    const preview = this.active
      ? (p: Vec3) => {
        const o = this.active!.opposite;
        return v3(
          o.x + (p.x - o.x) * this.factors.x,
          o.y + (p.y - o.y) * this.factors.y,
          o.z + (p.z - o.z) * this.factors.z,
        );
      }
      : (p: Vec3) => p;

    const { min, max } = this.box;
    const corners = [
      v3(min.x, min.y, min.z), v3(max.x, min.y, min.z), v3(max.x, max.y, min.z), v3(min.x, max.y, min.z),
      v3(min.x, min.y, max.z), v3(max.x, min.y, max.z), v3(max.x, max.y, max.z), v3(min.x, max.y, max.z),
    ].map((p) => this.world(preview(p)));
    const pairs: Array<[number, number]> = [
      [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    for (const [i, j] of pairs) overlay.addLine(corners[i], corners[j], THEME.guide, true);

    for (const g of this.grips) {
      const active = this.active === g;
      overlay.addGlyph(
        this.world(preview(g.position)),
        active ? THEME.selection : THEME.highlight,
        'square',
      );
    }

    // La previsualización recibe puntos en el mundo, así que hay que ir y volver.
    if (this.active) {
      drawSelectionGhost(this.editor, overlay, (p) => this.world(preview(this.editor.toContext(p))));
    }
  }
}

// ---------------------------------------------------------------------------
// Equidistancia
// ---------------------------------------------------------------------------

/** Herramienta Equidistancia: desplaza el contorno de una cara. */
export class OffsetTool extends BaseTool {
  readonly id = 'offset';
  readonly name = 'Equidistancia';
  readonly statusHint = 'Clic en una cara y arrastra hacia dentro o hacia fuera. Escribe la distancia exacta.';

  private faceId: Id | null = null;
  private distance = 0;
  private previewRing: Vec3[] = [];
  private lastDistance = 0;

  override onPointerMove(e: PointerInfo): void {
    if (this.faceId === null) {
      const hit = pickFace(
        this.editor.viewport.builder.pick, this.editor.viewport, e.clientX, e.clientY,
      );
      const id = hit ? hit.id : null;
      if (id !== this.editor.renderOptions.hover?.id) {
        this.editor.renderOptions.hover = id !== null ? { kind: 'face', id } : null;
        this.editor.refreshModel();
      }
      return;
    }

    const face = this.editor.geometry.faces.get(this.faceId);
    if (!face) return;
    const basis = planeBasis(face.plane);
    const ring3 = face.loops[0].vertices.map((v) => this.editor.geometry.vertexPos(v));
    const ring2 = ring3.map((p) => to2D(basis, p));

    // Punto del cursor proyectado sobre el plano de la cara.
    const ray = this.editor.viewport.rayFromClient(e.clientX, e.clientY);
    const localOrigin = this.editor.toContext(ray.origin);
    const localDir = normalize(this.editor.toContextVector(ray.dir));
    const denom = dot(face.plane.n, localDir);
    if (Math.abs(denom) < 1e-9) return;
    const t = (face.plane.d - dot(face.plane.n, localOrigin)) / denom;
    const onPlane = addScaled(localOrigin, localDir, t);
    const cursor2 = to2D(basis, onPlane);

    const sign = offsetSignTowards(ring2, cursor2);
    const dist = distanceToRing2(ring2, cursor2) * sign;
    this.distance = dist;

    const off2 = offsetPolygon2(ring2, dist);
    this.previewRing = off2.map((p) => this.world(to3D(basis, p)));
    this.editor.showMeasurement('Distancia', formatLength(Math.abs(dist), this.editor.units));
    this.editor.refreshOverlay();
  }

  override onPointerDown(e: PointerInfo): void {
    if (e.button !== 0) return;
    if (this.faceId === null) {
      const hit = pickFace(
        this.editor.viewport.builder.pick, this.editor.viewport, e.clientX, e.clientY,
      );
      if (!hit) return;
      this.faceId = hit.id;
      this.editor.renderOptions.hover = { kind: 'face', id: hit.id };
      this.editor.refreshModel();
      return;
    }
    this.apply(this.distance);
  }

  override onDoubleClick(e: PointerInfo): void {
    if (this.faceId !== null || Math.abs(this.lastDistance) <= EPS) return;
    const hit = pickFace(
      this.editor.viewport.builder.pick, this.editor.viewport, e.clientX, e.clientY,
    );
    if (!hit) return;
    this.faceId = hit.id;
    this.apply(this.lastDistance);
  }

  private apply(dist: number): void {
    const faceId = this.faceId;
    if (faceId === null || Math.abs(dist) <= EPS) {
      this.cancel();
      return;
    }
    this.editor.edit('Equidistancia', () => {
      offsetFace(this.editor.geometry, faceId, dist);
    });
    this.lastDistance = dist;
    this.cancel();
  }

  override onMeasurement(text: string): boolean {
    if (this.faceId === null) return false;
    const value = parseLength(text, { defaultUnit: this.editor.units.unit });
    if (value === null) return false;
    const signed = this.distance < 0 ? -Math.abs(value) : Math.abs(value);
    this.apply(signed);
    return true;
  }

  override cancel(): void {
    this.faceId = null;
    this.previewRing = [];
    this.distance = 0;
    this.editor.renderOptions.hover = null;
    super.cancel();
  }

  override drawOverlay(overlay: Overlay): void {
    if (this.previewRing.length >= 3) {
      overlay.addPolyline(this.previewRing, THEME.selection, true);
    }
  }
}

// ---------------------------------------------------------------------------
// Sígueme
// ---------------------------------------------------------------------------

/**
 * Herramienta Sígueme: barre una cara-perfil a lo largo de las aristas
 * seleccionadas previamente.
 */
export class FollowMeTool extends BaseTool {
  readonly id = 'followme';
  readonly name = 'Sígueme';
  readonly statusHint = 'Selecciona primero el recorrido (aristas) y después haz clic en la cara del perfil.';

  override onPointerMove(e: PointerInfo): void {
    const hit = pickFace(
      this.editor.viewport.builder.pick, this.editor.viewport, e.clientX, e.clientY,
    );
    const id = hit ? hit.id : null;
    if (id !== this.editor.renderOptions.hover?.id) {
      this.editor.renderOptions.hover = id !== null ? { kind: 'face', id } : null;
      this.editor.refreshModel();
    }
  }

  override onPointerDown(e: PointerInfo): void {
    if (e.button !== 0) return;
    const hit = pickFace(
      this.editor.viewport.builder.pick, this.editor.viewport, e.clientX, e.clientY,
    );
    if (!hit) return;

    const path = [...selectedEdgeSet(this.editor.selection, this.editor.geometry)]
      .filter((eid) => !this.editor.geometry.faceEdges(hit.id).includes(eid));
    if (path.length === 0) {
      this.editor.setStatus('Selecciona antes las aristas del recorrido.');
      return;
    }

    this.editor.edit('Sígueme', () => {
      followMe(this.editor.geometry, hit.id, path);
    });
    clearSelection(this.editor.selection);
    this.editor.renderOptions.hover = null;
    this.editor.refreshModel();
  }
}

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

function projectToPlane(v: Vec3, normal: Vec3): Vec3 {
  const n = normalize(normal);
  return sub(v, mul(n, dot(v, n)));
}

function perpendicular(n: Vec3): Vec3 {
  const helper = Math.abs(n.z) < 0.9 ? AXIS_Z : AXIS_X;
  return normalize(cross(n, helper));
}

function formatFactors(f: Vec3): string {
  const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();
  if (Math.abs(f.x - f.y) < 1e-9 && Math.abs(f.y - f.z) < 1e-9) return fmt(f.x);
  return `${fmt(f.x)} ; ${fmt(f.y)} ; ${fmt(f.z)}`;
}

function distanceToRing2(ring: Array<{ x: number; y: number }>, p: { x: number; y: number }): number {
  let best = Infinity;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const l2 = abx * abx + aby * aby;
    let t = l2 <= 1e-18 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
    t = clamp(t, 0, 1);
    const d = Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
    if (d < best) best = d;
  }
  return best;
}

/** Dibuja la previsualización de la selección transformada. */
function drawSelectionGhost(
  editor: { geometry: import('../core/model/geometry').Geometry; selection: import('../core/selection').Selection; toWorld: (p: Vec3) => Vec3; model: import('../core/model/model').Model },
  overlay: Overlay,
  transform: (p: Vec3) => Vec3,
): void {
  const geo = editor.geometry;
  const sel = editor.selection;
  const edges = selectedEdgeSet(sel, geo);
  let drawn = 0;
  for (const eid of edges) {
    if (drawn++ > 4000) break;
    const e = geo.edges.get(eid);
    if (!e) continue;
    const a = transform(editor.toWorld(geo.vertexPos(e.a)));
    const b = transform(editor.toWorld(geo.vertexPos(e.b)));
    overlay.addLine(a, b, THEME.selection);
  }
  for (const instId of sel.instances) {
    const inst = geo.instances.get(instId);
    if (!inst) continue;
    const corners = editor.model.instanceBoxCorners(inst).map((c) => transform(editor.toWorld(c)));
    const pairs: Array<[number, number]> = [
      [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    for (const [i, j] of pairs) overlay.addLine(corners[i], corners[j], THEME.selection);
  }
}
