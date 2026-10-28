#!/usr/bin/env node

/**
 * Installs @paperclipai/server from npm into a staging directory, then
 * assembles the server bundle and the Node.js binary the app ships with
 * (build/server-bundle/win-x64 and build/node-bin/win-x64).
 */

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const stagingRootDir = path.join(projectRoot, "build", "server-staging");
const bundleRootDir = path.join(projectRoot, "build", "server-bundle");

const projectPkg = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
// PAPERCLIP_SERVER_VERSION builds a newer server than the pinned one, for the list of versions the app offers.
const serverVersion = process.env.PAPERCLIP_SERVER_VERSION || projectPkg.paperclip?.server;
if (!serverVersion) {
  console.error("[prepare-server] paperclip.server not found in package.json");
  process.exit(1);
}
const teamsCatalogVersion = projectPkg.paperclip?.teamsCatalog;
if (!teamsCatalogVersion) {
  console.error("[prepare-server] paperclip.teamsCatalog not found in package.json");
  process.exit(1);
}

const serverBundleOverrides = {
  ...(projectPkg.paperclip?.overrides ?? {}),
  // cssstyle currently resolves a 5.x css-color release that trips
  // Node 22's ERR_REQUIRE_ASYNC_MODULE path in the packaged runtime.
  "@asamuzakjp/css-color": "4.1.2",
};

console.log(`[prepare-server] Target server version: @paperclipai/server@${serverVersion}`);
console.log(
  `[prepare-server] Target teams catalog version: @paperclipai/teams-catalog@${teamsCatalogVersion}`,
);

const arch = "x64";
const variant = `win-${arch}`;

rmSync(stagingRootDir, { recursive: true, force: true });
rmSync(bundleRootDir, { recursive: true, force: true });

mkdirSync(stagingRootDir, { recursive: true });
mkdirSync(bundleRootDir, { recursive: true });

function validateMigrations(bundleServerDir) {
  const migrationsDir = path.join(
    bundleServerDir,
    "node_modules",
    "@paperclipai",
    "db",
    "dist",
    "migrations",
  );

  if (!existsSync(migrationsDir)) {
    console.error(`[prepare-server] ERROR: Migrations directory not found at ${migrationsDir}`);
    process.exit(1);
  }

  const sqlFiles = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
  console.log(`[prepare-server] Migration files validated: ${sqlFiles.length} SQL file(s) present.`);
  if (sqlFiles.length === 0) {
    console.error("[prepare-server] ERROR: No migration SQL files found in @paperclipai/db. The app will fail to initialise the database.");
    process.exit(1);
  }
}

function dependencyDir(nodeModulesDir, dependency) {
  return path.join(nodeModulesDir, ...dependency.split("/"));
}

