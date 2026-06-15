/**
 * On-disk TurboQuant index: a versioned binary artifact holding the fitted
 * params, packed codes, correction scalars, and entity ids, plus the
 * quantized VectorBackend that scores against it.
 *
 * Layout (little-endian):
 *   magic  "TQZ1"                     4 bytes
 *   hdrLen uint32                     4 bytes
 *   header JSON, padded to 4 bytes
 *   mid        Float32[paddedDim]
 *   scale      Float32[paddedDim]
 *   centroids  Float32[levels]
 *   boundaries Float32[levels-1]
 *   corrections Float32[size]
 *   codes      Uint8[size * stride]
 *   ids JSON (utf8)                   header.idsBytes
 */
import fs from "node:fs";
import type { VectorBackend } from "./vectorBackend.js";
import {
  prepareQuery as prepareTurboQuery,
  scoreQuantized,
  type TurboQuantCodes,
  type TurboQuantParams
} from "./turboquant.js";

const MAGIC = "TQZ1";
// v2 ties `source` to the entities.jsonl fingerprint (was the manifest
// timestamp) and adds structural validation on read. v1 artifacts are
// rejected by the version check and recompiled.
const FORMAT_VERSION = 2;
const SUPPORTED_BITS = new Set([2, 4]);

interface TurboQuantHeader {
  version: number;
  model: string | null;
  // Fingerprint of the entities.jsonl the artifact was built from
  // (mtime:size). Compared at load time against the current embeddings file,
  // so a regenerated or partially-written index is detected as stale even when
  // model and count are unchanged.
  source: string | null;
  dim: number;
  paddedDim: number;
  seed: number;
  rounds: number;
  bits: number;
  levels: number;
  stride: number;
  size: number;
  idsBytes: number;
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

function bytesPerVector(bits: number, paddedDim: number): number {
  return bits === 4 ? paddedDim >> 1 : paddedDim;
}

export function writeTurboQuantIndex(
  filePath: string,
  params: TurboQuantParams,
  codes: TurboQuantCodes,
  ids: string[],
  model: string | null,
  source: string | null = null
): void {
  const levels = 1 << params.bits;
  const stride = bytesPerVector(params.bits, params.paddedDim);
  const idsJson = Buffer.from(JSON.stringify(ids), "utf8");

  const header: TurboQuantHeader = {
    version: FORMAT_VERSION,
    model,
    source,
    dim: params.dim,
    paddedDim: params.paddedDim,
    seed: params.seed,
    rounds: params.rounds,
    bits: params.bits,
    levels,
    stride,
    size: codes.size,
    idsBytes: idsJson.length
  };
  const headerJson = Buffer.from(JSON.stringify(header), "utf8");
  const headerPadded = align4(headerJson.length);

  const floatSections =
    params.paddedDim + params.paddedDim + levels + (levels - 1) + codes.size;
  const totalBytes =
    4 + 4 + headerPadded + floatSections * 4 + codes.codes.length + idsJson.length;

  const out = Buffer.alloc(totalBytes);
  let offset = 0;
  out.write(MAGIC, offset, "ascii");
  offset += 4;
  out.writeUInt32LE(headerJson.length, offset);
  offset += 4;
  headerJson.copy(out, offset);
  offset += headerPadded;

  const writeFloats = (arr: Float32Array): void => {
    for (let i = 0; i < arr.length; i += 1) {
      out.writeFloatLE(arr[i], offset);
      offset += 4;
    }
  };
  writeFloats(params.mid);
  writeFloats(params.scale);
  writeFloats(params.codebook.centroids);
  writeFloats(params.codebook.boundaries);
  writeFloats(codes.corrections);

  Buffer.from(codes.codes.buffer, codes.codes.byteOffset, codes.codes.length).copy(out, offset);
  offset += codes.codes.length;
  idsJson.copy(out, offset);

  fs.writeFileSync(filePath, out);
}

export interface LoadedTurboQuantIndex {
  params: TurboQuantParams;
  codes: TurboQuantCodes;
  ids: string[];
  model: string | null;
  source: string | null;
}

export function readTurboQuantIndex(filePath: string): LoadedTurboQuantIndex {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 8 || buffer.toString("ascii", 0, 4) !== MAGIC) {
    throw new Error("Not a TurboQuant index (bad magic)");
  }
  const headerLen = buffer.readUInt32LE(4);
  if (8 + headerLen > buffer.length) {
    throw new Error("TurboQuant index truncated (header)");
  }
  const header = JSON.parse(buffer.toString("utf8", 8, 8 + headerLen)) as TurboQuantHeader;
  if (header.version !== FORMAT_VERSION) {
    throw new Error(`Unsupported TurboQuant index version ${header.version}`);
  }

