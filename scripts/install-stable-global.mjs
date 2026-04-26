#!/usr/bin/env node

import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const cwd = process.cwd()

function shellQuote(value) {
  const text = String(value)

  if (/^[a-zA-Z0-9_./:@=+-]+$/.test(text)) {
    return text
  }

  return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function run(
  command,
  args,
) {
  const commandLine = [command, ...args.map(shellQuote)].join(" ")

  return execSync(commandLine, {
    cwd,
    stdio: "pipe",
    encoding: "utf8",
    shell: true,
  })
}

function runStreaming(command, args) {
  const commandLine = [command, ...args.map(shellQuote)].join(" ")

  execSync(commandLine, {
    cwd,
    stdio: "inherit",
    encoding: "utf8",
    shell: true,
  })
}

function info(message) {
  console.log(`[stable] ${message}`)
}

function warn(message) {
  console.warn(`[stable] ${message}`)
}

function readPackFileName(packOutput) {
  const lines = String(packOutput || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  return lines.at(-1)
}

function uninstallGlobalIfPresent() {
  try {
    runStreaming("npm", ["uninstall", "-g", "claude-switch"])
  } catch {
    // Global package may not exist yet; ignore.
  }
}

function assertStandaloneInstall() {
  const tree = run("npm", ["ls", "-g", "claude-switch", "--depth=0"])

  if (tree.includes("->")) {
    warn("Global install still looks linked to a local folder. Run `npm unlink -g claude-switch` and retry.")
    console.log(tree.trim())
    process.exitCode = 1
    return
  }

  info("Global install is standalone (not linked).")
  console.log(tree.trim())
}

function main() {
  info("Building project dist for stable snapshot...")
  runStreaming("npm", ["run", "build"])

  info("Packing npm tarball...")
  const packOutput = run("npm", ["pack", "--silent"])
  const tarballName = readPackFileName(packOutput)

  if (!tarballName) {
    throw new Error("npm pack did not return a tarball name")
  }

  const tarballPath = path.resolve(cwd, tarballName)

  try {
    info("Removing existing global installation/link (if any)...")
    uninstallGlobalIfPresent()

    info(`Installing ${tarballName} globally as stable snapshot...`)
    runStreaming("npm", ["install", "-g", tarballPath])

    assertStandaloneInstall()
    info("Stable snapshot install complete. You can run `claude-switch` from any directory.")
  } finally {
    if (fs.existsSync(tarballPath)) {
      fs.unlinkSync(tarballPath)
    }
  }
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[stable] Failed to install stable snapshot: ${message}`)
  process.exitCode = 1
}
