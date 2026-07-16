function assertSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new TypeError("Performance samples must be a non-empty array.");
  }
  for (const sample of samples) {
    if (typeof sample !== "number" || !Number.isFinite(sample)) {
      throw new TypeError("Performance samples must contain only finite numbers.");
    }
  }
}

function quantile(sorted, fraction) {
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function median(sorted) {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function rounded(value) {
  return Math.round(value * 1000) / 1000;
}

export function summarizeSamples(samples) {
  assertSamples(samples);
  const sorted = [...samples].sort((left, right) => left - right);
  const mean = samples.reduce((total, sample) => total + sample, 0) / samples.length;
  const variance = samples.reduce(
    (total, sample) => total + ((sample - mean) ** 2),
    0,
  ) / samples.length;
  const standardDeviation = Math.sqrt(variance);
  const sampleMedian = median(sorted);
  const deviations = samples
    .map((sample) => Math.abs(sample - sampleMedian))
    .sort((left, right) => left - right);

  return Object.freeze({
    coefficientOfVariation: rounded(mean === 0 ? 0 : standardDeviation / Math.abs(mean)),
    count: samples.length,
    maximum: rounded(sorted.at(-1)),
    mean: rounded(mean),
    median: rounded(sampleMedian),
    medianAbsoluteDeviation: rounded(median(deviations)),
    minimum: rounded(sorted[0]),
    p90: rounded(quantile(sorted, 0.9)),
    p95: rounded(quantile(sorted, 0.95)),
    standardDeviation: rounded(standardDeviation),
  });
}
