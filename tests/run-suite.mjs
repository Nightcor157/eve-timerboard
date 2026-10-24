import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { projectRoot, startStaticServer } from "./helpers/server.mjs";

const suites = {
  smoke: [
    "tests/e2e/board-sorting.mjs",
    "tests/e2e/admin-view.mjs",
    "tests/e2e/history-clear.mjs",
    "tests/e2e/routes-access.mjs",
    "tests/e2e/fleet-key.mjs",
    "tests/e2e/general-route.mjs",
    "tests/e2e/commander-board.mjs"
  ],
  stress: ["tests/e2e/fleet-routing.stress.mjs"]
};

const suiteName = process.argv[2] || "smoke";
const files = suites[suiteName];
if (!files) throw new Error(`Unknown test suite: ${suiteName}`);

function runFile(file, baseURL) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [resolve(projectRoot, file)], {
      cwd: projectRoot,
      env: { ...process.env, E2E_BASE_URL: baseURL },
      stdio: "inherit"
    });
    child.on("exit", (code, signal) => resolveRun({ file, code: code ?? 1, signal }));
  });
}

const server = await startStaticServer();
const failures = [];
console.log(`Test server: ${server.baseURL}`);
try {
  for (const file of files) {
    const result = await runFile(file, server.baseURL);
    if (result.code !== 0) failures.push(result);
  }
} finally {
  await server.close();
}

if (failures.length) {
  for (const failure of failures) {
    console.error(`FAILED ${failure.file} (exit ${failure.code}${failure.signal ? `, ${failure.signal}` : ""})`);
  }
  process.exitCode = 1;
} else {
  console.log(`PASS ${suiteName} suite (${files.length} files)`);
}
