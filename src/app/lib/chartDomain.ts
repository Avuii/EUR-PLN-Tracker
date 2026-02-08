type AnyRow = Record<string, unknown>;

const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function yDomainFromData(
  rows: AnyRow[],
  keys: string[],
  padFrac = 0.06,
  minSpan = 0.02
): [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const r of rows) {
    for (const k of keys) {
      const v = r[k];
      if (isFiniteNum(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];

  const span = Math.max(max - min, minSpan);
  const pad = span * padFrac;
  return [min - pad, max + pad];
}

export function yDomainSymmetricAroundZero(
  rows: AnyRow[],
  keys: string[],
  padFrac = 0.12,
  minHalfSpan = 0.02
): [number, number] {
  let maxAbs = 0;

  for (const r of rows) {
    for (const k of keys) {
      const v = r[k];
      if (isFiniteNum(v)) maxAbs = Math.max(maxAbs, Math.abs(v));
    }
  }

  maxAbs = Math.max(maxAbs, minHalfSpan);
  const pad = maxAbs * padFrac;
  const half = maxAbs + pad;
  return [-half, half];
}
