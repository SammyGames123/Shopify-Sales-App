/**
 * build.mjs — compiles src/run.js → dist/index.wasm using Javy.
 *
 * Javy is auto-downloaded from GitHub Releases on first run and
 * cached in .javy-cache/ so subsequent builds are instant.
 * Handles .gz, .tar.gz and .zip release assets.
 */

import { execFileSync, execSync } from "child_process";
import {
  existsSync, mkdirSync, readdirSync, copyFileSync,
  chmodSync, createReadStream, createWriteStream,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createGunzip } from "zlib";
import https from "https";
import os from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR  = join(__dirname, ".javy-cache");
const DL_DIR     = join(CACHE_DIR, "downloads");   // raw downloads go here
const INPUT      = join(__dirname, "src", "run.js");
const OUTPUT     = join(__dirname, "dist", "index.wasm");
const IS_WIN     = os.platform() === "win32";
const JAVY_EXT   = IS_WIN ? ".exe" : "";
const JAVY_CACHE = join(CACHE_DIR, `javy${JAVY_EXT}`);

mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(DL_DIR,    { recursive: true });
mkdirSync(join(__dirname, "dist"), { recursive: true });

// ── 1. Find Javy (PATH → cache) ───────────────────────────────────────────────

function javyInPath() {
  try {
    const cmd = IS_WIN ? "where javy" : "which javy";
    const p = execSync(cmd, { encoding: "utf8", stdio: ["pipe","pipe","pipe"] })
                .trim().split("\n")[0].trim();
    if (p && existsSync(p)) return p;
  } catch { /* not in PATH */ }
  return null;
}

function javyInCache() {
  if (existsSync(JAVY_CACHE)) return JAVY_CACHE;
  return null;
}

// ── 2. Download helpers ───────────────────────────────────────────────────────

/** Follow redirects and return response body as a string. */
function httpsGetString(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "shopify-sales-app-build" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(httpsGetString(res.headers.location));
      }
      let data = "";
      res.on("data", c => (data += c));
      res.on("end",  () => resolve(data));
      res.on("error", reject);
    }).on("error", reject);
  });
}

/** Download a URL to a local file (follows redirects). */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const attempt = (u) => {
      https.get(u, { headers: { "User-Agent": "shopify-sales-app-build" } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return attempt(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }
        const file = createWriteStream(destPath);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error",  reject);
      }).on("error", reject);
    };
    attempt(url);
  });
}

/** Decompress a .gz file (the file IS the binary, just gzip-compressed). */
function gunzipFile(src, dest) {
  return new Promise((resolve, reject) => {
    const r = createReadStream(src);
    const w = createWriteStream(dest);
    r.pipe(createGunzip()).pipe(w);
    w.on("finish", resolve);
    w.on("error",  reject);
    r.on("error",  reject);
  });
}

// ── 3. Auto-download Javy ─────────────────────────────────────────────────────

async function downloadJavy() {
  if (existsSync(JAVY_CACHE)) return JAVY_CACHE;

  console.log("Fetching Javy release info from GitHub...");
  const json    = await httpsGetString("https://api.github.com/repos/bytecodealliance/javy/releases/latest");
  const release = JSON.parse(json);

  const arch    = os.arch() === "arm64" ? "aarch64" : "x86_64";
  const plat    = IS_WIN ? "windows" : os.platform() === "darwin" ? "macos" : "linux";

  const asset = release.assets.find(a => {
    const n = a.name.toLowerCase();
    return n.includes(arch) && n.includes(plat);
  });
  if (!asset) throw new Error(`No Javy asset found for ${arch}-${plat}`);

  const assetName = asset.name;
  const dlPath    = join(DL_DIR, assetName);

  console.log(`Downloading ${assetName} ...`);
  await downloadFile(asset.browser_download_url, dlPath);

  const lower = assetName.toLowerCase();
  console.log("Extracting...");

  if (lower.endsWith(".gz") && !lower.endsWith(".tar.gz")) {
    // File is the binary compressed with gzip — decompress directly with Node zlib
    console.log("(gzip binary — using Node.js zlib)");
    await gunzipFile(dlPath, JAVY_CACHE);

  } else if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    execSync(`tar -xzf "${dlPath}" -C "${CACHE_DIR}"`, { stdio: "inherit" });
    // rename whatever was extracted to javy / javy.exe
    const bin = readdirSync(CACHE_DIR).find(f => f.toLowerCase().startsWith("javy") && !f.includes("."));
    if (bin && bin !== `javy${JAVY_EXT}`) copyFileSync(join(CACHE_DIR, bin), JAVY_CACHE);

  } else if (lower.endsWith(".zip")) {
    if (IS_WIN) {
      execSync(
        `powershell -NoProfile -Command "Expand-Archive -Path '${dlPath}' -DestinationPath '${CACHE_DIR}' -Force"`,
        { stdio: "inherit" }
      );
    } else {
      execSync(`unzip -o "${dlPath}" -d "${CACHE_DIR}"`, { stdio: "inherit" });
    }
    const bin = readdirSync(CACHE_DIR).find(f => f.toLowerCase().startsWith("javy") && (f.endsWith(".exe") || !f.includes(".")));
    if (bin && join(CACHE_DIR, bin) !== JAVY_CACHE) copyFileSync(join(CACHE_DIR, bin), JAVY_CACHE);

  } else {
    throw new Error(`Unsupported archive format: ${assetName}`);
  }

  if (!IS_WIN && existsSync(JAVY_CACHE)) chmodSync(JAVY_CACHE, 0o755);
  if (!existsSync(JAVY_CACHE)) throw new Error("Javy binary not found after extraction.");

  console.log(`Javy ready: ${JAVY_CACHE}`);
  return JAVY_CACHE;
}

// ── 4. Compile JS → WASM ──────────────────────────────────────────────────────

async function main() {
  let javyBin = javyInPath() ?? javyInCache();

  if (!javyBin) {
    console.log("Javy not in PATH or cache — downloading automatically...");
    try {
      javyBin = await downloadJavy();
    } catch (err) {
      console.error(`\nAuto-download failed: ${err.message}`);
      console.error(`
Install Javy manually then restart your terminal:

  PowerShell (run as Administrator):
    irm "https://github.com/bytecodealliance/javy/releases/latest/download/javy-x86_64-windows-static.zip" -OutFile "$env:TEMP\\javy.zip"; Expand-Archive "$env:TEMP\\javy.zip" -DestinationPath "C:\\Windows\\System32" -Force

  Or using Scoop:
    scoop install javy
`);
      process.exit(1);
    }
  }

  console.log(`Using Javy : ${javyBin}`);
  console.log(`Compiling  : ${INPUT}`);
  console.log(`Output     : ${OUTPUT}`);

  // Try different compile invocations for compatibility across Javy versions
  const attempts = [
    ["compile", "-d", "-o", OUTPUT, INPUT],   // v1.x dynamic
    ["compile", "-o", OUTPUT, INPUT],           // v1.x static
    ["build", "-C", "dynamic=y", "-o", OUTPUT, INPUT], // v2+
    ["build", "-o", OUTPUT, INPUT],             // v2+ static
  ];

  for (const argv of attempts) {
    try {
      execFileSync(javyBin, argv, { stdio: "inherit" });
      console.log("\nBuild succeeded.");
      return;
    } catch { /* try next */ }
  }

  throw new Error("All Javy compile attempts failed. The downloaded binary may be corrupt — delete .javy-cache/ and retry.");
}

main().catch(e => { console.error(e.message); process.exit(1); });
