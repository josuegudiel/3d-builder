import { describe, it, expect } from 'vitest';
import { newGeometry, expectValid, closeTo } from './helpers';
import { Geometry } from '../src/core/model/geometry';
import { Id } from '../src/core/model/types';
import { Vec3, v3, normalize, rotateAround, add, mul, dot } from '../src/core/math/vec';
import { addPolygonFace } from '../src/core/ops/solids';
import { orientFacesConsistently, shellVolume, isSolid } from '../src/core/topology/orient';
import {
  toDegrees, toRadians, lineAngle, linePlaneAngle, planeAngle, dihedralAngle,
  angleBetweenEdges, edgeDirectionAngle, cutAngles, miterPlaneNormal, jointAngle,
  miterSetting, faceEdgeDirection, wrapTurn,
} from '../src/core/measure/angles';
import {
  measureMember, measureShape, analyseJoint, nominalSection, Member, membersTouch,
} from '../src/core/measure/member';
import { booleanSolids } from '../src/core/ops/boolean';
import { intersectFaceSets } from '../src/core/ops/intersect';
import { METERS_PER } from '../src/core/units';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Caja recta entre dos esquinas opuestas; devuelve sus seis caras. */
function box(geo: Geometry, min: Vec3, max: Vec3): Id[] {
  const { x: x0, y: y0, z: z0 } = min;
  const { x: x1, y: y1, z: z1 } = max;
  const quads: Vec3[][] = [
    [v3(x0, y0, z0), v3(x1, y0, z0), v3(x1, y1, z0), v3(x0, y1, z0)], // z0
    [v3(x0, y0, z1), v3(x1, y0, z1), v3(x1, y1, z1), v3(x0, y1, z1)], // z1
    [v3(x0, y0, z0), v3(x1, y0, z0), v3(x1, y0, z1), v3(x0, y0, z1)], // y0
    [v3(x0, y1, z0), v3(x1, y1, z0), v3(x1, y1, z1), v3(x0, y1, z1)], // y1
    [v3(x0, y0, z0), v3(x0, y1, z0), v3(x0, y1, z1), v3(x0, y0, z1)], // x0
    [v3(x1, y0, z0), v3(x1, y1, z0), v3(x1, y1, z1), v3(x1, y0, z1)], // x1
  ];
  const ids: Id[] = [];
  for (const q of quads) {
    const f = addPolygonFace(geo, q);
    if (f !== null) ids.push(f);
  }
  orientFacesConsistently(geo, ids);
  return ids;
}

/** Caja girada un ángulo alrededor de Z, para probar marcos no alineados. */
function rotatedBox(geo: Geometry, min: Vec3, max: Vec3, angle: number, pivot: Vec3): Id[] {
  const r = (p: Vec3) => add(pivot, rotateAround(v3(p.x - pivot.x, p.y - pivot.y, p.z - pivot.z), v3(0, 0, 1), angle));
  const { x: x0, y: y0, z: z0 } = min;
  const { x: x1, y: y1, z: z1 } = max;
  const quads: Vec3[][] = [
    [v3(x0, y0, z0), v3(x1, y0, z0), v3(x1, y1, z0), v3(x0, y1, z0)],
    [v3(x0, y0, z1), v3(x1, y0, z1), v3(x1, y1, z1), v3(x0, y1, z1)],
    [v3(x0, y0, z0), v3(x1, y0, z0), v3(x1, y0, z1), v3(x0, y0, z1)],
    [v3(x0, y1, z0), v3(x1, y1, z0), v3(x1, y1, z1), v3(x0, y1, z1)],
    [v3(x0, y0, z0), v3(x0, y1, z0), v3(x0, y1, z1), v3(x0, y0, z1)],
    [v3(x1, y0, z0), v3(x1, y1, z0), v3(x1, y1, z1), v3(x1, y0, z1)],
  ];
  const ids: Id[] = [];
  for (const q of quads) {
    const f = addPolygonFace(geo, q.map(r));
    if (f !== null) ids.push(f);
  }
  orientFacesConsistently(geo, ids);
  return ids;
}

const DEG = (r: number) => toDegrees(r);

