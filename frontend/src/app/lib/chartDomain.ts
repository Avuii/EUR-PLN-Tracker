function finiteValues(data: any[], keys: string[]) {
  const values: number[] = [];

  for (const row of data ?? []) {
    for (const key of keys) {
      const n = Number(row?.[key]);
      if (Number.isFinite(n)) values.push(n);
    }
  }

  return values;
}

export function yDomainFromData(data: any[], keys: string[], paddingRatio = 0.08, minPadding = 0.01): [number, number] {
  const values = finiteValues(data, keys);

  if (!values.length) return [0, 1];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, minPadding);
  const pad = Math.max(span * paddingRatio, minPadding);

  return [min - pad, max + pad];
}

export function yDomainSymmetric(data: any[], keys: string[], paddingRatio = 0.12, minAbs = 0.01): [number, number] {
  const values = finiteValues(data, keys);

  if (!values.length) return [-1, 1];

  const maxAbs = Math.max(...values.map((v) => Math.abs(v)), minAbs);
  const pad = Math.max(maxAbs * paddingRatio, minAbs);
  const bound = maxAbs + pad;

  return [-bound, bound];
}
