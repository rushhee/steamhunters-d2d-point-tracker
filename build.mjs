#!/usr/bin/env node
// Builds dist/ from extension/: the Chrome zip, the Firefox zip and the userscript. No dependencies.
//   node build.mjs
// The version comes from extension/manifest.json; bump it there for userscript managers to pick up an update.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SLUG = "steamhunters-d2d-point-tracker";
const REPO = `https://github.com/rushhee/${SLUG}`;
const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, "extension");
const dist = join(root, "dist");
const read = (file, dir = src) => readFileSync(join(dir, file), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const { version } = manifest;

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
const stage = mkdtempSync(join(tmpdir(), "shpt-build-"));
const copyExtension = (to) => cpSync(src, to, { recursive: true, filter: (p) => !p.endsWith(".DS_Store") });

// Windows 10+ ships bsdtar, which writes zips; macOS and Linux have Info-ZIP (-X: no extended attributes).
function zip(out, cwd, entries) {
  if (process.platform === "win32") execFileSync("tar", ["-a", "-cf", out, ...entries], { cwd });
  else execFileSync("zip", ["-qrX", out, ...entries], { cwd });
}

try {
  // Chrome: a folder to "Load unpacked".
  copyExtension(join(stage, SLUG));
  zip(join(dist, `${SLUG}-v${version}.zip`), stage, [SLUG]);

  // Firefox: no service workers, so background.scripts, plus a gecko ID. Files sit at the zip root.
  const ff = join(stage, "firefox");
  copyExtension(ff);
  writeFileSync(join(ff, "manifest.json"), JSON.stringify({
    ...manifest,
    background: { scripts: ["background.js"], type: "module" },
    browser_specific_settings: {
      gecko: { id: "steamhunters-d2d@paziin.com", strict_min_version: "128.0", data_collection_permissions: { required: ["none"] } },
    },
  }, null, 2) + "\n");
  zip(join(dist, `${SLUG}-v${version}-firefox.zip`), ff, readdirSync(ff));
} finally {
  rmSync(stage, { recursive: true, force: true });
}

// Userscript: the extension sources wrapped unchanged around a chrome.* shim (userscript/shim.js).
// tracker.js is an ES module, so its exports and background.js's import of it are flattened into one scope.
const download = `${REPO}/releases/latest/download/${SLUG}.user.js`;
const icon = `data:image/png;base64,${readFileSync(join(src, "icons/icon48.png")).toString("base64")}`;
const tracker = read("tracker.js").replace(/^export /gm, "");
const background = read("background.js").replace(/^import .*\n/m, "");
const userscript = `// ==UserScript==
// @name         ${manifest.name}
// @namespace    ${REPO}
// @version      ${version}
// @description  ${manifest.description}
// @homepageURL  ${REPO}
// @supportURL   ${REPO}/issues
// @downloadURL  ${download}
// @updateURL    ${download}
// @icon         ${icon}
// @match        https://steamhunters.com/*
// @connect      steamcommunity.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  GM_addStyle(${JSON.stringify(read("panel.css"))});
  const ICON = ${JSON.stringify(icon)};

  // ---- userscript/shim.js ----
${read("shim.js", join(root, "userscript"))}
  // ---- tracker.js + background.js ----
  ((chrome, fetch) => {
${tracker}
${background}
  })(backgroundChrome, shFetch);

  // ---- render.js ----
${read("render.js")}
  // ---- report-view.js ----
${read("report-view.js")}
  // ---- content.js ----
  ((chrome) => {
${read("content.js")}
  })(contentChrome);
})();
`;
writeFileSync(join(dist, `${SLUG}.user.js`), userscript);

console.log(`Built v${version}:\n${readdirSync(dist).map((f) => `  dist/${f}`).join("\n")}`);
