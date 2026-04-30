import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const webDir = path.join(repoRoot, "apps", "web");
const distDir = path.join(webDir, "dist");
const docsDir = path.join(repoRoot, "docs");

const mode = process.argv[2] === "dev" ? "dev" : "live";
const repoBasePath = process.env.PAGES_REPO_BASE || "/XLSX-File-and-Dashboard-Creator/";
const apiBaseUrl = process.env.VITE_API_BASE_URL || "https://xlsx-file-and-dashboard-creator.onrender.com";

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function stripLeadingSlash(value) {
  return value.startsWith("/") ? value.slice(1) : value;
}

const normalizedRepoBase = ensureTrailingSlash(repoBasePath);
const basePath = mode === "dev"
  ? ensureTrailingSlash(`${normalizedRepoBase}dev/`)
  : normalizedRepoBase;

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      ...env
    }
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function emptyDirectory(targetDir, preserve = new Set()) {
  if (!existsSync(targetDir)) return;
  readdirSync(targetDir).forEach((entry) => {
    if (preserve.has(entry)) return;
    rmSync(path.join(targetDir, entry), { recursive: true, force: true });
  });
}

function copyDist(targetDir) {
  mkdirSync(targetDir, { recursive: true });
  readdirSync(distDir).forEach((entry) => {
    cpSync(path.join(distDir, entry), path.join(targetDir, entry), { recursive: true });
  });
  const indexPath = path.join(targetDir, "index.html");
  const notFoundPath = path.join(targetDir, "404.html");
  if (existsSync(indexPath)) {
    writeFileSync(notFoundPath, readFile(indexPath));
  }
}

function readFile(filePath) {
  return readFileSync(filePath);
}

run("npm", ["--prefix", "apps/web", "run", "build"], {
  VITE_API_BASE_URL: apiBaseUrl,
  VITE_BASE_PATH: basePath
});

mkdirSync(docsDir, { recursive: true });
writeFileSync(path.join(docsDir, ".nojekyll"), "");

if (mode === "dev") {
  const devTarget = path.join(docsDir, "dev");
  emptyDirectory(devTarget, new Set(["assets"]));
  copyDist(devTarget);
} else {
  emptyDirectory(docsDir, new Set(["assets", "dev"]));
  copyDist(docsDir);
}

console.log(`Published ${mode} GitHub Pages bundle to ${path.relative(repoRoot, mode === "dev" ? path.join(docsDir, "dev") : docsDir)}`);
console.log(`Base path: ${basePath}`);
console.log(`URL: https://donaldlundgren.github.io/${stripLeadingSlash(basePath)}`);
