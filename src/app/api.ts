import { Editor } from './editor';
import { Model } from '../core/model/model';
import { Geometry } from '../core/model/geometry';
import { Id } from '../core/model/types';
import { Vec3, v3 } from '../core/math/vec';
import { drawPolyline, drawSegment } from '../core/ops/draw';
import { pushPull, PushPullOptions } from '../core/ops/pushpull';
import { moveEntities, rotateEntities, scaleEntities, TransformTargets } from '../core/ops/transform';
import { offsetFace } from '../core/ops/offset';
import { eraseEdges, eraseFaces } from '../core/ops/erase';
import { makeGroup, explodeInstance } from '../core/ops/group';
import { circlePoints, polygonPoints, frameFromNormal, rectanglePoints } from '../core/ops/primitives';
import { SOLIDS, SolidDefinition } from '../core/ops/solids';
import { insertSolid } from '../ui/solids-dialog';
import { faceArea, faceCentroid } from '../core/topology/triangulate';
import { shellVolume, isSolid, faceComponent, orientFacesConsistently, flipFace } from '../core/topology/orient';
import { findOverlappingEdges } from '../core/topology/repair';
import { serializeToJSON, deserializeModel } from '../core/io/serialize';
import { exportOBJ } from '../core/io/obj';
import { exportSTLAscii, exportSTLBinary } from '../core/io/stl';
import { parseLength, formatLength, formatArea, formatVolume } from '../core/units';
import { StandardView } from '../render/camera';
import { IDENTITY } from '../core/math/mat';
import { selectAll, clearSelection } from '../core/selection';
import {
  toDegrees, dihedralAngle, angleBetweenEdges, edgeDirectionAngle, planeAngle, cutAngles,
} from '../core/measure/angles';
import {
  Member, JointReport, measureInstance, measureMember, analyseJoint,
} from '../core/measure/member';
import { describeJoint, describeMember } from '../core/measure/report';
import {
  BooleanOp, BOOLEAN_LABEL, booleanInstances, booleanSolids, SolidOpResult,
} from '../core/ops/boolean';
import { intersectFaceSets } from '../core/ops/intersect';
import { rebuildFaces, collectCandidatePlanes } from '../core/topology/rebuild';

/**
 * Interfaz de automatización.
 *
 * Se publica en `window.form3d.api` y da acceso, desde la consola del
 * navegador o desde un guion, a las mismas operaciones que usan las
 * herramientas. Sirve para generar geometría por programa, para comprobar
 * medidas y para las pruebas de extremo a extremo.
 *
 * Todas las longitudes se expresan en METROS, igual que en el modelo. Para
 * convertir desde el texto que escribiría un usuario está `parse`.
 */
export class Form3DApi {
  constructor(private readonly editor: Editor) {}

  // -------------------------------------------------------------------------
  // Acceso al modelo
  // -------------------------------------------------------------------------

  get model(): Model {
    return this.editor.model;
  }

  /** Geometría del contexto de edición activo. */
  get geometry(): Geometry {
    return this.editor.geometry;
  }

  get selection() {
    return this.editor.selection;
  }

  /** Punto: `api.p(1, 2, 0)`. */
  p(x: number, y: number, z = 0): Vec3 {
    return v3(x, y, z);
  }

  /** Interpreta una medida escrita ("1200", "1.2m", "5' 6\"") y da metros. */
  parse(text: string): number | null {
    return parseLength(text, { defaultUnit: this.editor.units.unit });
  }

  /** Formatea metros con las unidades activas. */
  format(meters: number): string {
    return formatLength(meters, this.editor.units);
  }

  // -------------------------------------------------------------------------
  // Dibujo
  // -------------------------------------------------------------------------

  /** Dibuja una polilínea y reconstruye las caras. */
  polyline(points: readonly Vec3[], closed = true): Id[] {
    return this.run('Polilínea', () =>
      drawPolyline(this.geometry, points, closed).rebuild.created);
  }

