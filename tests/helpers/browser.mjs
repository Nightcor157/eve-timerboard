import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { projectRoot } from "./server.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

export const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:8765";
const artifactsDir = resolve(projectRoot, "tests/artifacts");

export function launchBrowser() {
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  return chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {})
  });
}

export async function blockExternalRequests(page) {
  const localOrigin = new URL(baseURL).origin;
  await page.route("**/*", (route) => {
    const requestOrigin = new URL(route.request().url()).origin;
    return requestOrigin === localOrigin ? route.continue() : route.abort();
  });
}

export async function runBrowserTest(name, callback, options = {}) {
  await mkdir(artifactsDir, { recursive: true });
  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1440, height: 950 },
    permissions: options.permissions || []
  });
  const browserErrors = [];
  const capturePageErrors = (currentPage) => {
    currentPage.on("pageerror", (error) => browserErrors.push(error.message));
  };
  context.on("page", capturePageErrors);
  const page = await context.newPage();

  try {
    await callback({ page, context, browserErrors });
    assert.deepEqual(browserErrors, [], `Browser errors in ${name}`);
    console.log(`PASS ${name}`);
  } catch (error) {
    const safeName = name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
    try {
      await page.screenshot({ path: resolve(artifactsDir, `${safeName}.png`), fullPage: true });
    } catch {
      // Keep the original test failure when the page cannot be captured.
    }
    console.error(`FAIL ${name}`);
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}
