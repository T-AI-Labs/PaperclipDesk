#!/usr/bin/env node

/**
 * Packs the staged server bundle and its Node.js runtime into the archive the
 * app downloads on its first local start
 * (build/paperclip-server-<version>-win-x64.zip), and prints the SHA-256 a
 * release build of the app has to be given as PAPERCLIP_SERVER_SHA256.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(projectRoot, "build");
const variant = "win-x64";

const version = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")).paperclip?.server;
const serverDir = path.join(buildDir, "server-bundle", variant, "server");
const nodeBin = path.join(buildDir, "node-bin", variant, "node.exe");

for (const required of [path.join(serverDir, "dist", "index.js"), path.join(serverDir, "ui-dist", "index.html"), nodeBin]) {
  if (!existsSync(required)) {
    console.error(`[pack-server] ${required} is missing. Run "npm run prepare-server" and "npm run prepare-server-ui" first.`);
    process.exit(1);
  }
}

const archiveName = `paperclip-server-${version}-${variant}.zip`;
const archivePath = path.join(buildDir, archiveName);
rmSync(archivePath, { force: true });

// The archive holds server/ and node-bin/ at its root, the layout the app expects next to each other.
const nodeStage = path.join(buildDir, "pack-staging");
rmSync(nodeStage, { recursive: true, force: true });
mkdirSync(path.join(nodeStage, "node-bin"), { recursive: true });
cpSync(nodeBin, path.join(nodeStage, "node-bin", "node.exe"));
cpSync(path.join(path.dirname(nodeBin), "LICENSE"), path.join(nodeStage, "node-bin", "LICENSE"));

console.log(`[pack-server] Packing ${archiveName}...`);
// Windows' own tar writes zip with -a; naming it by path keeps another tar on the PATH out of it.
const tar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
execFileSync(
  tar,
  ["-a", "-cf", archivePath, "-C", path.join(buildDir, "server-bundle", variant), "server", "-C", nodeStage, "node-bin"],
  { stdio: "inherit" },
);
rmSync(nodeStage, { recursive: true, force: true });

const hash = createHash("sha256");
for await (const chunk of createReadStream(archivePath)) hash.update(chunk);
const sha256 = hash.digest("hex");
writeFileSync(`${archivePath}.sha256`, `${sha256}\n`);

console.log(`[pack-server] ${archiveName}: ${(statSync(archivePath).size / 1024 / 1024).toFixed(0)} MB`);
console.log(`[pack-server] sha256 ${sha256}`);
