// Pre-build script: generates the version/build-info env file before Vite
// runs. Plain Node — no Wrangler, no Vite config involved, no restrictions.
// Vite loads VITE_*-prefixed vars from these files automatically and exposes
// them via import.meta.env.
//
// Version: bump the `version` field in package.json to mark a release.
// Hash + date: captured automatically from the build environment (Cloudflare
// Workers Builds sets WORKERS_CI_COMMIT_SHA) or falls back to 'dev' for local
// builds with no matching env var.

import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("./package.json", "utf8"));
const hash = (
  process.env.WORKERS_CI_COMMIT_SHA ||
  process.env.CF_PAGES_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  "dev"
).slice(0, 7);
const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC

const env = `VITE_APP_VERSION=${pkg.version}
VITE_BUILD_HASH=${hash}
VITE_BUILD_DATE=${date}
`;

// `vite build` loads .env.production; `vite` (dev server) loads
// .env.development. Write both so the version line works in either mode.
const mode = process.argv[2] === "dev" ? "development" : "production";
// Keep every line this script doesn't own. .env.development also holds
// hand-added local secrets (GOOGLE_CLIENT_SECRET for the dev token endpoint,
// see vite.config.js), and rewriting the file wholesale on every `npm run dev`
// would silently delete them.
const envFile = `.env.${mode}`;
const owned = /^VITE_(APP_VERSION|BUILD_HASH|BUILD_DATE)=/;
const kept = fs.existsSync(envFile)
  ? fs.readFileSync(envFile, "utf8").split("\n").filter((l) => l.trim() && !owned.test(l))
  : [];
fs.writeFileSync(envFile, env + kept.map((l) => l + "\n").join(""));

// Stamp the service worker's cache-busting build id. RTW does this with a
// `sed` step in a GitHub Actions workflow that only runs on the GitHub Pages
// path; Temperatura deploys via Cloudflare Workers Builds with no GitHub
// Actions at all, so that step would never run and the shell cache key would
// stay "dev" forever. Emitting it as a separate constant the SW imports (vs.
// rewriting public/sw.js in place) keeps the tracked sw.js file untouched by
// every local build.
const buildId = `${hash}-${date}`;
fs.writeFileSync("public/build-id.js", `self.__TEMPERATURA_BUILD_ID__ = "${buildId}";\n`);

console.log(`✅ .env.${mode} written: v${pkg.version} · ${hash} · ${date}`);
