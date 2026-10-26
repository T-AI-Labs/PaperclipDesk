#!/usr/bin/env node

/**
 * Bundles the staged server's entry and everything it imports into one file,
 * server/dist/index.bundle.mjs, which the app starts instead of dist/index.js.
 * Node.js spends most of a start resolving and loading the server's thousands
 * of modules; from one file it starts several seconds sooner.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = path.join(projectRoot, "build", "server-bundle", "win-x64", "server");
const entry = path.join(serverDir, "dist", "index.js");
const outfile = path.join(serverDir, "dist", "index.bundle.mjs");

// Native addons and the packages that load them stay files of their own.
const external = [
  "embedded-postgres",
  "@embedded-postgres/*",
  "sharp",
  "@img/*",
  "ssh2",
  "cpu-features",
  "@cursor/sdk*",
  "@heif2jpeg/*",
  "esbuild",
  "*.node",
];

// The server imports optional packages and other platforms' binaries that are not installed; those imports stay as they are and fail only if they run.
const keepUnresolved = {
  name: "keep-unresolved",
  setup(build) {
    build.onResolve({ filter: /.*/ }, async (args) => {
      if (args.pluginData?.inner) return undefined;
      const result = await build.resolve(args.path, { kind: args.kind, importer: args.importer, resolveDir: args.resolveDir, pluginData: { inner: true } });
      return result.errors.length > 0 ? { path: args.path, external: true } : result;
    });
  },
};

// Every module keeps the location it had, so the files it finds next to itself (migrations, scripts, workers) are still found.
const keepLocation = {
  name: "keep-location",
  setup(build) {
    build.onLoad({ filter: /\.(c|m)?js$/ }, async (args) => {
      let source = await readFile(args.path, "utf8");
      const resolveDir = path.dirname(args.path);
      // The entry compares import.meta.url with the started file to know it is the main module.
      if (args.path === entry || !/import\.meta\.url|__dirname|__filename|require\.resolve/.test(source)) {
        return { contents: source, loader: "js", resolveDir };
      }
      const url = JSON.stringify(pathToFileURL(args.path).href);
      source = source.replaceAll("import.meta.url", url);
      const declared = (name) => new RegExp(String.raw`(const|let|var|function)\s+${name}\b`).test(source);
      const prelude = [
        ["__dirname", resolveDir],
        ["__filename", args.path],
      ]
        .filter(([name]) => source.includes(name) && !declared(name))
        .map(([name, value]) => `var ${name} = ${JSON.stringify(value)};`);
      // Code inside string literals is written out for another process and stays as it is.
      if (source.includes("require.resolve(") && !/["'`][^"'`\n]*require\.resolve\(/.test(source)) {
        source = source.replaceAll("require.resolve(", "__paperclipResolve(");
        prelude.push(`var __paperclipResolve = __paperclipRequire(${url}).resolve;`);
      }
      return { contents: prelude.join("") + source, loader: "js", resolveDir };
    });
  },
};

console.log("[bundle-server] Bundling the server entry...");
const result = await esbuild.build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external,
  plugins: [keepUnresolved, keepLocation],
  metafile: true,
  logLevel: "warning",
  logLimit: 5,
  // CommonJS code inlined into an ES module still calls require.
  banner: { js: "import { createRequire as __paperclipRequire } from 'node:module'; const require = __paperclipRequire(import.meta.url);" },
});
console.log(`[bundle-server] ${Object.keys(result.metafile.inputs).length} modules in ${path.relative(projectRoot, outfile)}`);
