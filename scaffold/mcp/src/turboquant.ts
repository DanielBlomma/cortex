/**
 * TurboQuant: a data-oblivious scalar quantizer for unit-norm embedding
 * vectors, ported (the math, not the Rust) from the techniques in
 * https://github.com/RyanCodrai/turbovec.
 *
 * The pipeline, per the upstream inventions:
 *   1. Randomized Hadamard rotation (data-oblivious). A seeded sign-flip +
 *      fast Walsh-Hadamard transform is orthonormal and O(d log d), so the
 *      whole rotation is stored as a single seed rather than a d*d matrix.
 *      After rotation each coordinate follows a near-Gaussian marginal,
 *      regardless of the input distribution.
 *   2. Per-coordinate calibration (TQ+). Robust 5/95-quantile shift+scale
 *      mapping each rotated coordinate onto the canonical N(0,1) marginal,
 *      fitted once from a sample and frozen.
 *   3. Lloyd-Max scalar quantization. Because the calibrated marginal is a
 *      known N(0,1), optimal bucket boundaries/centroids are precomputed by
 *      numerical Lloyd iteration — no data-driven training.
 *   4. Length-renormalized correction. A per-vector scalar that makes the
 *      quantized inner-product estimate self-consistent (exact on the
 *      self-similarity) and corrects the downward bias of quantization.
 *
 * Scoring is asymmetric: the stored vectors are quantized, the query stays
 * full precision. The query builds a per-coordinate lookup table so scoring
 * reads codebook contributions directly without decompressing codes.
 *
 * All vectors are assumed L2-normalized (the embedder writes them with
 * normalize: true), so the recovered inner product equals cosine similarity.
 */

const QUANTILE_LOW = 0.05;
const QUANTILE_HIGH = 0.95;
// Standard-normal 5%/95% quantiles; the calibration target the rotated
// coordinates are mapped onto.
const NORMAL_Q05 = -1.6448536269514722;
const NORMAL_Q95 = 1.6448536269514722;
const CALIBRATION_SAMPLE_CAP = 4096;
const MIN_CORRECTION_DENOM = 1e-6;

export interface TurboQuantCodebook {
  readonly bits: number;
  /** 2^bits centroid values over the standard normal. */
  readonly centroids: Float32Array;
  /** Sorted boundaries (length 2^bits - 1) separating adjacent centroids. */
  readonly boundaries: Float32Array;
}

export interface TurboQuantParams {
  /** Original embedding dimension. */
  readonly dim: number;
  /** Padded power-of-two dimension the rotation runs in. */
  readonly paddedDim: number;
  /** Seed for the randomized Hadamard sign vectors. */
  readonly seed: number;
  /** Number of sign-flip + Hadamard rounds. */
  readonly rounds: number;
  readonly bits: number;
  /** Per-coordinate calibration midpoint (length paddedDim). */
  readonly mid: Float32Array;
  /** Per-coordinate calibration scale (length paddedDim). */
  readonly scale: Float32Array;
  readonly codebook: TurboQuantCodebook;
}

/** Packed quantized vectors plus their correction scalars. */
export interface TurboQuantCodes {
  readonly size: number;
  /** Nibble-packed codes; for 4-bit, two coordinates per byte. */
  readonly codes: Uint8Array;
  /** Per-vector length-renormalization correction scalar. */
  readonly corrections: Float32Array;
}

export function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) {
    result *= 2;
  }
  return result;
}

// Deterministic xorshift32. Math.random is intentionally avoided so the
// rotation is reproducible at query time from the stored seed alone.
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) {
    state = 0x9e3779b9;
  }
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function buildSignVectors(seed: number, paddedDim: number, rounds: number): Int8Array[] {
  const rng = makeRng(seed);
  const signs: Int8Array[] = [];
  for (let round = 0; round < rounds; round += 1) {
    const vector = new Int8Array(paddedDim);
    for (let index = 0; index < paddedDim; index += 1) {
      vector[index] = rng() < 0.5 ? -1 : 1;
    }
    signs.push(vector);
  }
  return signs;
}

// In-place fast Walsh-Hadamard transform; length must be a power of two.
function fwht(data: Float64Array): void {
  const length = data.length;
  for (let span = 1; span < length; span *= 2) {
    for (let start = 0; start < length; start += span * 2) {
      for (let offset = start; offset < start + span; offset += 1) {
        const a = data[offset];
        const b = data[offset + span];
        data[offset] = a + b;
        data[offset + span] = a - b;
      }
    }
  }
}

/**
 * Apply the randomized Hadamard rotation in place to a padded vector.
 * Each round is sign-flip then orthonormal Hadamard (divide by sqrt(len)),
 * so the transform is orthogonal and norm-preserving.
 */
