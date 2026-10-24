import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { projectRoot } from "./helpers/server.mjs";

const ignoredDirectories = new Set([".git", "node_modules", "tests/artifacts"]);

async function collect(directory, relativeDirectory = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(relativePath) || ignoredDirectories.has(entry.name)) continue;
      files.push(...await collect(join(directory, entry.name), relativePath));
    } else if (/\.(?:js|mjs)$/i.test(entry.name)) {
      files.push(relativePath);
    }
  }
  return files;
}

const files = await collect(projectRoot);
const failures = [];
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: projectRoot,
    encoding: "utf8"
  });
  if (result.status !== 0) failures.push(`${file}\n${result.stderr || result.stdout}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`PASS syntax (${files.length} files)`);
}
