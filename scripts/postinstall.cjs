#!/usr/bin/env node
/**
 * PAAW postinstall — ensure emoji fonts are available on Linux.
 *
 * Ubuntu/Debian Chrome doesn't ship color emoji fonts by default.
 * This script installs `fonts-noto-color-emoji` via apt if needed.
 *
 * Safe to run on any platform — no-ops on macOS/Windows.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function isLinux() {
  return process.platform === "linux";
}

function hasApt() {
  try {
    execSync("which apt-get", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function emojiFontInstalled() {
  // Check common paths for Noto Color Emoji
  const checkPaths = [
    "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
    "/usr/local/share/fonts/NotoColorEmoji.ttf",
    "/usr/share/fonts/noto-cjk/NotoColorEmoji.ttf",
  ];
  // Also check fontconfig cache
  try {
    const result = execSync("fc-list : family style file 2>/dev/null || true", {
      encoding: "utf-8",
      timeout: 5000,
    });
    if (result.toLowerCase().includes("notocoloremoji")) return true;
  } catch {
    // fc-list not available, fall through to path check
  }
  return checkPaths.some((p) => {
    try { return fs.statSync(p).isFile(); } catch { return false; }
  });
}

function installEmojiFont() {
  if (!isLinux()) {
    console.log("[postinstall] Not Linux — skipping emoji font install.");
    return;
  }

  if (emojiFontInstalled()) {
    console.log("[postinstall] ✅ Noto Color Emoji already installed.");
    return;
  }

  if (!hasApt()) {
    console.log("[postinstall] ⚠️  No apt-get found. Install emoji fonts manually:");
    console.log("  sudo apt-get install -y fonts-noto-color-emoji");
    return;
  }

  console.log("[postinstall] 📦 Installing fonts-noto-color-emoji for Linux emoji support...");
  try {
    execSync("sudo apt-get install -y fonts-noto-color-emoji", {
      stdio: "inherit",
      timeout: 60000,
    });
    console.log("[postinstall] ✅ fonts-noto-color-emoji installed successfully.");

    // Refresh font cache
    try {
      execSync("fc-cache -f 2>/dev/null || true", { stdio: "ignore", timeout: 10000 });
    } catch {
      // Non-critical
    }
  } catch (err) {
    console.log("[postinstall] ⚠️  Could not install emoji fonts (need sudo?).");
    console.log("  Run manually: sudo apt-get install -y fonts-noto-color-emoji");
  }
}

installEmojiFont();
