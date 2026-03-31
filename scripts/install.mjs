/**
 * Install the built .xpi directly into the Zotero extensions directory.
 *
 * Zotero's "Install Add-on From File" dialog sometimes fails to persist
 * the .xpi across restarts. This script copies the .xpi to the extensions
 * directory with the correct filename, which is the reliable way to install
 * a permanent extension in Firefox/Zotero.
 *
 * Usage: node scripts/install.mjs
 */

import { copyFileSync, existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { execSync } from "child_process";
import { homedir, platform } from "os";

const ADDON_ID = "zotero-smart-import@patrickgauding.com";
const XPI_NAME = "smart-import-for-zotero.xpi";
const BUILD_DIR = resolve(".scaffold/build");

// Locate Zotero profiles directory per platform
function getProfilesDir() {
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(home, "Library/Application Support/Zotero/Profiles");
    case "linux":
      return join(home, ".zotero/zotero");
    case "win32":
      return join(home, "AppData/Roaming/Zotero/Zotero/Profiles");
    default:
      return null;
  }
}

// Parse profiles.ini to find the default profile directory
function findDefaultProfile(profilesDir) {
  // profiles.ini lives in the Zotero app data root, one level above Profiles/
  const zoteroRoot = join(profilesDir, "..");
  const iniPath = join(zoteroRoot, "profiles.ini");
  if (!existsSync(iniPath)) {
    // Fallback: look for any .default directory
    const dirs = readdirSync(profilesDir).filter((d) => d.endsWith(".default"));
    if (dirs.length > 0) return join(profilesDir, dirs[0]);
    return null;
  }

  const ini = readFileSync(iniPath, "utf-8");
  const sections = ini.split(/\[Profile\d+\]/);

  for (const section of sections) {
    const isDefault =
      section.includes("Default=1") || section.includes("Default=true");
    const pathMatch = section.match(/Path=(.+)/);
    const isRelative = section.includes("IsRelative=1");

    if (pathMatch) {
      const profilePath = isRelative
        ? join(zoteroRoot, pathMatch[1].trim())
        : pathMatch[1].trim();

      if (isDefault && existsSync(profilePath)) {
        return profilePath;
      }
    }
  }

  // No explicit default — just use the first profile with an extensions dir
  for (const section of sections) {
    const pathMatch = section.match(/Path=(.+)/);
    const isRelative = section.includes("IsRelative=1");
    if (pathMatch) {
      const profilePath = isRelative
        ? join(zoteroRoot, pathMatch[1].trim())
        : pathMatch[1].trim();
      if (existsSync(join(profilePath, "extensions"))) {
        return profilePath;
      }
    }
  }

  return null;
}

// Check if Zotero is running
function isZoteroRunning() {
  try {
    const result = execSync(
      "pgrep -x zotero 2>/dev/null || pgrep -f Zotero.app 2>/dev/null",
      {
        encoding: "utf-8",
      },
    );
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

// Main
const xpiSource = join(BUILD_DIR, XPI_NAME);
if (!existsSync(xpiSource)) {
  console.error(`Error: ${xpiSource} not found. Run 'npm run build' first.`);
  process.exit(1);
}

const profilesDir = getProfilesDir();
if (!profilesDir || !existsSync(profilesDir)) {
  console.error(
    "Error: Could not find Zotero profiles directory.",
    `Looked for: ${profilesDir}`,
  );
  process.exit(1);
}

const profileDir = await findDefaultProfile(profilesDir);
if (!profileDir) {
  console.error(
    "Error: Could not find a Zotero profile with an extensions directory.",
  );
  process.exit(1);
}

const extDir = join(profileDir, "extensions");
const dest = join(extDir, `${ADDON_ID}.xpi`);

if (isZoteroRunning()) {
  console.warn(
    "Warning: Zotero is currently running. Quit Zotero before installing, then reopen it.",
  );
}

copyFileSync(xpiSource, dest);
console.log(`Installed: ${dest}`);
console.log("Restart Zotero to load the plugin.");