/** Pieza sintética, para comprobar la matemática de uniones sin geometría. */
function member(axis: Vec3, faceNormal: Vec3, centre: Vec3, length: number): Member {
  const a = normalize(axis);
  const n = normalize(faceNormal);
  return {
    faces: [],
    centre,
    axis: a,
    widthDir: normalize(v3(
      n.y * a.z - n.z * a.y, n.z * a.x - n.x * a.z, n.x * a.y - n.y * a.x,
    )),
    faceNormal: n,
    length,
    width: 0.09,
    thickness: 0.04,
    ends: [
      add(centre, mul(a, -length / 2)),
      add(centre, mul(a, length / 2)),
    ],
    boxVolume: length * 0.09 * 0.04,
  };
}

// ---------------------------------------------------------------------------
// Ángulos elementales
// ---------------------------------------------------------------------------

describe('ángulos entre direcciones', () => {
  it('convierte grados y radianes de ida y vuelta', () => {
    closeTo(DEG(toRadians(37.5)), 37.5, 1e-12);
    closeTo(toRadians(DEG(1.234)), 1.234, 1e-15);
  });

  it('el ángulo entre rectas es siempre agudo', () => {
    closeTo(DEG(lineAngle(v3(1, 0, 0), v3(0, 1, 0))), 90);
    closeTo(DEG(lineAngle(v3(1, 0, 0), v3(-1, 0, 0))), 0);
    closeTo(DEG(lineAngle(v3(1, 0, 0), v3(1, 1, 0))), 45);
    // 170° entre vectores son 10° entre rectas.
    closeTo(DEG(lineAngle(v3(1, 0, 0), rotateAround(v3(1, 0, 0), v3(0, 0, 1), toRadians(170)))), 10, 1e-9);
  });

  it('el ángulo recta-plano es el complementario del de la normal', () => {
    closeTo(DEG(linePlaneAngle(v3(0, 0, 1), v3(0, 0, 1))), 90);
    closeTo(DEG(linePlaneAngle(v3(1, 0, 0), v3(0, 0, 1))), 0);
    closeTo(DEG(linePlaneAngle(v3(1, 0, 1), v3(0, 0, 1))), 45);
  });

  it('el ángulo entre planos usa sus normales', () => {
    closeTo(DEG(planeAngle({ n: v3(0, 0, 1), d: 0 }, { n: v3(0, 1, 0), d: 3 })), 90);
    closeTo(DEG(planeAngle({ n: v3(0, 0, 1), d: 0 }, { n: v3(0, 0, -1), d: 5 })), 0);
  });

  it('wrapTurn deja el ángulo en (0, 2π]', () => {
    closeTo(wrapTurn(0), Math.PI * 2);
    closeTo(wrapTurn(-Math.PI / 2), (3 * Math.PI) / 2);
    closeTo(wrapTurn(Math.PI * 3), Math.PI);
  });
});

// ---------------------------------------------------------------------------
// Diedros
// ---------------------------------------------------------------------------

