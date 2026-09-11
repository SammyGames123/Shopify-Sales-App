/** Build the Shopify Function using the Shopify CLI. */
import { execSync } from "child_process";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");
mkdirSync(resolve(__dirname, "dist"), { recursive: true });

if (process.env.SHOPIFY_PICKUP_BUILD) {
  process.exit(0);
}

execSync("npx shopify app function build", {
  stdio: "inherit",
  cwd: projectRoot,
  env: { ...process.env, SHOPIFY_PICKUP_BUILD: "1" },
});