  // Validate header invariants before trusting any size for slicing. A
  // malformed-but-parseable artifact must throw so search falls back to exact
  // rather than scoring against undefined slots.
  if (
    !SUPPORTED_BITS.has(header.bits) ||
    header.levels !== 1 << header.bits ||
    header.paddedDim <= 0 ||
    header.size < 0 ||
    header.stride !== (header.bits === 4 ? header.paddedDim >> 1 : header.paddedDim) ||
    header.idsBytes < 0
  ) {
    throw new Error("TurboQuant index header failed invariant checks");
  }
  const floatCount = header.paddedDim * 2 + header.levels + (header.levels - 1) + header.size;
  const expectedBytes =
    8 + align4(headerLen) + floatCount * 4 + header.size * header.stride + header.idsBytes;
  if (buffer.length < expectedBytes) {
    throw new Error("TurboQuant index truncated (body)");
  }

  let offset = 8 + align4(headerLen);
  const readFloats = (count: number): Float32Array => {
    const arr = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      arr[i] = buffer.readFloatLE(offset);
      offset += 4;
    }
    return arr;
  };
  const mid = readFloats(header.paddedDim);
  const scale = readFloats(header.paddedDim);
  const centroids = readFloats(header.levels);
  const boundaries = readFloats(header.levels - 1);
  const corrections = readFloats(header.size);

  const codes = new Uint8Array(header.size * header.stride);
  buffer.copy(codes, 0, offset, offset + codes.length);
  offset += codes.length;

  const ids = JSON.parse(buffer.toString("utf8", offset, offset + header.idsBytes)) as string[];
  if (!Array.isArray(ids) || ids.length !== header.size) {
    throw new Error(`TurboQuant index id count ${Array.isArray(ids) ? ids.length : "n/a"} != size ${header.size}`);
  }

  const params: TurboQuantParams = {
    dim: header.dim,
    paddedDim: header.paddedDim,
    seed: header.seed,
    rounds: header.rounds,
    bits: header.bits,
    mid,
    scale,
    codebook: { bits: header.bits, centroids, boundaries }
  };
  return {
    params,
    codes: { size: header.size, codes, corrections },
    model: header.model,
    source: header.source ?? null,
    ids
  };
}

export class QuantizedVectorBackend implements VectorBackend {
  readonly size: number;
  readonly dim: number;
  readonly engine: string;
  private readonly params: TurboQuantParams;
  private readonly codes: TurboQuantCodes;
  private readonly slotById: Map<string, number>;

  constructor(loaded: LoadedTurboQuantIndex) {
    this.params = loaded.params;
    this.codes = loaded.codes;
    this.dim = loaded.params.dim;
    this.size = loaded.codes.size;
    this.engine = `turboquant-${loaded.params.bits}bit`;
    this.slotById = new Map();
    for (let i = 0; i < loaded.ids.length; i += 1) {
      this.slotById.set(loaded.ids[i], i);
    }
  }

  has(id: string): boolean {
    return this.slotById.has(id);
  }

  prepareQuery(query: Float32Array): (id: string) => number | null {
    const prepared = prepareTurboQuery(query, this.params);
    const codes = this.codes.codes;
    const corrections = this.codes.corrections;
    const paddedDim = this.params.paddedDim;
    const slotById = this.slotById;
    return (id: string): number | null => {
      const slot = slotById.get(id);
      if (slot === undefined) {
        return null;
      }
      return scoreQuantized(prepared, codes, corrections[slot], slot, paddedDim);
    };
  }
}
