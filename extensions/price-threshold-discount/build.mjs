/**
 * build.mjs — finds the Javy binary bundled with @shopify/cli-kit and
 * uses it to compile src/run.js → dist/index.wasm.
 *
 * Javy is bundled inside the locally installed @shopify/cli-kit package.
 * This script walks node_modules/@shopify recursively to find it so no
 * manual Javy installation is needed.
 */

import { execFileSync, execSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import os from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 1. Ensure dist/ exists ────────────────────────────────────────────────────
mkdirSync(join(__dirname, "dist"), { recursive: true });

// ── 2. Locate Javy binary ─────────────────────────────────────────────────────

/** Recursively search a directory for any file whose name starts with "javy"
 *  and looks like an executable. Stops at maxDepth to avoid slowness. */
function findJavyInDir(dir, depth = 0) {
  if (depth > 7 || !existsSync(dir)) return null;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  // Check files first
  for (const e of entries) {
    if (!e.isFile()) continue;
    const lower = e.name.toLowerCase();
    if (lower.startsWith("javy") && (lower.endsWith(".exe") || !lower.includes("."))) {
      const full = join(dir, e.name);
      try {
        statSync(full); // confirm accessible
        return full;
      } catch {
        /* skip */
      }
    }
  }

  // Then recurse into subdirectories (skip large irrelevant dirs)
  const skip = new Set(["test", "__tests__", "docs", ".cache", "coverage", "examples"]);
  for (const e of entries) {
    if (!e.isDirectory() || skip.has(e.name) || e.name.startsWith(".")) continue;
    const found = findJavyInDir(join(dir, e.name), depth + 1);
    if (found) return found;
  }

  return null;
}

function findJavy() {
  // ── A: Already in PATH ──────────────────────────────────────────────────────
  try {
    const cmd = os.platform() === "win32" ? "where javy" : "which javy";
    const result = execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })
      .trim().split("\n")[0].trim();
    if (result && existsSync(result)) return result;
  } catch { /* not in PATH */ }

  // ── B: Inside this project's node_modules (installed via @shopify/cli) ─────
  const projectNodeModules = resolve(__dirname, "../../node_modules");
  const shopifyDir = join(projectNodeModules, "@shopify");
  console.log(`Searching for Javy in: ${shopifyDir}`);
  const inProject = findJavyInDir(shopifyDir);
  if (inProject) return inProject;

  // ── C: Global npm node_modules ───────────────────────────────────────────────
  const globalDirs = [
    join(process.env.APPDATA || "", "npm", "node_modules", "@shopify"),
    resolve(process.execPath, "../../lib/node_modules/@shopify"),
    resolve(process.execPath, "../../../lib/node_modules/@shopify"),
  ];
  for (const d of globalDirs) {
    const found = findJavyInDir(d);
    if (found) return found;
  }

  return null;
}

const javyBin = findJavy();

if (!javyBin) {
  console.error(`
╔══════════════════════════════════════════════════════════════╗
║  ERROR: Javy not found anywhere in node_modules or PATH.     ║
║                                                              ║
║  Install Javy for Windows using ONE of:                      ║
║                                                              ║
║  Option 1 — PowerShell (downloads from GitHub):              ║
║    Run the following in PowerShell as Administrator:         ║
║    irm https://github.com/bytecodealliance/javy/releases/download/v4.0.0/javy-x86_64-windows-static.zip -OutFile javy.zip; Expand-Archive javy.zip .\\javy-bin; Move-Item .\\javy-bin\\javy.exe C:\\Windows\\System32\\javy.exe
║                                                              ║
║  Option 2 — Scoop:                                           ║
║    scoop install javy                                        ║
║                                                              ║
║  Option 3 — npm (force-install a known-good version):        ║
║    npm install -g javy@0.2.0                                 ║
║                                                              ║
║  After installing, restart your terminal and run:            ║
║    npx shopify app dev                                       ║
╚══════════════════════════════════════════════════════════════╝
`);
  process.exit(1);
}

console.log(`Found Javy: ${javyBin}`);

// ── 3. Compile JS → WASM ──────────────────────────────────────────────────────
const input  = join(__dirname, "src", "run.js");
const output = join(__dirname, "dist", "index.wasm");

console.log(`Compiling ${input} → ${output}`);

try {
  execFileSync(javyBin, ["compile", "-d", "-o", output, input], { stdio: "inherit" });
  console.log("Build succeeded.");
} catch {
  // Older/newer Javy versions may not support -d; retry without it
  console.log("Retrying without dynamic-linking flag...");
  execFileSync(javyBin, ["compile", "-o", output, input], { stdio: "inherit" });
  console.log("Build succeeded (static mode).");
}