  segment(a: Vec3, b: Vec3): Id[] {
    return this.run('Línea', () => drawSegment(this.geometry, a, b).rebuild.created);
  }

  /** Rectángulo axial en el plano Z = z. */
  rectangle(x0: number, y0: number, x1: number, y1: number, z = 0): Id[] {
    return this.polyline([
      v3(x0, y0, z), v3(x1, y0, z), v3(x1, y1, z), v3(x0, y1, z),
    ], true);
  }

  /** Rectángulo sobre un plano cualquiera, dado por dos esquinas opuestas. */
  rectangleOn(normal: Vec3, corner0: Vec3, corner1: Vec3): Id[] {
    const frame = frameFromNormal(corner0, normal);
    const pts = rectanglePoints(frame, corner0, corner1);
    return pts.length === 4 ? this.polyline(pts, true) : [];
  }

  circle(center: Vec3, radius: number, segments = 24, normal: Vec3 = v3(0, 0, 1)): Id[] {
    const pts = circlePoints(center, normal, radius, segments);
    return pts.length >= 3 ? this.polyline(pts, true) : [];
  }

  polygon(center: Vec3, radius: number, sides = 6, normal: Vec3 = v3(0, 0, 1)): Id[] {
    const pts = polygonPoints(center, normal, radius, sides, true);
    return pts.length >= 3 ? this.polyline(pts, true) : [];
  }

  // -------------------------------------------------------------------------
  // Modificación
  // -------------------------------------------------------------------------

  pushPull(faceId: Id, distance: number, opts: PushPullOptions = {}): Id | null {
    return this.run('Empujar/Tirar', () =>
      pushPull(this.geometry, faceId, distance, opts).faceId);
  }

  offset(faceId: Id, distance: number): Id[] {
    return this.run('Equidistancia', () =>
      offsetFace(this.geometry, faceId, distance)?.createdFaces ?? []);
  }

  move(targets: TransformTargets, delta: Vec3): void {
    this.run('Mover', () => moveEntities(this.geometry, targets, delta));
  }

  rotate(targets: TransformTargets, axis: Vec3, angleDegrees: number, origin: Vec3): void {
    this.run('Rotar', () =>
      rotateEntities(this.geometry, targets, axis, (angleDegrees * Math.PI) / 180, origin));
  }

  scale(targets: TransformTargets, factors: Vec3, origin: Vec3): void {
    this.run('Escalar', () => scaleEntities(this.geometry, targets, factors, origin));
  }

  eraseEdges(ids: Iterable<Id>): void {
    this.run('Borrar aristas', () => eraseEdges(this.geometry, ids));
  }

  eraseFaces(ids: Iterable<Id>): void {
    this.run('Borrar caras', () => eraseFaces(this.geometry, ids));
  }

  flipFace(id: Id): void {
    this.run('Invertir cara', () => flipFace(this.geometry, id));
  }

  orient(seeds?: Iterable<Id>): void {
    this.run('Orientar', () =>
      orientFacesConsistently(this.geometry, seeds ?? this.geometry.faces.keys()));
  }

  // -------------------------------------------------------------------------
  // Grupos y sólidos
  // -------------------------------------------------------------------------

  group(name = 'Grupo'): Id | null {
    return this.run('Crear grupo', () =>
      makeGroup(this.model, this.geometry, this.selection, 'group', name)?.instanceId ?? null);
  }

  explode(instanceId: Id): boolean {
    return this.run('Explotar', () => explodeInstance(this.model, this.geometry, instanceId));
  }

  /** Identificadores de los grupos del contexto activo, en orden de creación. */
  instances(): Id[] {
    return [...this.geometry.instances.keys()];
  }

  /** Devuelve la instancia a su posición original (transformación identidad). */
  resetTransform(instanceId: Id): void {
    this.run('Colocar en el origen', () => {
      const inst = this.geometry.instances.get(instanceId);
      if (inst) inst.transform = IDENTITY;
    });
  }

