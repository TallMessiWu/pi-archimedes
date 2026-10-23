import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const host = process.env.PI_TEST_HOST_DIR
  ?? dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
const sandbox = mkdtempSync(join(tmpdir(), "pi-early-production-"));

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: sandbox, stdio: "inherit", env: { ...process.env, ...env },
    shell: process.platform === "win32", timeout: 120_000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed`);
}

try {
  for (const path of ["package.json", "package-lock.json", "packages/core/package.json",
    "packages/core/src", "packages/session-name/src"]) {
    cpSync(join(root, path), join(sandbox, path), { recursive: true });
  }
  // With no registry access, only the core directory in this checkout can be installed.
  run("npm", ["ci", "--offline", "--omit=dev", "--legacy-peer-deps",
    "--ignore-scripts", "--no-audit", "--no-fund"]);
  const installed = readdirSync(join(sandbox, "node_modules"))
    .filter(name => !name.startsWith(".") && readdirSync(join(sandbox, "node_modules", name)).length);
  assert.deepEqual(installed, ["@pi-archimedes"]);
  assert.deepEqual(readdirSync(join(sandbox, "node_modules/@pi-archimedes")), ["core"]);
  assert.equal(existsSync(join(sandbox, "packages/core/node_modules/@earendil-works/pi-coding-agent")), false);
  const core = JSON.parse(readFileSync(join(sandbox, "node_modules/@pi-archimedes/core/package.json"), "utf8"));
  assert.equal(core.name, "@pi-archimedes/core");
  run(process.execPath, ["--test", "packages/session-name/src/index.test.mjs"], {
    PI_TEST_HOST_DIR: host,
  });
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
