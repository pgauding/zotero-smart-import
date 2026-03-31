/**
 * Post-build script: remove update_url from the built manifest.json
 * and repack the .xpi. The scaffold injects a default update_url that
 * points to a nonexistent file, causing Zotero to reject the add-on.
 */

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const buildDir = ".scaffold/build";
const manifestPath = join(buildDir, "addon/manifest.json");

// Fix manifest
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
if (manifest.applications?.zotero?.update_url) {
  delete manifest.applications.zotero.update_url;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log("Removed update_url from manifest.json");
}

// Repack .xpi (it's just a zip)
const xpiFiles = readdirSync(buildDir).filter((f) => f.endsWith(".xpi"));
if (xpiFiles.length > 0) {
  const xpiPath = join(buildDir, xpiFiles[0]);
  // Remove old xpi, rezip from addon dir
  execSync(`rm "${xpiPath}"`);
  execSync(`cd "${join(buildDir, "addon")}" && zip -r "../${xpiFiles[0]}" .`);
  console.log(`Repacked ${xpiFiles[0]}`);
}