  /** Volumen del sólido que hay dentro de un grupo. */
  groupVolume(instanceId: Id): number {
    const inst = this.geometry.instances.get(instanceId);
    if (!inst) return 0;
    const def = this.model.definitions.get(inst.definitionId);
    if (!def) return 0;
    return Math.abs(shellVolume(def.geometry, def.geometry.faces.keys()));
  }

  /** Catálogo de sólidos paramétricos disponibles. */
  get solids(): SolidDefinition[] {
    return SOLIDS;
  }

  /** Inserta un sólido: `api.solid('cylinder', { radius: 0.5, height: 2 })`. */
  solid(id: string, values: Record<string, number> = {}): boolean {
    const def = SOLIDS.find((s) => s.id === id);
    if (!def) return false;
    const full: Record<string, number> = {};
    for (const param of def.params) full[param.key] = values[param.key] ?? param.defaultValue;
    insertSolid(this.editor, def, full);
    return true;
  }

  // -------------------------------------------------------------------------
  // Ángulos y uniones
  // -------------------------------------------------------------------------

  /** Radianes → grados, para leer los resultados con comodidad. */
  degrees(radians: number): number {
    return toDegrees(radians);
  }

  /** Ángulo diedro de una arista, en grados. null si no tiene dos caras. */
  dihedral(edgeId: Id): number | null {
    const d = dihedralAngle(this.geometry, edgeId, (f) => this.editor.shellOf(f));
    return d ? toDegrees(d.angle) : null;
  }

  /** Diedro de todas las aristas del contexto, en grados. */
  dihedrals(): Array<{ edge: Id; angle: number }> {
    const out: Array<{ edge: Id; angle: number }> = [];
    for (const e of this.geometry.edges.keys()) {
      const d = dihedralAngle(this.geometry, e, (f) => this.editor.shellOf(f));
      if (d) out.push({ edge: e, angle: toDegrees(d.angle) });
    }
    return out;
  }

  /** Ángulo entre dos aristas, en grados. */
  angleBetweenEdges(a: Id, b: Id): number | null {
    const r = angleBetweenEdges(this.geometry, a, b);
    if (r) return toDegrees(r.angle);
    const d = edgeDirectionAngle(this.geometry, a, b);
    return d === null ? null : toDegrees(d);
  }

  /** Ángulo entre los planos de dos caras, en grados. */
  angleBetweenFaces(a: Id, b: Id): number | null {
    const fa = this.geometry.faces.get(a);
    const fb = this.geometry.faces.get(b);
    if (!fa || !fb) return null;
    return toDegrees(planeAngle(fa.plane, fb.plane));
  }

  /** Inglete y bisel, en grados, de un plano de corte sobre una pieza. */
  cutAngles(cutNormal: Vec3, axis: Vec3, faceNormal: Vec3) {
    const c = cutAngles(cutNormal, { axis, faceNormal });
    return {
      miter: toDegrees(c.miter),
      bevel: toDegrees(c.bevel),
      toAxis: toDegrees(c.toAxis),
      compound: c.compound,
    };
  }

  /** Medidas de la pieza que forma un grupo. */
  member(instanceId: Id): Member | null {
    return measureInstance(this.model, this.geometry, instanceId);
  }

  /** Medidas de la pieza que forman unas caras sueltas. */
  memberOfFaces(faces: Id[]): Member | null {
    return measureMember(this.geometry, faces);
  }

  /** Análisis de la unión entre dos grupos, con los ángulos en radianes. */
  joint(instanceA: Id, instanceB: Id): JointReport | null {
    const a = measureInstance(this.model, this.geometry, instanceA);
    const b = measureInstance(this.model, this.geometry, instanceB);
    return a && b ? analyseJoint(a, b) : null;
  }

