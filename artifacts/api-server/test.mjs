import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const outputFile = path.join(artifactDir, ".test-dist", "resumeText.test.mjs");

try {
  await build({
    entryPoints: [path.join(artifactDir, "src", "lib", "resumeText.test.ts")],
    outfile: outputFile,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    sourcemap: "inline",
    logLevel: "warning",
  });

  const result = spawnSync(process.execPath, ["--test", outputFile], {
    cwd: artifactDir,
    stdio: "inherit",
    env: { ...process.env, LOG_LEVEL: "silent" },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(path.dirname(outputFile), { recursive: true, force: true });
}
