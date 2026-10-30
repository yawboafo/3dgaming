// Navmesh source and traffic routes for town:gen, split out of genTown.mjs.
import { CatmullRomCurve3, Vector3 } from 'three';

const round = (v) => Math.round(v * 100) / 100;

/**
 * Pedestrian navmesh source: a walkable bitmap on a 2 m grid. Sidewalk bands run alongside every
 * road; crossroad tiles are crossings; anything with a collider (lights, crates, houses) is cut
 * out. The server triangulates it and bakes a three-pathfinding zone at startup.
 */
export function bakeNavGrid({ roadCentres, tile, worldSize, solids }) {
  const NAV_CELL = 2;
  const NAV_N = worldSize / NAV_CELL;
  const BAND = 2.2; // sidewalk band width beyond the road edge
  const blocked = (x, z) =>
    solids.some((c) => {
      const swap = Math.round((c.rotY ?? 0) / 90) % 2 !== 0;
      const hx = (swap ? c.half[2] : c.half[0]) + 0.5;
      const hz = (swap ? c.half[0] : c.half[2]) + 0.5;
      return Math.abs(x - c.pos[0]) < hx && Math.abs(z - c.pos[2]) < hz;
    });
  const nearRoad = (v) => roadCentres.map((c) => Math.abs(v - c)).reduce((a, b) => Math.min(a, b));
  const walkable = (x, z) => {
    const dx = nearRoad(x);
    const dz = nearRoad(z);
    const onBand =
      (dx > tile / 2 && dx <= tile / 2 + BAND) || (dz > tile / 2 && dz <= tile / 2 + BAND);
    const crossing = dx <= tile / 2 && dz <= tile / 2;
    return (onBand || crossing) && !blocked(x, z);
  };
  const bits = new Uint8Array(Math.ceil((NAV_N * NAV_N) / 8));
  let cells = 0;
  for (let j = 0; j < NAV_N; j++)
    for (let i = 0; i < NAV_N; i++)
      if (walkable((i + 0.5) * NAV_CELL, (j + 0.5) * NAV_CELL)) {
        bits[(j * NAV_N + i) >> 3] |= 1 << ((j * NAV_N + i) & 7);
        cells++;
      }
  return {
    navGrid: { cell: NAV_CELL, size: NAV_N, bits: Buffer.from(bits).toString('base64') },
    cells,
  };
}

/**
 * Traffic: closed loops around blocks, in the right-hand lane (Ghana drives on the right), with
 * corners rounded by a centripetal Catmull-Rom spline, sampled into waypoints. The street outside
 * the spawn has parked vehicles across both lanes, so no loop uses it.
 */
export function trafficLoops(roadCentres) {
  const LANE = 2;
  const ci = Math.floor(roadCentres.length / 2);
  const L = (k) => roadCentres[ci + k];
  const loopBlocks = [
    [L(-1), L(0), L(-2), L(-1)], // north-west of the spawn: x0, x1, z0, z1
    [L(0), L(1), L(-2), L(-1)], // north-east (shares an edge, driven the other way)
    [L(0), L(1), L(1), L(2)], // south-east
  ];
  return loopBlocks.map(([x0, x1, z0, z1]) => {
    const corners = [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ]; // clockwise seen from above (+X right, +Z down)
    const pts = [];
    corners.forEach((c, k) => {
      const prev = corners[(k + 3) % 4];
      const next = corners[(k + 1) % 4];
      const din = norm([c[0] - prev[0], c[1] - prev[1]]);
      const dout = norm([next[0] - c[0], next[1] - c[1]]);
      const rin = [-din[1], din[0]]; // right of travel
      const rout = [-dout[1], dout[0]];
      const R = 6; // start the turn this far before the junction
      pts.push(
        new Vector3(c[0] - din[0] * R + rin[0] * LANE, 0, c[1] - din[1] * R + rin[1] * LANE),
      );
      pts.push(new Vector3(c[0] + (rin[0] + rout[0]) * LANE, 0, c[1] + (rin[1] + rout[1]) * LANE));
      pts.push(
        new Vector3(c[0] + dout[0] * R + rout[0] * LANE, 0, c[1] + dout[1] * R + rout[1] * LANE),
      );
    });
    const curve = new CatmullRomCurve3(pts, true, 'centripetal');
    const n = Math.round(curve.getLength() / 3);
    return {
      loop: true,
      points: curve
        .getSpacedPoints(n)
        .slice(0, n)
        .map((p) => [round(p.x), 0, round(p.z)]),
    };
  });
}

function norm([x, z]) {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
}
