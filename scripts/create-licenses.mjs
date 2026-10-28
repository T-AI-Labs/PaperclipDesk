#!/usr/bin/env node

/**
 * Writes THIRD_PARTY_LICENSES.txt: every Rust crate and npm package the app
 * ships, with its version, project and license. The file is committed and
 * goes into the installer.
 *
 * Needs cargo-license: cargo install cargo-license
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const rule = "#".repeat(100);

// `shell` because npm is a .cmd on Windows, which Node refuses to spawn otherwise. Every
// argument here is a literal, so the usual escaping hazard does not apply.
function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: true });
}

function crates() {
  // Only what actually ships: the Windows target, no build- or dev-dependencies.
  const json = run(
    "cargo",
    ["license", "--json", "--avoid-dev-deps", "--avoid-build-deps", "--filter-platform", "x86_64-pc-windows-msvc"],
    path.join(projectRoot, "src-tauri"),
  );

  return JSON.parse(json)
    .filter((crate) => crate.name !== "paperclipdesk")
    .map((crate) => ({
      name: crate.name,
      version: crate.version,
      url: crate.repository ?? "",
      license: crate.license ?? "UNKNOWN",
      description: crate.description ?? "",
    }));
}

// Every package in the tree, not just `dependencies`: Vite bundles at build time, so the
// split between dependencies and devDependencies says little about what ships.
function packages() {
  const tree = JSON.parse(run("npm", ["ls", "--all", "--long", "--json"], path.join(projectRoot, "ui")));
  const found = new Map();

  (function walk(node) {
    for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
      if (!dep.version) continue;
      const key = `${name}@${dep.version}`;
      if (!found.has(key)) {
        found.set(key, { name, version: dep.version, license: dep.license ?? "UNKNOWN", ...manifest(dep.path) });
      }
      walk(dep);
    }
  })(tree);

  return [...found.values()];
}

// `npm ls --long` reports the license but neither the repository nor the description.
function manifest(packagePath) {
  if (!packagePath) return { url: "", description: "" };
  try {
    const pkg = JSON.parse(readFileSync(path.join(packagePath, "package.json"), "utf8"));
    const repository = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
    return {
      url: (repository ?? pkg.homepage ?? "").replace(/^git\+/, "").replace(/\.git$/, ""),
      description: pkg.description ?? "",
    };
  } catch {
    return { url: "", description: "" };
  }
}

function section(title, entries) {
  const body = entries
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) =>
      [
        rule,
        `Package:${entry.name}`,
        `Version:${entry.version}`,
        `project URL:${entry.url}`,
        `Description:${entry.description}`,
        `license Type:${entry.license}`,
        "",
      ].join("\n"),
    )
    .join("\n");

  return `${rule}\n${title} (${entries.length})\n${body}\n`;
}

// The Paperclip server, its Node.js runtime and its own dependencies come as a separate
// package; their license files travel inside it.
const output = [section("Rust crates", crates()), section("npm packages (build and runtime)", packages())].join("\n");

writeFileSync(path.join(projectRoot, "THIRD_PARTY_LICENSES.txt"), output, "utf8");
console.log("[create-licenses] THIRD_PARTY_LICENSES.txt written.");