describe('ángulo diedro', () => {
  it('mide 90° en los cantos de una caja', () => {
    const geo = newGeometry();
    box(geo, v3(0, 0, 0), v3(1, 1, 1));
    expectValid(geo);

    let checked = 0;
    for (const e of geo.edges.keys()) {
      const d = dihedralAngle(geo, e);
      expect(d).not.toBeNull();
      expect(d!.consistent).toBe(true);
      closeTo(DEG(d!.angle), 90, 1e-9);
      checked++;
    }
    expect(checked).toBe(12);
  });

  it('mide 270° en un rincón entrante', () => {
    // Ele formada por dos cajas que comparten una cara.
    const geo = newGeometry();
    const a = box(geo, v3(0, 0, 0), v3(2, 1, 1));
    const b = box(geo, v3(0, 1, 0), v3(1, 2, 1));
    const r = booleanSolids(geo, a, b, 'union');
    expect(r.ok).toBe(true);
    expect(r.solid).toBe(true);
    expectValid(geo);

    // La arista vertical del rincón entrante está en (1, 1).
    let found = 0;
    for (const e of geo.edges.keys()) {
      const [p, q] = geo.edgeEndpoints(e);
      const vertical = Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;
      if (!vertical) continue;
      if (Math.abs(p.x - 1) > 1e-9 || Math.abs(p.y - 1) > 1e-9) continue;
      const d = dihedralAngle(geo, e);
      expect(d).not.toBeNull();
      closeTo(DEG(d!.angle), 270, 1e-6);
      found++;
    }
    expect(found).toBe(1);
  });

  it('mide 180° entre dos caras que continúan en el mismo plano', () => {
    const geo = newGeometry();
    // Dos rectángulos contiguos en Z=0 con una arista común.
    addPolygonFace(geo, [v3(0, 0, 0), v3(1, 0, 0), v3(1, 1, 0), v3(0, 1, 0)]);
    addPolygonFace(geo, [v3(1, 0, 0), v3(2, 0, 0), v3(2, 1, 0), v3(1, 1, 0)]);
    const shared = geo.findEdge(
      geo.findVertexAt(v3(1, 0, 0))!,
      geo.findVertexAt(v3(1, 1, 0))!,
    );
    expect(shared).not.toBeNull();
    const d = dihedralAngle(geo, shared!);
    expect(d).not.toBeNull();
    closeTo(DEG(d!.angle), 180, 1e-9);
  });

  it('devuelve null si la arista no tiene exactamente dos caras', () => {
    const geo = newGeometry();
    addPolygonFace(geo, [v3(0, 0, 0), v3(1, 0, 0), v3(1, 1, 0), v3(0, 1, 0)]);
    const e = [...geo.edges.keys()][0];
    expect(dihedralAngle(geo, e)).toBeNull();
  });

  it('el sentido de recorrido de una cara sobre su arista es coherente', () => {
    const geo = newGeometry();
    const faces = box(geo, v3(0, 0, 0), v3(1, 1, 1));
    for (const f of faces) {
      for (const e of geo.faceEdges(f)) {
        const d = faceEdgeDirection(geo, f, e);
        expect(d).not.toBeNull();
        const [p, q] = geo.edgeEndpoints(e);
        const along = normalize(v3(q.x - p.x, q.y - p.y, q.z - p.z));
        closeTo(Math.abs(dot(d!, along)), 1, 1e-9);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Ángulos entre aristas
// ---------------------------------------------------------------------------

describe('ángulos entre aristas', () => {
  it('mide el ángulo en el vértice común', () => {
    const geo = newGeometry();
    addPolygonFace(geo, [v3(0, 0, 0), v3(1, 0, 0), v3(1, 1, 0), v3(0, 1, 0)]);
    const v0 = geo.findVertexAt(v3(0, 0, 0))!;
    const vx = geo.findVertexAt(v3(1, 0, 0))!;
    const vy = geo.findVertexAt(v3(0, 1, 0))!;
    const r = angleBetweenEdges(geo, geo.findEdge(v0, vx)!, geo.findEdge(v0, vy)!);
    expect(r).not.toBeNull();
    expect(r!.vertex).toBe(v0);
    closeTo(DEG(r!.angle), 90, 1e-9);
  });

  it('devuelve null si las aristas no se tocan', () => {
    const geo = newGeometry();
    addPolygonFace(geo, [v3(0, 0, 0), v3(1, 0, 0), v3(1, 1, 0), v3(0, 1, 0)]);
    const v0 = geo.findVertexAt(v3(0, 0, 0))!;
    const vx = geo.findVertexAt(v3(1, 0, 0))!;
    const v1 = geo.findVertexAt(v3(1, 1, 0))!;
    const vy = geo.findVertexAt(v3(0, 1, 0))!;
    expect(angleBetweenEdges(geo, geo.findEdge(v0, vx)!, geo.findEdge(v1, vy)!)).toBeNull();
  });

  it('mide el ángulo de dos aristas cualesquiera por su dirección', () => {
    const geo = newGeometry();
    addPolygonFace(geo, [v3(0, 0, 0), v3(1, 0, 0), v3(1, 1, 0), v3(0, 1, 0)]);
    const v0 = geo.findVertexAt(v3(0, 0, 0))!;
    const vx = geo.findVertexAt(v3(1, 0, 0))!;
    const v1 = geo.findVertexAt(v3(1, 1, 0))!;
    const vy = geo.findVertexAt(v3(0, 1, 0))!;
    const ang = edgeDirectionAngle(geo, geo.findEdge(v0, vx)!, geo.findEdge(v1, vy)!);
    expect(ang).not.toBeNull();
    closeTo(DEG(ang!), 0, 1e-9); // son paralelas
  });
});

// ---------------------------------------------------------------------------
// Inglete y bisel
// ---------------------------------------------------------------------------

describe('descomposición de un corte en inglete y bisel', () => {
  const frame = { axis: v3(1, 0, 0), faceNormal: v3(0, 0, 1) };

  it('un corte perpendicular al eje es un corte a escuadra', () => {
    const c = cutAngles(v3(1, 0, 0), frame);
    closeTo(DEG(c.miter), 0);
    closeTo(DEG(c.bevel), 0);
    closeTo(DEG(c.toAxis), 90);
    expect(c.compound).toBe(false);
  });

  it('el sentido del plano de corte no cambia el resultado', () => {
    const a = cutAngles(v3(1, 1, 0), frame);
    const b = cutAngles(v3(-1, -1, 0), frame);
    closeTo(a.miter, b.miter, 1e-12);
    closeTo(a.bevel, b.bevel, 1e-12);
  });

  it('un giro sobre la cara es inglete puro', () => {
    const c = cutAngles(normalize(v3(1, 1, 0)), frame);
    closeTo(Math.abs(DEG(c.miter)), 45, 1e-9);
    closeTo(DEG(c.bevel), 0, 1e-12);
    closeTo(DEG(c.toAxis), 45, 1e-9);
    expect(c.compound).toBe(false);
  });

  it('una inclinación de la hoja es bisel puro', () => {
    const c = cutAngles(normalize(v3(1, 0, -1)), frame);
    closeTo(DEG(c.miter), 0, 1e-12);
    closeTo(Math.abs(DEG(c.bevel)), 45, 1e-9);
    expect(c.compound).toBe(false);
  });

  it('reconstruye cualquier pareja de ajustes', () => {
    // Se genera el plano a partir de unos ajustes conocidos y se comprueba que
    // la descomposición devuelve los mismos.
    for (const miterDeg of [0, 12.5, 30, 45, 67.5]) {
      for (const bevelDeg of [0, 7, 22.5, 40]) {
        const mu = toRadians(miterDeg);
        const be = toRadians(bevelDeg);
        // m = R_z(mu) · R_y(be) · x
        const afterBevel = v3(Math.cos(be), 0, -Math.sin(be));
        const m = rotateAround(afterBevel, v3(0, 0, 1), mu);
        const c = cutAngles(m, frame);
        closeTo(Math.abs(DEG(c.miter)), miterDeg, 1e-8);
        closeTo(Math.abs(DEG(c.bevel)), bevelDeg, 1e-8);
      }
    }
  });

  it('un corte compuesto se reconoce como tal', () => {
    const m = rotateAround(v3(Math.cos(0.4), 0, -Math.sin(0.4)), v3(0, 0, 1), 0.6);
    expect(cutAngles(m, frame).compound).toBe(true);
  });
});

describe('plano de inglete de una unión', () => {
  it('una esquina en escuadra se corta a 45°', () => {
    const m = miterPlaneNormal(v3(1, 0, 0), v3(0, 1, 0));
    expect(m).not.toBeNull();
    const c = cutAngles(m!, { axis: v3(1, 0, 0), faceNormal: v3(0, 0, 1) });
    closeTo(Math.abs(DEG(c.miter)), 45, 1e-9);
    closeTo(DEG(c.bevel), 0, 1e-12);
  });

  it('dos piezas alineadas se cortan a escuadra', () => {
    const m = miterPlaneNormal(v3(1, 0, 0), v3(-1, 0, 0));
    expect(m).not.toBeNull();
    const c = cutAngles(m!, { axis: v3(1, 0, 0), faceNormal: v3(0, 0, 1) });
    closeTo(DEG(c.miter), 0, 1e-12);
    closeTo(DEG(c.toAxis), 90, 1e-12);
  });

  it('no hay plano de inglete si las dos direcciones coinciden', () => {
    expect(miterPlaneNormal(v3(1, 0, 0), v3(1, 0, 0))).toBeNull();
  });

  it('el ajuste de la sierra es 90° − γ/2 para cualquier ángulo', () => {
    for (const gammaDeg of [20, 45, 60, 90, 120, 150, 179]) {
      const gamma = toRadians(gammaDeg);
      const u = v3(1, 0, 0);
      const v = rotateAround(u, v3(0, 0, 1), gamma);
      closeTo(jointAngle(u, v), gamma, 1e-12);
      const m = miterPlaneNormal(u, v)!;
      const c = cutAngles(m, { axis: u, faceNormal: v3(0, 0, 1) });
      closeTo(Math.abs(DEG(c.miter)), DEG(miterSetting(gamma)), 1e-8);
      closeTo(Math.abs(DEG(c.miter)), 90 - gammaDeg / 2, 1e-8);
    }
  });

  it('las dos piezas de una unión reciben el mismo inglete', () => {
    for (const gammaDeg of [30, 72, 90, 135]) {
      const gamma = toRadians(gammaDeg);
      const u = v3(1, 0, 0);
      const v = rotateAround(u, v3(0, 0, 1), gamma);
      const m = miterPlaneNormal(u, v)!;
      const ca = cutAngles(m, { axis: u, faceNormal: v3(0, 0, 1) });
      const cb = cutAngles(m, { axis: v, faceNormal: v3(0, 0, 1) });
      closeTo(Math.abs(DEG(ca.miter)), Math.abs(DEG(cb.miter)), 1e-9);
    }
  });

  it('con las caras en planos distintos el corte sale compuesto', () => {
    // Una pieza horizontal y otra inclinada 30°: hace falta inglete y bisel.
    const u = v3(1, 0, 0);
    const v = normalize(v3(-Math.cos(toRadians(40)), Math.sin(toRadians(40)), 0.6));
    const m = miterPlaneNormal(u, v)!;
    const c = cutAngles(m, { axis: u, faceNormal: v3(0, 0, 1) });
    expect(Math.abs(DEG(c.miter))).toBeGreaterThan(1);
    expect(Math.abs(DEG(c.bevel))).toBeGreaterThan(1);
    expect(c.compound).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

describe('reconocimiento de piezas', () => {
  it('mide el eje, el ancho y el grueso de una tabla', () => {
    const geo = newGeometry();
    const faces = box(geo, v3(0, 0, 0), v3(2.4, 0.089, 0.038));
    const m = measureMember(geo, faces);
    expect(m).not.toBeNull();
    closeTo(m!.length, 2.4, 1e-9);
    closeTo(m!.width, 0.089, 1e-9);
    closeTo(m!.thickness, 0.038, 1e-9);
    closeTo(Math.abs(m!.axis.x), 1, 1e-9);
    closeTo(Math.abs(m!.faceNormal.z), 1, 1e-9);
    closeTo(m!.centre.x, 1.2, 1e-9);
  });

  it('encuentra el marco de una pieza girada', () => {
    const geo = newGeometry();
    const ang = toRadians(37);
    const faces = rotatedBox(geo, v3(0, 0, 0), v3(3, 0.1, 0.05), ang, v3(0, 0, 0));
    const m = measureMember(geo, faces);
    expect(m).not.toBeNull();
    closeTo(m!.length, 3, 1e-9);
    closeTo(m!.width, 0.1, 1e-9);
    closeTo(m!.thickness, 0.05, 1e-9);
    // El eje debe seguir la rotación.
    closeTo(DEG(lineAngle(m!.axis, v3(Math.cos(ang), Math.sin(ang), 0))), 0, 1e-7);
  });

  it('las testas están en los extremos del eje', () => {
    const geo = newGeometry();
    const faces = box(geo, v3(0, 0, 0), v3(2, 0.1, 0.05));
    const m = measureMember(geo, faces)!;
    const xs = [m.ends[0].x, m.ends[1].x].sort((a, b) => a - b);
    closeTo(xs[0], 0, 1e-9);
    closeTo(xs[1], 2, 1e-9);
  });

  it('reconoce las escuadrías comerciales', () => {
    expect(nominalSection(1.5 * METERS_PER.in, 3.5 * METERS_PER.in)).toBe('2×4');
    expect(nominalSection(3.5 * METERS_PER.in, 3.5 * METERS_PER.in)).toBe('4×4');
    expect(nominalSection(1.5 * METERS_PER.in, 5.5 * METERS_PER.in)).toBe('2×6');
    expect(nominalSection(0.038, 0.089)).toBe('2×4'); // en métrico, misma tabla
    expect(nominalSection(0.02, 0.2)).toBeNull();
  });

  it('mide una nube de puntos sin caras', () => {
    const m = measureShape({
      points: [v3(0, 0, 0), v3(1, 0, 0), v3(1, 0.2, 0), v3(0, 0.2, 0), v3(0, 0, 0.1), v3(1, 0.2, 0.1)],
      normals: [],
    });
    expect(m).not.toBeNull();
    closeTo(m!.length, 1, 1e-9);
    closeTo(m!.width, 0.2, 1e-9);
    closeTo(m!.thickness, 0.1, 1e-9);
  });
});

// ---------------------------------------------------------------------------
// Uniones
// ---------------------------------------------------------------------------

describe('análisis de uniones', () => {
  it('una esquina en escuadra da 90° y dos ingletes de 45°', () => {
    const a = member(v3(1, 0, 0), v3(0, 0, 1), v3(1, 0, 0), 2);
    const b = member(v3(0, 1, 0), v3(0, 0, 1), v3(0, 1, 0), 2);
    const j = analyseJoint(a, b);
    expect(j.kind).toBe('esquina');
    closeTo(DEG(j.angle), 90, 1e-9);
    closeTo(DEG(j.supplement), 90, 1e-9);
    closeTo(Math.abs(DEG(j.cuts[0].miter)), 45, 1e-9);
    closeTo(Math.abs(DEG(j.cuts[1].miter)), 45, 1e-9);
    closeTo(DEG(j.cuts[0].bevel), 0, 1e-9);
    expect(j.sameFacePlane).toBe(true);
    closeTo(j.gap, 0, 1e-9);
  });

  it('una esquina de 30° pide un inglete de 75°', () => {
    const dir = rotateAround(v3(1, 0, 0), v3(0, 0, 1), toRadians(30));
    const a = member(v3(1, 0, 0), v3(0, 0, 1), v3(1, 0, 0), 2);
    const b = member(dir, v3(0, 0, 1), mul(dir, 1), 2);
    const j = analyseJoint(a, b);
    closeTo(DEG(j.angle), 30, 1e-7);
    closeTo(Math.abs(DEG(j.cuts[0].miter)), 75, 1e-7);
    closeTo(Math.abs(DEG(j.cuts[1].miter)), 75, 1e-7);
  });

  it('reconoce una unión en te', () => {
    // La pieza B llega al centro de la A.
    const a = member(v3(1, 0, 0), v3(0, 0, 1), v3(0, 0, 0), 4);
    const b = member(v3(0, 1, 0), v3(0, 0, 1), v3(0, 1, 0), 2);
    const j = analyseJoint(a, b);
    expect(j.kind).toBe('te');
    closeTo(DEG(j.angle), 90, 1e-9);
    expect(j.cuts[0].end).toBeNull();
    expect(j.cuts[1].end).not.toBeNull();
  });

  it('reconoce un cruce', () => {
    const a = member(v3(1, 0, 0), v3(0, 0, 1), v3(0, 0, 0), 4);
    const b = member(v3(0, 1, 0), v3(0, 0, 1), v3(0, 0, 0), 4);
    const j = analyseJoint(a, b);
    expect(j.kind).toBe('cruce');
    closeTo(DEG(j.axisAngle), 90, 1e-9);
  });

  it('reconoce una prolongación', () => {
    const a = member(v3(1, 0, 0), v3(0, 0, 1), v3(-1, 0, 0), 2);
    const b = member(v3(1, 0, 0), v3(0, 0, 1), v3(1, 0, 0), 2);
    const j = analyseJoint(a, b);
    expect(j.parallel).toBe(true);
    expect(j.kind).toBe('prolongación');
    closeTo(DEG(j.angle), 180, 1e-9);
    closeTo(DEG(j.cuts[0].miter), 0, 1e-9);
  });

  it('detecta el bisel cuando las caras no están en el mismo plano', () => {
    const a = member(v3(1, 0, 0), v3(0, 0, 1), v3(1, 0, 0), 2);
    const b = member(normalize(v3(0, 1, 1)), normalize(v3(0, -1, 1)), mul(normalize(v3(0, 1, 1)), 1), 2);
    const j = analyseJoint(a, b);
    expect(j.sameFacePlane).toBe(false);
    expect(Math.abs(DEG(j.cuts[0].bevel))).toBeGreaterThan(0.5);
  });

  it('mide la separación entre piezas que no llegan a tocarse', () => {
    const a = member(v3(1, 0, 0), v3(0, 0, 1), v3(-1, 0, 0), 2);
    const b = member(v3(0, 1, 0), v3(0, 0, 1), v3(0.5, 1, 0), 2);
    const j = analyseJoint(a, b);
    closeTo(j.gap, 0.5, 1e-9);
    expect(membersTouch(a, b)).toBe(false);
  });

  it('mide sobre geometría real dos tablas en escuadra', () => {
    const geo = newGeometry();
    const fa = box(geo, v3(0, 0, 0), v3(2, 0.09, 0.04));
    const fb = box(geo, v3(0, 0, 0), v3(0.09, 2, 0.04));
    const a = measureMember(geo, fa)!;
    const b = measureMember(geo, fb)!;
    const j = analyseJoint(a, b);
    expect(j.kind).toBe('esquina');
    closeTo(DEG(j.angle), 90, 1e-6);
    closeTo(Math.abs(DEG(j.cuts[0].miter)), 45, 1e-6);
    closeTo(Math.abs(DEG(j.cuts[1].miter)), 45, 1e-6);
  });
});

// ---------------------------------------------------------------------------
// Intersección y booleanas
// ---------------------------------------------------------------------------

describe('intersección de caras', () => {
  it('crea las aristas donde dos piezas se cruzan', () => {
    const geo = newGeometry();
    const a = box(geo, v3(0, 0, 0), v3(4, 1, 1));
    const b = box(geo, v3(1, -2, 0), v3(2, 3, 1));
    const before = geo.edges.size;
    const r = intersectFaceSets(geo, a, b);
    expect(r.segments).toBeGreaterThan(0);
    expect(geo.edges.size).toBeGreaterThan(before);
    expectValid(geo);
  });

  it('no inventa aristas si las piezas están separadas', () => {
    const geo = newGeometry();
    const a = box(geo, v3(0, 0, 0), v3(1, 1, 1));
    const b = box(geo, v3(3, 3, 3), v3(4, 4, 4));
    const before = geo.edges.size;
    const r = intersectFaceSets(geo, a, b);
    expect(r.segments).toBe(0);
    expect(geo.edges.size).toBe(before);
  });
});

describe('operaciones booleanas', () => {
  it('une dos piezas que se cruzan con el volumen correcto', () => {
    const geo = newGeometry();
    const a = box(geo, v3(0, 0, 0), v3(4, 1, 1));
    const b = box(geo, v3(1, -2, 0), v3(2, 3, 1));
    const r = booleanSolids(geo, a, b, 'union');
    expect(r.ok).toBe(true);
    expect(r.solid).toBe(true);
    expectValid(geo);
    // 4 + 5 − 1 = 8
    closeTo(Math.abs(shellVolume(geo, r.faces)), 8, 1e-9);
  });

  it('une dos piezas que se tocan por una cara', () => {
    const geo = newGeometry();
    const a = box(geo, v3(0, 0, 0), v3(1, 1, 1));
    const b = box(geo, v3(1, 0, 0), v3(2, 1, 1));
    const r = booleanSolids(geo, a, b, 'union');
    expect(r.ok).toBe(true);
    expect(r.solid).toBe(true);
    expectValid(geo);
    closeTo(Math.abs(shellVolume(geo, r.faces)), 2, 1e-9);
    // La cara común desaparece: queda una caja de seis caras.
    expect(r.faces.length).toBe(6);
  });

  it('une dos piezas que sólo se tocan parcialmente por una cara', () => {
    const geo = newGeometry();
    const a = box(geo, v3(0, 0, 0), v3(2, 2, 1));
    const b = box(geo, v3(0.5, 2, 0), v3(1.5, 3, 1));
    const r = booleanSolids(geo, a, b, 'union');
    expect(r.ok).toBe(true);
    expect(r.solid).toBe(true);
    expectValid(geo);
    closeTo(Math.abs(shellVolume(geo, r.faces)), 4 + 1, 1e-9);
  });

  it('resta una pieza de otra', () => {
    const geo = newGeometry();
    const a = box(geo, v3(0, 0, 0), v3(2, 2, 2));
    const b = box(geo, v3(0.5, 0.5, 0.5), v3(1.5, 1.5, 3));
    const r = booleanSolids(geo, a, b, 'subtract');
    expect(r.ok).toBe(true);
    expectValid(geo);
    closeTo(Math.abs(shellVolume(geo, r.faces)), 8 - 1 * 1 * 1.5, 1e-9);
  });

  it('interseca dos piezas', () => {
    const geo = newGeometry();
    const a = box(geo, v3(0, 0, 0), v3(2, 2, 2));
    const b = box(geo, v3(1, 1, 1), v3(3, 3, 3));
    const r = booleanSolids(geo, a, b, 'intersect');
    expect(r.ok).toBe(true);
    expect(r.solid).toBe(true);
    expectValid(geo);
    closeTo(Math.abs(shellVolume(geo, r.faces)), 1, 1e-9);
  });

  it('la unión de piezas separadas conserva las dos', () => {
    const geo = newGeometry();
    const a = box(geo, v3(0, 0, 0), v3(1, 1, 1));
    const b = box(geo, v3(3, 3, 3), v3(4, 4, 4));
    const r = booleanSolids(geo, a, b, 'union');
    expect(r.ok).toBe(true);
    closeTo(Math.abs(shellVolume(geo, r.faces)), 2, 1e-9);
    expect(r.faces.length).toBe(12);
  });

  it('la intersección de piezas separadas queda vacía', () => {
    const geo = newGeometry();
    const a = box(geo, v3(0, 0, 0), v3(1, 1, 1));
    const b = box(geo, v3(3, 3, 3), v3(4, 4, 4));
    const r = booleanSolids(geo, a, b, 'intersect');
    expect(r.faces.length).toBe(0);
    expect(geo.faces.size).toBe(0);
  });

  it('rechaza una entrada que no es un sólido cerrado', () => {
    const geo = newGeometry();
    const open = addPolygonFace(geo, [v3(0, 0, 0), v3(1, 0, 0), v3(1, 1, 0), v3(0, 1, 0)])!;
    const b = box(geo, v3(0, 0, -1), v3(1, 1, 1));
    const r = booleanSolids(geo, [open], b, 'union');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('sólido cerrado');
  });

  it('las normales del resultado apuntan hacia fuera', () => {
    const geo = newGeometry();
    const a = box(geo, v3(0, 0, 0), v3(4, 1, 1));
    const b = box(geo, v3(1, -2, 0), v3(2, 3, 1));
    const r = booleanSolids(geo, a, b, 'union');
    expect(shellVolume(geo, r.faces)).toBeGreaterThan(0);
    expect(isSolid(geo, r.faces)).toBe(true);
  });

  it('une dos tablas en escuadra y mantiene el volumen', () => {
    const geo = newGeometry();
    const a = box(geo, v3(0, 0, 0), v3(2, 0.09, 0.04));
    const b = box(geo, v3(0, 0, 0), v3(0.09, 2, 0.04));
    const r = booleanSolids(geo, a, b, 'union');
    expect(r.ok).toBe(true);
    expect(r.solid).toBe(true);
    expectValid(geo);
    const solapa = 0.09 * 0.09 * 0.04;
    closeTo(
      Math.abs(shellVolume(geo, r.faces)),
      2 * 0.09 * 0.04 + 0.09 * 2 * 0.04 - solapa,
      1e-12,
    );
  });
});
