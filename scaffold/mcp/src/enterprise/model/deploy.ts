import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BUNDLED_MODEL_DIR = join(__dirname, "..", "..", "models");
const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";

/**
 * If the project doesn't have the embedding model cached,
 * copy it from the bundled models in this package.
 * Returns true if a model was deployed, false if already present or no bundle.
 */
export function deployBundledModel(contextDir: string): boolean {
  const targetDir = join(contextDir, "embeddings", "models", MODEL_NAME);
  const sourceDir = join(BUNDLED_MODEL_DIR, MODEL_NAME);

  // Already cached — nothing to do
  if (existsSync(join(targetDir, "onnx", "model_quantized.onnx"))) {
    return false;
  }

  // No bundled model in this package
  if (!existsSync(join(sourceDir, "onnx", "model_quantized.onnx"))) {
    return false;
  }

  mkdirSync(targetDir, { recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true });
  return true;
}
