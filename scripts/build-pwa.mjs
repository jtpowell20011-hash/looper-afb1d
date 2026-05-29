import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(projectRoot, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "src"), { recursive: true });
await mkdir(path.join(dist, "assets"), { recursive: true });

const files = [
  ["index.html", "index.html"],
  ["styles.css", "styles.css"],
  ["manifest.webmanifest", "manifest.webmanifest"],
  ["sw.js", "sw.js"],
  ["src/main.js", "src/main.js"],
  ["assets/app-icon.svg", "assets/app-icon.svg"]
];

for (const [from, to] of files) {
  await cp(path.join(projectRoot, from), path.join(dist, to));
}

await cp(path.join(projectRoot, "src/game"), path.join(dist, "src/game"), { recursive: true });

await writeFile(
  path.join(dist, "_headers"),
  `/*
  Cache-Control: no-store

/manifest.webmanifest
  Content-Type: application/manifest+json; charset=utf-8

/sw.js
  Content-Type: text/javascript; charset=utf-8
  Cache-Control: no-store
`,
  "utf8"
);

console.log(`Built PWA folder: ${dist}`);
