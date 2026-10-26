#!/usr/bin/env node

/**
 * Installs @paperclipai/server from npm into a staging directory, then
 * assembles the server bundle and the Node.js binary the app ships with
 * (build/server-bundle/win-x64 and build/node-bin/win-x64).
 */

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
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

function promoteServerRuntimeDependencies(serverPkgDir, bundleServerDir) {
  const serverPackageJson = JSON.parse(
    readFileSync(path.join(serverPkgDir, "package.json"), "utf8"),
  );
  const dependencies = Object.keys(serverPackageJson.dependencies ?? {}).sort();
  const serverNodeModules = path.join(serverPkgDir, "node_modules");
  const bundleNodeModules = path.join(bundleServerDir, "node_modules");

  // The packaged server is relocated from node_modules/@paperclipai/server to
  // the bundle root. Recreate the module lookup environment it had before the
  // move: hoisted packages are already present, and nested packages must
  // overlay them because npm nested those versions intentionally.
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

console.log("[prepare-server] Cleaning up staging directories...");
rmSync(stagingRootDir, { recursive: true, force: true });

console.log("[prepare-server] Done.");