function readPackage(dir) {
  const file = path.join(dir, "package.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

/** The names of the packages directly in a node_modules folder, scoped ones as @scope/name. */
function packageNames(nodeModulesDir) {
  if (!existsSync(nodeModulesDir)) return [];
  return readdirSync(nodeModulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .flatMap((entry) =>
      entry.name.startsWith("@")
        ? readdirSync(path.join(nodeModulesDir, entry.name), { withFileTypes: true })
            .filter((scoped) => scoped.isDirectory())
            .map((scoped) => `${entry.name}/${scoped.name}`)
        : [entry.name],
    );
}

/** Every package folder below a node_modules folder, nested ones included. */
function packageDirs(nodeModulesDir) {
  return packageNames(nodeModulesDir).flatMap((name) => {
    const dir = dependencyDir(nodeModulesDir, name);
    return [dir, ...packageDirs(path.join(dir, "node_modules"))];
  });
}

/** The folder Node.js loads `dependency` from for the package in `dir`, searching up to `rootNodeModules`. */
function resolvedDir(dir, dependency, rootNodeModules) {
  for (let current = dir; ; current = path.dirname(current)) {
    const candidate = path.basename(current) === "node_modules" ? dependencyDir(current, dependency) : dependencyDir(path.join(current, "node_modules"), dependency);
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    if (current === rootNodeModules || current === path.dirname(rootNodeModules) || current === path.dirname(current)) return null;
  }
}

const dependenciesOf = (pkg) => ({ ...pkg.peerDependencies, ...pkg.optionalDependencies, ...pkg.dependencies });

/**
 * Fails the build when a package would load a dependency outside the range it asks for, as a relocation gone wrong
 * does. Packages the overrides pin are left out: they are outside some ranges on purpose.
 */
function verifyResolutions(bundleServerDir, overrides) {
  const semver = createRequire(path.join(path.dirname(process.execPath), "node_modules", "npm", "index.js"))("semver");
  const pinned = new Set(Object.keys(overrides).map((key) => key.replace(/(?<=.)@.*$/, "")));
  const bundleNodeModules = path.join(bundleServerDir, "node_modules");
  const broken = [];
  for (const dir of [bundleServerDir, ...packageDirs(bundleNodeModules)]) {
    const pkg = readPackage(dir);
    if (!pkg) continue;
    for (const [name, range] of Object.entries({ ...pkg.optionalDependencies, ...pkg.dependencies })) {
      if (pinned.has(name) || !semver.validRange(range)) continue;
      const found = resolvedDir(dir, name, bundleNodeModules);
      const version = found && readPackage(found)?.version;
      if (version && !semver.satisfies(version, range, { includePrerelease: true })) {
        broken.push(`${path.relative(bundleServerDir, dir)} wants ${name}@${range} and gets ${version}`);
      }
    }
  }
  if (broken.length > 0) {
    throw new Error(`Packages would load dependencies outside their range:\n  ${broken.join("\n  ")}`);
  }
  console.log("[prepare-server] Every dependency resolves within its range.");
}

function promoteServerRuntimeDependencies(serverPkgDir, bundleServerDir) {
  const serverPackageJson = JSON.parse(
    readFileSync(path.join(serverPkgDir, "package.json"), "utf8"),
  );
  const dependencies = Object.keys(serverPackageJson.dependencies ?? {}).sort();
  const bundleNodeModules = path.join(bundleServerDir, "node_modules");
  const relocated = path.join(bundleNodeModules, "@paperclipai", "server");
  const serverNodeModules = path.join(relocated, "node_modules");

  // The packaged server is relocated from node_modules/@paperclipai/server to
  // the bundle root. Recreate the module lookup environment it had before the
  // move: hoisted packages are already present, and nested packages must
  // overlay them because npm nested those versions intentionally. A hoisted
  // package they replace may still be what other hoisted packages resolve to,
  // in another major; those get the hoisted copy in a node_modules of their own.
  const replaced = packageNames(serverNodeModules).filter((name) => {
    const hoisted = readPackage(dependencyDir(bundleNodeModules, name));
    return hoisted && hoisted.version !== readPackage(dependencyDir(serverNodeModules, name))?.version;
  });
  // A copy can itself depend on another replaced package, so the search repeats until it copies nothing more.
  for (let copied = true; copied; ) {
    copied = false;
    const dependents = packageDirs(bundleNodeModules).filter((dir) => !dir.startsWith(relocated + path.sep) && dir !== relocated);
    for (const name of replaced) {
      const hoisted = dependencyDir(bundleNodeModules, name);
      for (const dir of dependents) {
        if (dir === hoisted || dir.startsWith(hoisted + path.sep) || !(name in dependenciesOf(readPackage(dir) ?? {}))) continue;
        if (resolvedDir(dir, name, bundleNodeModules) !== hoisted) continue;
        cpSync(hoisted, dependencyDir(path.join(dir, "node_modules"), name), { recursive: true });
        copied = true;
      }
    }
  }
  for (const name of replaced) {
    rmSync(dependencyDir(bundleNodeModules, name), { recursive: true, force: true });
  }
  if (replaced.length > 0) {
    console.log(`[prepare-server] Kept the hoisted version for its other dependents: ${replaced.join(", ")}`);
  }
  if (existsSync(serverNodeModules)) {
    cpSync(serverNodeModules, bundleNodeModules, { recursive: true, force: true });
  }

  const missing = dependencies.filter((dependency) => {
    const target = dependencyDir(bundleNodeModules, dependency);
    return !existsSync(path.join(target, "package.json"));
  });
  if (missing.length > 0) {
    throw new Error(
      `Installed @paperclipai/server is missing runtime dependencies: ${missing.join(", ")}`,
    );
  }

  console.log(
    `[prepare-server] Promoted the nested server dependency environment for root resolution (${dependencies.length} direct dependencies).`,
  );
}

const stagingDir = path.join(stagingRootDir, variant);
const bundleDir = path.join(bundleRootDir, variant);
const bundleServerDir = path.join(bundleDir, "server");

console.log(`[prepare-server] Installing runtime bundle for ${variant}...`);

mkdirSync(stagingDir, { recursive: true });
writeFileSync(
  path.join(stagingDir, "package.json"),
  JSON.stringify(
    {
      private: true,
      dependencies: {
        "@paperclipai/server": serverVersion,
        "@paperclipai/teams-catalog": teamsCatalogVersion,
      },
      overrides: serverBundleOverrides,
    },
    null,
    2,
  ),
);

// npm is npm.cmd on Windows, which Node only starts through a shell.
execFileSync(
  "npm",
  ["install", "--production", "--os=win32", `--cpu=${arch}`, `--arch=${arch}`],
  {
    cwd: stagingDir,
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      npm_config_arch: arch,
      npm_config_platform: "win32",
      npm_config_target_arch: arch,
    },
  },
);

console.log(`[prepare-server] Assembling server bundle for ${variant}...`);
mkdirSync(bundleServerDir, { recursive: true });

const serverPkgDir = path.join(stagingDir, "node_modules", "@paperclipai", "server");

cpSync(path.join(serverPkgDir, "dist"), path.join(bundleServerDir, "dist"), { recursive: true });
cpSync(path.join(serverPkgDir, "package.json"), path.join(bundleServerDir, "package.json"));

const skillsSrc = path.join(serverPkgDir, "skills");
if (existsSync(skillsSrc)) {
  cpSync(skillsSrc, path.join(bundleServerDir, "skills"), { recursive: true });
}

cpSync(path.join(stagingDir, "node_modules"), path.join(bundleServerDir, "node_modules"), { recursive: true });
promoteServerRuntimeDependencies(serverPkgDir, bundleServerDir);
// node_modules/.bin stays: the local adapters start their ACP servers (claude-agent-acp, codex-acp) from it.

validateMigrations(bundleServerDir);
verifyResolutions(bundleServerDir, serverBundleOverrides);
await import("./bundle-server.mjs");

const NODE_VERSION = "v24.21.0";
const nodeBinDir = path.join(projectRoot, "build", "node-bin");

const destDir = path.join(nodeBinDir, variant);
const destBin = path.join(destDir, "node.exe");
const versionMarker = path.join(destDir, ".node-version");
// Node.js asks for its license to travel with every copy of the runtime.
const destLicense = path.join(destDir, "LICENSE");

const cachedVersion = existsSync(versionMarker)
  ? readFileSync(versionMarker, "utf8").trim()
  : null;
if (existsSync(destBin) && existsSync(destLicense) && cachedVersion === NODE_VERSION) {
  console.log(`[prepare-server] Node ${NODE_VERSION} ${arch} already downloaded, skipping`);
} else {
  if (existsSync(destDir)) {
    console.log(
      `[prepare-server] Replacing cached Node ${cachedVersion ?? "of unknown version"} for ${arch}`,
    );
    rmSync(destDir, { recursive: true, force: true });
  }
  mkdirSync(destDir, { recursive: true });

  const archiveName = `node-${NODE_VERSION}-win-${arch}`;
  const url = `https://nodejs.org/dist/${NODE_VERSION}/${archiveName}.zip`;
  const archivePath = path.join(destDir, "node.zip");

  console.log(`[prepare-server] Downloading Node ${NODE_VERSION} for win-${arch}...`);

  // Paths go through the environment: with -Command, PowerShell does not fill $args.
  const download = { ...process.env, NODE_URL: url, NODE_ARCHIVE: archivePath, NODE_DEST: destDir };
  execFileSync(
    "powershell",
    ["-NoProfile", "-Command", "$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri $env:NODE_URL -OutFile $env:NODE_ARCHIVE"],
    { stdio: "inherit", env: download },
  );
  execFileSync(
    "powershell",
    ["-NoProfile", "-Command", "$ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path $env:NODE_ARCHIVE -DestinationPath $env:NODE_DEST -Force"],
    { stdio: "inherit", env: download },
  );
  cpSync(path.join(destDir, archiveName, "node.exe"), destBin);
  cpSync(path.join(destDir, archiveName, "LICENSE"), destLicense);
  rmSync(path.join(destDir, archiveName), { recursive: true, force: true });

  rmSync(archivePath, { force: true });
  writeFileSync(versionMarker, `${NODE_VERSION}\n`);
  console.log(`[prepare-server] Node ${NODE_VERSION} ${arch} ready at ${destBin}`);
}

/** Starts the server from `entry` as the app does, with data of its own, and tells whether it answered its health check. */
async function startsUp(entry) {
  const home = mkdtempSync(path.join(os.tmpdir(), "pc-start-"));
  const port = await new Promise((resolve) => {
    const probe = net.createServer().listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
  const child = spawn(destBin, [entry], {
    cwd: bundleServerDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      PAPERCLIP_HOME: home,
      PAPERCLIP_TEAMS_CATALOG_DIR: path.join(bundleServerDir, "node_modules", "@paperclipai", "teams-catalog"),
      PAPERCLIP_MIGRATION_AUTO_APPLY: "true",
      // The embedded PostgreSQL refuses to run as an administrator, which a CI runner's account is; there the test
      // uses the PostgreSQL of the runner image instead.
      ...(process.env.START_TEST_DATABASE_URL && { DATABASE_URL: process.env.START_TEST_DATABASE_URL }),
    },
  });
  // The server logs to stdout, so the reason it stopped can be on either stream.
  let errors = "";
  const keep = (chunk) => (errors = (errors + chunk).slice(-4000));
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  let exited = false;
  child.on("exit", () => (exited = true));
  let answered = false;
  for (let waited = 0; waited < 180 && !exited && !answered; waited += 2) {
    await new Promise((done) => setTimeout(done, 2000));
    answered = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.ok, () => false);
  }
  if (!exited) execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  // Ending the tree can leave a PostgreSQL worker behind, as the app's kill_stale_postgres knows; it names its binary with forward slashes.
  execFileSync(
    "powershell",
    ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='postgres.exe'\" | Where-Object { $_.CommandLine -like \"*$env:SERVER_DIR*\" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"],
    { stdio: "ignore", env: { ...process.env, SERVER_DIR: bundleServerDir.replaceAll(path.sep, "/") } },
  );
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  if (!answered) console.error(`[prepare-server] ${path.basename(entry)} did not start:\n${errors}`);
  return answered;
}

const bundle = path.join(bundleServerDir, "dist", "index.bundle.mjs");
// The app starts the bundle when it is there and dist/index.js otherwise, so a bundle that does not start must not ship.
if (existsSync(bundle) && !(await startsUp(bundle))) {
  console.warn("[prepare-server] Dropping the bundle; the app starts dist/index.js instead.");
  rmSync(bundle);
}
if (!existsSync(bundle) && !(await startsUp(path.join(bundleServerDir, "dist", "index.js")))) {
  throw new Error("The staged server does not start.");
}
console.log("[prepare-server] The staged server starts and answers its health check.");

console.log("[prepare-server] Cleaning up staging directories...");
rmSync(stagingRootDir, { recursive: true, force: true });

console.log("[prepare-server] Done.");
