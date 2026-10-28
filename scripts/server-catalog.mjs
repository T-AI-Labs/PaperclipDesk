#!/usr/bin/env node

/**
 * Writes the list of server packages the app may install (build/server-versions.json) from the
 * server-v<version> releases of this repository, signs it and publishes both in the release
 * "server-catalog". The app installs a version only from a list whose signature matches
 * src-tauri/server-catalog.pub.
 *
 * Needs gh with a token that can write releases, and SERVER_CATALOG_SIGNING_KEY: the private key of
 * its own, never the updater's. Runs no code of Paperclip's, so the key never meets it.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(projectRoot, "build");
const catalogTag = "server-catalog";
const listPath = path.join(buildDir, "server-versions.json");

const signingKey = process.env.SERVER_CATALOG_SIGNING_KEY;
if (!signingKey) {
  console.error("[server-catalog] SERVER_CATALOG_SIGNING_KEY is not set; the app accepts only a signed list.");
  process.exit(1);
}

const gh = (...args) => execFileSync("gh", args, { cwd: projectRoot, encoding: "utf8" });
const releases = JSON.parse(gh("release", "list", "--limit", "500", "--json", "tagName,isDraft"));
const versions = releases
  .filter((release) => !release.isDraft && /^server-v\d+(\.\d+)*$/.test(release.tagName))
  .map((release) => release.tagName.slice("server-v".length));

const downloads = path.join(buildDir, "server-catalog");
rmSync(downloads, { recursive: true, force: true });
const packages = versions.map((version) => {
  const dir = path.join(downloads, version);
  mkdirSync(dir, { recursive: true });
  gh("release", "download", `server-v${version}`, "--pattern", "*.sha256", "--dir", dir);
  const sha256 = readFileSync(path.join(dir, `paperclip-server-${version}-win-x64.zip.sha256`), "utf8").trim();
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`server-v${version} has no valid checksum`);
  return { version, sha256 };
});
rmSync(downloads, { recursive: true, force: true });

const parts = (version) => version.split(".").map(Number);
packages.sort((left, right) => {
  const [a, b] = [parts(left.version), parts(right.version)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (b[i] ?? 0) - (a[i] ?? 0);
  return 0;
});
writeFileSync(listPath, `${JSON.stringify({ versions: packages }, null, 2)}\n`);
console.log(`[server-catalog] ${packages.length} versions: ${packages.map((p) => p.version).join(", ")}`);

// The signer reads its key from these; a key or key path for app updates set elsewhere must not stand in for it.
const signerEnv = { ...process.env, TAURI_SIGNING_PRIVATE_KEY: signingKey, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.SERVER_CATALOG_SIGNING_KEY_PASSWORD ?? "" };
delete signerEnv.TAURI_SIGNING_PRIVATE_KEY_PATH;
execFileSync("npx", ["--prefix", "ui", "tauri", "signer", "sign", listPath], { cwd: projectRoot, shell: true, stdio: "inherit", env: signerEnv });

try {
  gh("release", "view", catalogTag);
} catch {
  // Never "latest": the updater's endpoint follows the latest release and must find the app there.
  gh("release", "create", catalogTag, "--latest=false", "--title", "Paperclip server versions", "--notes", "The signed list of Paperclip server packages PaperclipDesk can install.");
}
gh("release", "upload", catalogTag, listPath, `${listPath}.sig`, "--clobber");
console.log(`[server-catalog] Published ${path.basename(listPath)} and its signature in ${catalogTag}.`);
