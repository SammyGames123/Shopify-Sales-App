/**
 * build.mjs — finds the Javy binary bundled with @shopify/cli and
 * uses it to compile src/run.js → dist/index.wasm.
 *
 * Shopify CLI bundles Javy internally. This script walks the global
 * node_modules tree to locate the binary, so no separate Javy install
 * is needed on the developer's machine.
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import os from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 1. Ensure dist/ exists ────────────────────────────────────────────────────
mkdirSync(join(__dirname, "dist"), { recursive: true });

// ── 2. Locate Javy binary ─────────────────────────────────────────────────────
function findJavy() {
  // Option A: already in PATH (manual install or CI)
  try {
    const cmd = os.platform() === "win32" ? "where javy" : "which javy";
    const result = execSync(cmd, { encoding: "utf8" }).trim().split("\n")[0].trim();
    if (result && existsSync(result)) return result;
  } catch {
    // not in PATH — continue searching
  }

  // Option B: bundled inside the global @shopify/cli installation
  const platform = os.platform(); // win32 | darwin | linux
  const arch = os.arch();         // x64 | arm64

  const platformKey =
    platform === "win32" ? "windows" :
    platform === "darwin" ? "darwin" :
    "linux";

  const archKey = arch === "arm64" ? "aarch64" : "x86_64";
  const ext = platform === "win32" ? ".exe" : "";

  // Walk up from this file to find global node_modules
  const candidates = [
    // Project node_modules (workspace root)
    resolve(__dirname, "../../node_modules"),
    // Global npm on Windows
    join(process.env.APPDATA || "", "npm", "node_modules"),
    // Global npm on Unix
    resolve(process.execPath, "../../lib/node_modules"),
    resolve(process.execPath, "../../../lib/node_modules"),
  ];

  for (const base of candidates) {
    // Shopify CLI ≥3.67 bundles Javy inside @shopify/cli-kit
    const searches = [
      join(base, "@shopify", "cli-kit", "assets", "javy", `javy-${archKey}-${platformKey}${ext}`),
      join(base, "@shopify", "cli", "node_modules", "@shopify", "cli-kit", "assets", "javy", `javy-${archKey}-${platformKey}${ext}`),
    ];
    for (const p of searches) {
      if (existsSync(p)) return p;
    }
  }

  return null;
}

const javyBin = findJavy();

if (!javyBin) {
  console.error(`
ERROR: Javy not found.

Install it with one of:
  winget install BytecodeAlliance.javy       (Windows)
  brew install javy                          (macOS)
  cargo install javy-cli                    (any platform with Rust)

Or upgrade Shopify CLI to the latest version:
  npm install -g @shopify/cli@latest
`);
  process.exit(1);
}

// ── 3. Compile JS → WASM ──────────────────────────────────────────────────────
const input  = join(__dirname, "src", "run.js");
const output = join(__dirname, "dist", "index.wasm");

console.log(`Using Javy: ${javyBin}`);
console.log(`Compiling: ${input} → ${output}`);

try {
  execFileSync(javyBin, ["compile", "-d", "-o", output, input], {
    stdio: "inherit",
  });
  console.log("Build succeeded.");
} catch (err) {
  // Some versions of Javy removed the -d flag; retry without it
  console.log("Retrying without -d flag...");
  execFileSync(javyBin, ["compile", "-o", output, input], {
    stdio: "inherit",
  });
  console.log("Build succeeded (static).");
}