export function applyRotation(vector: Float64Array, signs: Int8Array[]): void {
  const length = vector.length;
  const invSqrt = 1 / Math.sqrt(length);
  for (const sign of signs) {
    for (let index = 0; index < length; index += 1) {
      vector[index] *= sign[index];
    }
    fwht(vector);
    for (let index = 0; index < length; index += 1) {
      vector[index] *= invSqrt;
    }
  }
}

/** Pad an arbitrary-length vector into a fresh Float64Array of paddedDim. */
export function padVector(vector: Float32Array | Float64Array, paddedDim: number): Float64Array {
  const out = new Float64Array(paddedDim);
  const limit = Math.min(vector.length, paddedDim);
  for (let index = 0; index < limit; index += 1) {
    out[index] = vector[index];
  }
  return out;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Lloyd-Max optimal scalar quantizer for the standard normal source,
 * computed by numeric Lloyd iteration over a fixed grid. Deterministic.
 */
export function buildNormalCodebook(bits: number): TurboQuantCodebook {
  const levels = 1 << bits;
  const gridMin = -6;
  const gridMax = 6;
  const steps = 8192;
  const dx = (gridMax - gridMin) / steps;
  const xs = new Float64Array(steps);
  const pdf = new Float64Array(steps);
  const norm = 1 / Math.sqrt(2 * Math.PI);
  for (let i = 0; i < steps; i += 1) {
    const x = gridMin + (i + 0.5) * dx;
    xs[i] = x;
    pdf[i] = norm * Math.exp(-0.5 * x * x);
  }

  // Initialize centroids at evenly spaced normal quantiles.
  const centroids = new Float64Array(levels);
  for (let k = 0; k < levels; k += 1) {
    const q = (k + 0.5) / levels;
    // Inverse-normal approximation is unnecessary; seed from grid quantiles.
    centroids[k] = gridMin + (gridMax - gridMin) * q;
  }

  const boundaries = new Float64Array(levels - 1);
  for (let iteration = 0; iteration < 100; iteration += 1) {
    for (let k = 0; k < levels - 1; k += 1) {
      boundaries[k] = (centroids[k] + centroids[k + 1]) / 2;
    }
    const sum = new Float64Array(levels);
    const weight = new Float64Array(levels);
    for (let i = 0; i < steps; i += 1) {
      const x = xs[i];
      let bucket = 0;
      while (bucket < levels - 1 && x > boundaries[bucket]) {
        bucket += 1;
      }
      const w = pdf[i] * dx;
      sum[bucket] += x * w;
      weight[bucket] += w;
    }
    for (let k = 0; k < levels; k += 1) {
      if (weight[k] > 0) {
        centroids[k] = sum[k] / weight[k];
      }
    }
  }

  return {
    bits,
    centroids: Float32Array.from(centroids),
    boundaries: Float32Array.from(boundaries.subarray(0, levels - 1))
  };
}

function codeForValue(value: number, boundaries: Float32Array): number {
  // Binary search for the bucket; boundaries are sorted ascending.
  let lo = 0;
  let hi = boundaries.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (value > boundaries[mid]) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * Fit calibration (TQ+) from a sample of already-rotated vectors. Returns
 * per-coordinate mid/scale that map each coordinate's 5/95 quantiles onto the
 * standard normal's. Robust to the asymptotic nature of the Gaussian marginal.
 */
function fitCalibration(rotatedSample: Float64Array[], paddedDim: number): {
  mid: Float32Array;
  scale: Float32Array;
} {
  const mid = new Float32Array(paddedDim);
  const scale = new Float32Array(paddedDim);
  const column: number[] = new Array(rotatedSample.length);
  const targetSpan = NORMAL_Q95 - NORMAL_Q05;
  for (let j = 0; j < paddedDim; j += 1) {
    for (let r = 0; r < rotatedSample.length; r += 1) {
      column[r] = rotatedSample[r][j];
    }
    column.sort((a, b) => a - b);
    const q05 = quantile(column, QUANTILE_LOW);
    const q95 = quantile(column, QUANTILE_HIGH);
    const span = q95 - q05;
    mid[j] = (q05 + q95) / 2;
    scale[j] = span > 1e-9 ? targetSpan / span : 1;
  }
  return { mid, scale };
}

export interface TurboQuantBuildOptions {
  readonly bits?: number;
  readonly seed?: number;
  readonly rounds?: number;
}

/**
 * Fit TurboQuant parameters from a corpus of unit-norm vectors. Only a sample
 * is used for calibration; the codebook is data-oblivious.
 */
export function fitTurboQuant(
  vectors: Float32Array[],
  dim: number,
  options: TurboQuantBuildOptions = {}
): TurboQuantParams {
  const bits = options.bits ?? 4;
  const seed = options.seed ?? 0x5eed1234;
  const rounds = options.rounds ?? 2;
  const paddedDim = nextPowerOfTwo(dim);
  const signs = buildSignVectors(seed, paddedDim, rounds);

  const sampleCount = Math.min(vectors.length, CALIBRATION_SAMPLE_CAP);
  const stride = Math.max(1, Math.floor(vectors.length / Math.max(1, sampleCount)));
  const rotatedSample: Float64Array[] = [];
  for (let i = 0; i < vectors.length && rotatedSample.length < sampleCount; i += stride) {
    const rotated = padVector(vectors[i], paddedDim);
    applyRotation(rotated, signs);
    rotatedSample.push(rotated);
  }

  const { mid, scale } = fitCalibration(rotatedSample, paddedDim);
  const codebook = buildNormalCodebook(bits);

  return { dim, paddedDim, seed, rounds, bits, mid, scale, codebook };
}

function packCodes(perVectorCodes: Uint8Array, bits: number, paddedDim: number, target: Uint8Array, offset: number): void {
  if (bits === 4) {
    const packedLen = paddedDim >> 1;
    for (let i = 0; i < packedLen; i += 1) {
      const lo = perVectorCodes[i * 2] & 0x0f;
      const hi = perVectorCodes[i * 2 + 1] & 0x0f;
      target[offset + i] = lo | (hi << 4);
    }
    return;
  }
  // Fallback: one code per byte for non-4-bit depths.
  for (let i = 0; i < paddedDim; i += 1) {
    target[offset + i] = perVectorCodes[i];
  }
}

function bytesPerVector(bits: number, paddedDim: number): number {
  return bits === 4 ? paddedDim >> 1 : paddedDim;
}

/**
 * Encode a corpus into packed codes + correction scalars using fitted params.
 */
export function encodeTurboQuant(vectors: Float32Array[], params: TurboQuantParams): TurboQuantCodes {
  const { paddedDim, bits, mid, scale, codebook } = params;
  const signs = buildSignVectors(params.seed, paddedDim, params.rounds);
  const stride = bytesPerVector(bits, paddedDim);
  const codes = new Uint8Array(stride * vectors.length);
  const corrections = new Float32Array(vectors.length);
  const scratch = new Uint8Array(paddedDim);

  for (let v = 0; v < vectors.length; v += 1) {
    const rotated = padVector(vectors[v], paddedDim);
    applyRotation(rotated, signs);

    // ⟨v_rot, reconstruction⟩ accumulates as we encode, for the correction.
    let dotSelf = 0;
    for (let j = 0; j < paddedDim; j += 1) {
      const z = (rotated[j] - mid[j]) * scale[j];
      const code = codeForValue(z, codebook.boundaries);
      scratch[j] = code;
      // Inverse calibration recovers the rotated-space reconstruction.
      const reconstruction = codebook.centroids[code] / scale[j] + mid[j];
      dotSelf += rotated[j] * reconstruction;
    }
    corrections[v] = Math.abs(dotSelf) < MIN_CORRECTION_DENOM ? 0 : 1 / dotSelf;
    packCodes(scratch, bits, paddedDim, codes, v * stride);
  }

  return { size: vectors.length, codes, corrections };
}

/**
 * Per-query scoring state: a flattened lookup table (paddedDim * levels) plus
 * the query-dependent offset. score(v) = correction[v] * (offset + sum of LUT
 * entries selected by v's codes).
 */
export interface TurboQuantQuery {
  readonly lut: Float32Array;
  readonly offset: number;
  readonly levels: number;
  readonly stride: number;
  readonly bits: number;
}

export function prepareQuery(query: Float32Array, params: TurboQuantParams): TurboQuantQuery {
  const { paddedDim, bits, mid, scale, codebook } = params;
  const signs = buildSignVectors(params.seed, paddedDim, params.rounds);
  const rotated = padVector(query, paddedDim);
  applyRotation(rotated, signs);

  const levels = 1 << bits;
  const lut = new Float32Array(paddedDim * levels);
  let offset = 0;
  for (let j = 0; j < paddedDim; j += 1) {
    const qj = rotated[j];
    const weight = qj / scale[j];
    offset += qj * mid[j];
    const base = j * levels;
    for (let k = 0; k < levels; k += 1) {
      lut[base + k] = weight * codebook.centroids[k];
    }
  }
  return { lut, offset, levels, stride: bytesPerVector(bits, paddedDim), bits };
}

/**
 * Score a single quantized vector against a prepared query. Returns the
 * estimated cosine similarity (inner product of unit vectors).
 */
export function scoreQuantized(
  query: TurboQuantQuery,
  codes: Uint8Array,
  correction: number,
  slot: number,
  paddedDim: number
): number {
  const { lut, offset, levels, stride, bits } = query;
  let acc = offset;
  const base = slot * stride;
  if (bits === 4) {
    for (let i = 0; i < stride; i += 1) {
      const byte = codes[base + i];
      const lo = byte & 0x0f;
      const hi = byte >> 4;
      const j = i * 2;
      acc += lut[j * levels + lo];
      acc += lut[(j + 1) * levels + hi];
    }
  } else {
    for (let j = 0; j < paddedDim; j += 1) {
      acc += lut[j * levels + codes[base + j]];
    }
  }
  return correction * acc;
}
