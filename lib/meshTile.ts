// The XYZ map tile (at zoom z) holding a point; matches the keys of /api/vexcel/3d-coverage.
export function tileKey(lat: number, lon: number, z: number): string {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return `${x},${y}`;
}
