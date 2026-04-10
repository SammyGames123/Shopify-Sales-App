/**
 * build.mjs — delegates function compilation to the Shopify CLI.
 *
 * `shopify app function build` uses the CLI's internal Javy + Shopify
 * plugin, which:
 *   • produces a correctly-named `run` WASM export
 *   • creates a small (<256KB) dynamically-linked module
 *   • validates the input query against the current API schema
 *
 * We call it from the project root so the CLI can find shopify.app.toml.
 *
 * Anti-recursion guard: if the CLI calls this script again while building,
 * the SHOPIFY_SALES_BUILD guard prevents an infinite loop.
 */

import { execSync } from "child_process";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname   = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");

mkdirSync(resolve(__dirname, "dist"), { recursive: true });

// If the CLI called us again from within its own function build pipeline,
// exit cleanly so the CLI can continue with its own compilation.
if (process.env.SHOPIFY_SALES_BUILD) {
  console.log("Nested build detected — exiting (CLI will compile directly).");
  process.exit(0);
}

console.log("Building via Shopify CLI function builder...");

execSync("npx shopify app function build", {
  stdio: "inherit",
  cwd: projectRoot,
  env: { ...process.env, SHOPIFY_SALES_BUILD: "1" },
});
