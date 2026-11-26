#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const register = pathToFileURL(join(here, "register-ts.mjs")).href;
// Unit tests must not read the developer's real ~/.pi/agent config (e.g. enterprise routing).
const isUnitTest = /(^|[\\/])test-[^\\/]*$/.test(process.argv[2] ?? "");
const env =
  isUnitTest && !process.env.PI_CODING_AGENT_DIR
    ? { ...process.env, PI_CODING_AGENT_DIR: mkdtempSync(join(tmpdir(), "pi-agent-test-")) }
    : process.env;
const result = spawnSync(
  process.execPath,
  [
    "--experimental-strip-types",
    "--disable-warning=ExperimentalWarning",
    "--disable-warning=DEP0205",
    `--import=${register}`,
    ...process.argv.slice(2),
  ],
  { stdio: "inherit", env },
);
process.exit(result.status ?? 1);