  /** El mismo análisis en grados, cómodo para comprobar resultados. */
  jointAngles(instanceA: Id, instanceB: Id) {
    const j = this.joint(instanceA, instanceB);
    if (!j) return null;
    return {
      kind: j.kind,
      angle: toDegrees(j.angle),
      supplement: toDegrees(j.supplement),
      axisAngle: toDegrees(j.axisAngle),
      gap: j.gap,
      sameFacePlane: j.sameFacePlane,
      // null en la pieza que no se corta (la que pasa de largo en una te, y
      // las dos en un cruce).
      cuts: j.cuts.map((c) => (c === null ? null : {
        miter: toDegrees(Math.abs(c.miter)),
        bevel: toDegrees(Math.abs(c.bevel)),
        toAxis: toDegrees(c.toAxis),
        style: c.style,
      })),
    };
  }

  /** Texto de la unión, tal como lo lee el usuario en la barra de estado. */
  jointText(instanceA: Id, instanceB: Id): string | null {
    const j = this.joint(instanceA, instanceB);
    return j ? describeJoint(j, this.editor.units) : null;
  }

  /** Descripción de una pieza («2×4 · 2,40 m»). */
  memberText(instanceId: Id): string | null {
    const m = this.member(instanceId);
    return m ? describeMember(m, this.editor.units) : null;
  }

  /** Coloca una cota angular permanente. Devuelve null si el ángulo es nulo. */
  angleDimension(vertex: Vec3, a: Vec3, b: Vec3, radius = 0): Id | null {
    return this.run('Cota angular', () =>
      this.model.addAngleDimension(vertex, a, b, radius));
  }

  // -------------------------------------------------------------------------
  // Sólidos
  // -------------------------------------------------------------------------

  /** Une dos grupos en uno solo. Devuelve la instancia resultante. */
  union(instanceA: Id, instanceB: Id): SolidOpResult {
    return this.solidOp(instanceA, instanceB, 'union');
  }

  subtract(instanceA: Id, instanceB: Id): SolidOpResult {
    return this.solidOp(instanceA, instanceB, 'subtract');
  }

  intersectSolids(instanceA: Id, instanceB: Id): SolidOpResult {
    return this.solidOp(instanceA, instanceB, 'intersect');
  }

  private solidOp(a: Id, b: Id, op: BooleanOp): SolidOpResult {
    return this.run(BOOLEAN_LABEL[op], () => {
      const r = booleanInstances(this.model, this.geometry, a, b, op);
      clearSelection(this.selection);
      if (r.ok && r.instanceId !== null) this.selection.instances.add(r.instanceId);
      return r;
    });
  }

  /** Operación booleana entre dos conjuntos de caras del contexto activo. */
  booleanFaces(facesA: Id[], facesB: Id[], op: BooleanOp) {
    return this.run(BOOLEAN_LABEL[op], () =>
      booleanSolids(this.geometry, facesA, facesB, op));
  }

  /** Inserta las aristas donde se cortan dos conjuntos de caras. */
  intersectFaces(facesA: Id[], facesB: Id[]): number {
    return this.run('Intersecar caras', () => {
      const r = intersectFaceSets(this.geometry, facesA, facesB);
      if (r.edges.length > 0) {
        rebuildFaces(this.geometry, collectCandidatePlanes(this.geometry, r.edges), {
          newEdges: new Set(r.edges),
        });
      }
      return r.edges.length;
    });
  }

  // -------------------------------------------------------------------------
  // Consulta
  // -------------------------------------------------------------------------

  /** Caras del contexto activo, con su área y centro. */
  faces(): Array<{ id: Id; area: number; centre: Vec3 | null }> {
    return [...this.geometry.faces.keys()].map((id) => ({
      id,
      area: faceArea(this.geometry, id),
      centre: faceCentroid(this.geometry, id),
    }));
  }

  faceArea(id: Id): number {
    return faceArea(this.geometry, id);
  }

  /** Centro geométrico de una cara. */
  faceCentre(id: Id): Vec3 | null {
    return faceCentroid(this.geometry, id);
  }

