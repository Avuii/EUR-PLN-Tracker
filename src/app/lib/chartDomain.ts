// src/lib/chartDomain.ts
export type Domain = [number, number];

/**
 * Auto-domain dla osi Y na podstawie wielu serii.
 * - liczy min/max ze wszystkich serii
 * - dodaje padding procentowy + minimalny padding absolutny
 * - zwraca [min, max] do <YAxis domain={...}/>
 */
export function yDomainFromData<T extends Record<string, any>>(
  data: T[],
  keys: string[],
  padPct: number = 0.06,
  minAbsPad: number = 0.01
): Domain {
  if (!data || data.length === 0) return [0, 1];

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const row of data) {
    for (const k of keys) {
      const v = row?.[k];
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) continue;
      if (n < min) min = n;
      if (n > max) max = n;
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];

  const span = Math.max(max - min, 0);
  const pad = Math.max(span * padPct, minAbsPad);

  // jeśli linia jest prawie płaska, zapewnij minimalny sensowny zakres
  const lo = min - pad;
  const hi = max + pad;

  // unikaj sytuacji lo==hi
  if (Math.abs(hi - lo) < 1e-12) return [lo - 1, hi + 1];

  return [lo, hi];
}

/**
 * Auto-domain symetryczny dla reszt (center=0).
 * - bierze max(|min|,|max|) i dodaje padding
 */
export function yDomainSymmetric<T extends Record<string, any>>(
  data: T[],
  keys: string[],
  padPct: number = 0.08,
  minAbsPad: number = 0.01
): Domain {
  if (!data || data.length === 0) return [-1, 1];

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const row of data) {
    for (const k of keys) {
      const v = row?.[k];
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) continue;
      if (n < min) min = n;
      if (n > max) max = n;
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return [-1, 1];

  const m = Math.max(Math.abs(min), Math.abs(max));
  const pad = Math.max(m * padPct, minAbsPad);
  const r = m + pad;

  return [-r, r];
}

export function yDomainWithPadding<T extends Record<string, any>>(
  data: T[],
  keys: string[],
  padPct: number = 0.06,
  minAbsPad: number = 0.01
): Domain {
  if (!data || data.length === 0) return [0, 1];

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const row of data) {
    for (const k of keys) {
      const v = row?.[k];
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) continue;
      if (n < min) min = n;
      if (n > max) max = n;
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];

  const span = Math.max(max - min, minAbsPad);
  const pad = Math.max(span * padPct, minAbsPad);
  return [min - pad, max + pad];
}

export function yDomainSymmetricAroundZero(
  rows: Record<string, any>[],
  keys: string[],
  padFrac = 0.12,
  minHalfSpan = 0.02
): [number, number] {
  let maxAbs = 0;

  for (const r of rows) {
    for (const k of keys) {
      const v = r[k];
      if (Number.isFinite(v)) maxAbs = Math.max(maxAbs, Math.abs(v));
    }
  }

  maxAbs = Math.max(maxAbs, minHalfSpan);
  const pad = maxAbs * padFrac;
  const half = maxAbs + pad;
  return [-half, half];
}
