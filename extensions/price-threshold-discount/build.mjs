/**
 * build.mjs — compiles src/run.js → dist/index.wasm using Javy.
 *
 * Javy is auto-downloaded from GitHub Releases on first run and
 * cached in .javy-cache/ so subsequent builds are instant.
 * No manual installation required.
 */

import { execFileSync, execSync } from "child_process";
import {
  existsSync, mkdirSync, readdirSync, copyFileSync,
  chmodSync, statSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import https from "https";
import os from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR  = join(__dirname, ".javy-cache");
const INPUT      = join(__dirname, "src", "run.js");
const OUTPUT     = join(__dirname, "dist", "index.wasm");

mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(join(__dirname, "dist"), { recursive: true });

// ── 1. Locate Javy (PATH → cache) ────────────────────────────────────────────

function javyInPath() {
  try {
    const cmd = os.platform() === "win32" ? "where javy" : "which javy";
    const p = execSync(cmd, { encoding: "utf8", stdio: ["pipe","pipe","pipe"] })
                .trim().split("\n")[0].trim();
    if (p && existsSync(p)) return p;
  } catch { /* not in PATH */ }
  return null;
}

function javyInCache() {
  const ext  = os.platform() === "win32" ? ".exe" : "";
  const fast = join(CACHE_DIR, `javy${ext}`);
  if (existsSync(fast)) return fast;
  // any file starting with "javy" in the cache dir
  try {
    const hit = readdirSync(CACHE_DIR)
      .find(f => f.toLowerCase().startsWith("javy") && (f.endsWith(".exe") || !f.includes(".")));
    if (hit) return join(CACHE_DIR, hit);
  } catch { /* ignore */ }
  return null;
}

// ── 2. Auto-download Javy from GitHub Releases ────────────────────────────────

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "shopify-sales-app-build" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(httpsGet(res.headers.location));
      }
      let data = "";
      res.on("data", c => (data += c));
      res.on("end",  () => resolve(data));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

async function fetchLatestJavyAsset() {
  console.log("Fetching Javy release info from GitHub...");
  const json = await httpsGet("https://api.github.com/repos/bytecodealliance/javy/releases/latest");
  const release = JSON.parse(json);

  const plat  = os.platform() === "win32" ? "windows"
              : os.platform() === "darwin" ? "macos" : "linux";
  const arch  = os.arch() === "arm64" ? "aarch64" : "x86_64";

  const asset = release.assets.find(a => {
    const n = a.name.toLowerCase();
    return n.includes(arch) && n.includes(plat);
  });

  if (!asset) throw new Error(`No Javy asset found for ${arch}-${plat}`);
  return asset;
}

async function downloadJavy() {
  const cached = javyInCache();
  if (cached) return cached;

  const asset = await fetchLatestJavyAsset();
  const zipPath = join(CACHE_DIR, "javy-download.zip");

  console.log(`Downloading ${asset.name} ...`);

  if (os.platform() === "win32") {
    // PowerShell is always available on Windows 7+
    execSync(
      `powershell -NoProfile -Command "Invoke-WebRequest -Uri '${asset.browser_download_url}' -OutFile '${zipPath}' -UseBasicParsing"`,
      { stdio: "inherit" }
    );
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${CACHE_DIR}' -Force"`,
      { stdio: "inherit" }
    );
  } else {
    execSync(`curl -fL "${asset.browser_download_url}" -o "${zipPath}"`, { stdio: "inherit" });
    execSync(`unzip -o "${zipPath}" -d "${CACHE_DIR}"`, { stdio: "inherit" });
  }

  // Locate the extracted binary
  const ext = os.platform() === "win32" ? ".exe" : "";
  const files = readdirSync(CACHE_DIR);
  const bin   = files.find(f => f.toLowerCase().startsWith("javy"));

  if (!bin) throw new Error("Javy binary not found in downloaded archive.");

  const src = join(CACHE_DIR, bin);
  const dst = join(CACHE_DIR, `javy${ext}`);

  if (src !== dst) copyFileSync(src, dst);
  if (os.platform() !== "win32") chmodSync(dst, 0o755);

  console.log(`Javy cached at: ${dst}`);
  return dst;
}

// ── 3. Compile JS → WASM ──────────────────────────────────────────────────────

async function main() {
  let javyBin = javyInPath() ?? javyInCache();

  if (!javyBin) {
    console.log("Javy not found in PATH or cache — downloading automatically...");
    try {
      javyBin = await downloadJavy();
    } catch (err) {
      console.error(`\nAuto-download failed: ${err.message}`);
      console.error(`
Please install Javy manually, then restart your terminal:

  PowerShell (paste into an Administrator PowerShell window):
    $r=(Invoke-RestMethod 'https://api.github.com/repos/bytecodealliance/javy/releases/latest').assets|?{$_.name-like'*windows*'}|select -first 1;Invoke-WebRequest $r.browser_download_url -OutFile "$env:TEMP\\javy.zip";Expand-Archive "$env:TEMP\\javy.zip" "$env:TEMP\\javy-bin" -Force;Copy-Item (Get-ChildItem "$env:TEMP\\javy-bin" -Recurse -Filter "javy*").FullName "C:\\Windows\\System32\\javy.exe" -Force

  Scoop:
    scoop install javy
`);
      process.exit(1);
    }
  }

  console.log(`Using Javy: ${javyBin}`);
  console.log(`Compiling  : ${INPUT}`);
  console.log(`Output     : ${OUTPUT}`);

  const args = [
    ["compile", "-d", "-o", OUTPUT, INPUT],
    ["compile", "-o", OUTPUT, INPUT],
    ["build", "-C", "dynamic=y", "-o", OUTPUT, INPUT],
    ["build", "-o", OUTPUT, INPUT],
  ];

  let lastErr;
  for (const argv of args) {
    try {
      execFileSync(javyBin, argv, { stdio: "inherit" });
      console.log("\nBuild succeeded.");
      return;
    } catch (e) {
      lastErr = e;
    }
  }

  throw new Error(`All Javy compile invocations failed.\n${lastErr}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