  /** Áreas de todas las caras del contexto, de menor a mayor. */
  faceAreas(): number[] {
    return [...this.geometry.faces.keys()]
      .map((id) => faceArea(this.geometry, id))
      .sort((a, b) => a - b);
  }

  /** Cara cuyo centro está más cerca del punto dado. */
  faceNear(point: Vec3): Id | null {
    let best: Id | null = null;
    let bestD = Infinity;
    for (const id of this.geometry.faces.keys()) {
      const c = faceCentroid(this.geometry, id);
      if (!c) continue;
      const d = Math.hypot(c.x - point.x, c.y - point.y, c.z - point.z);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  /** Volumen del sólido que contiene la cara, o del modelo entero. */
  volume(faceId?: Id): number {
    const faces = faceId === undefined
      ? [...this.geometry.faces.keys()]
      : faceComponent(this.geometry, faceId);
    return Math.abs(shellVolume(this.geometry, faces));
  }

  isSolid(faceId?: Id): boolean {
    const faces = faceId === undefined
      ? [...this.geometry.faces.keys()]
      : faceComponent(this.geometry, faceId);
    return isSolid(this.geometry, faces);
  }

  /** Lista de problemas de la topología. Vacía si todo está bien. */
  validate(): string[] {
    const errs = [...this.geometry.validate()];
    const overlaps = findOverlappingEdges(this.geometry);
    if (overlaps.length > 0) errs.push(`aristas solapadas: ${overlaps.join(', ')}`);
    return errs;
  }

  stats() {
    return this.model.stats();
  }

  formatArea(m2: number): string {
    return formatArea(m2, this.editor.units);
  }

  formatVolume(m3: number): string {
    return formatVolume(m3, this.editor.units);
  }

  // -------------------------------------------------------------------------
  // Selección y vista
  // -------------------------------------------------------------------------

  selectAll(): void {
    selectAll(this.selection, this.geometry);
    this.editor.refreshModel();
  }

  clearSelection(): void {
    clearSelection(this.selection);
    this.editor.refreshModel();
  }

  select(targets: { faces?: Id[]; edges?: Id[]; instances?: Id[] }): void {
    clearSelection(this.selection);
    for (const f of targets.faces ?? []) this.selection.faces.add(f);
    for (const e of targets.edges ?? []) this.selection.edges.add(e);
    for (const i of targets.instances ?? []) this.selection.instances.add(i);
    this.editor.refreshModel();
  }

  view(name: StandardView): void {
    this.editor.viewport.cameraCtl.setStandardView(name);
    this.editor.viewport.invalidate();
  }

  zoomExtents(): void {
    this.editor.zoomExtents();
  }

  // -------------------------------------------------------------------------
  // Entrada y salida
  // -------------------------------------------------------------------------

  toJSON(indent = 0): string {
    return serializeToJSON(this.model, indent);
  }

  fromJSON(text: string): void {
    this.editor.replaceModel(deserializeModel(text));
    this.editor.zoomExtents();
  }

  /**
   * Interpreta un archivo sin cargarlo, para comprobar que un ciclo de
   * guardado y carga conserva el modelo.
   */
  parseJSON(text: string): Model {
    return deserializeModel(text);
  }

  exportOBJ(): { obj: string; mtl: string } {
    return exportOBJ(this.model);
  }

  exportSTL(binary = false): string | ArrayBuffer {
    return binary ? exportSTLBinary(this.model) : exportSTLAscii(this.model);
  }

  // -------------------------------------------------------------------------
  // Historial
  // -------------------------------------------------------------------------

  undo(): void {
    this.editor.undo();
  }

  redo(): void {
    this.editor.redo();
  }

  /** Fuerza la reconstrucción de la escena. */
  refresh(): void {
    this.editor.refreshModel();
  }

  /** Ejecuta `fn` como una operación deshacible y devuelve su resultado. */
  private run<T>(label: string, fn: () => T): T {
    return this.editor.edit(label, fn);
  }
}
