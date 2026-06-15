/**
 * Vector scoring backends. Both the exact and the quantized index implement
 * one interface so the search pipeline only ever holds a per-query
 * "score this entity id" closure and never cares which is underneath.
 *
 * The exact backend (technique #6 from turbovec) replaces the per-entity
 * Map<string, Float32Array> with a single contiguous Float32Array slot array
 * plus precomputed inverse norms. Cosine then collapses to a dot product over
 * a cache-local buffer — exact results, lower memory, faster scan.
 */

export interface VectorBackend {
  readonly size: number;
  readonly dim: number;
  has(id: string): boolean;
  /**
   * Prepare a per-query scorer. The returned closure maps an entity id to its
   * cosine similarity in [-1, 1], or null when the id is not indexed.
   */
  prepareQuery(query: Float32Array): (id: string) => number | null;
  /** Human-readable engine label for diagnostics. */
  readonly engine: string;
}

export class ExactVectorBackend implements VectorBackend {
  readonly size: number;
  readonly dim: number;
  readonly engine = "exact";
  private readonly data: Float32Array;
  private readonly invNorm: Float32Array;
  private readonly slotById: Map<string, number>;

  private constructor(data: Float32Array, invNorm: Float32Array, slotById: Map<string, number>, dim: number) {
    this.data = data;
    this.invNorm = invNorm;
    this.slotById = slotById;
    this.dim = dim;
    this.size = slotById.size;
  }

  static fromVectors(vectors: Map<string, Float32Array>): ExactVectorBackend {
    let dim = 0;
    for (const vector of vectors.values()) {
      dim = vector.length;
      break;
    }
    const size = vectors.size;
    const data = new Float32Array(size * dim);
    const invNorm = new Float32Array(size);
    const slotById = new Map<string, number>();
    let slot = 0;
    for (const [id, vector] of vectors) {
      // Vectors with an unexpected dimension are skipped rather than
      // corrupting the contiguous layout.
      if (vector.length !== dim) {
        continue;
      }
      const offset = slot * dim;
      let normSq = 0;
      for (let i = 0; i < dim; i += 1) {
        const value = vector[i];
        data[offset + i] = value;
        normSq += value * value;
      }
      invNorm[slot] = normSq > 0 ? 1 / Math.sqrt(normSq) : 0;
      slotById.set(id, slot);
      slot += 1;
    }
    return new ExactVectorBackend(data, invNorm, slotById, dim);
  }

  has(id: string): boolean {
    return this.slotById.has(id);
  }

  prepareQuery(query: Float32Array): (id: string) => number | null {
    const dim = this.dim;
    const slotById = this.slotById;
    // Dimension mismatch (stale/corrupt index or a model change) is not a
    // valid comparison. Match the old cosineSimilarity contract: yield 0 for
    // indexed entities rather than scoring an arbitrary shared prefix.
    if (query.length !== dim) {
      return (id: string): number | null => (slotById.has(id) ? 0 : null);
    }
    let queryNormSq = 0;
    for (let i = 0; i < query.length; i += 1) {
      queryNormSq += query[i] * query[i];
    }
    const invQueryNorm = queryNormSq > 0 ? 1 / Math.sqrt(queryNormSq) : 0;
    const data = this.data;
    const invNorm = this.invNorm;

    return (id: string): number | null => {
      const slot = slotById.get(id);
      if (slot === undefined) {
        return null;
      }
      if (invQueryNorm === 0 || invNorm[slot] === 0) {
        return 0;
      }
      const offset = slot * dim;
      let dot = 0;
      for (let i = 0; i < dim; i += 1) {
        dot += query[i] * data[offset + i];
      }
      return dot * invQueryNorm * invNorm[slot];
    };
  }
}
