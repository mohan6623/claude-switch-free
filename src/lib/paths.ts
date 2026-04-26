import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const APP_DIR = path.join(os.homedir(), ".local", "share", "claude-switch")

const GITHUB_TOKEN_PATH = path.join(APP_DIR, "github_token")
const STARTUP_CONFIG_PATH = path.join(APP_DIR, "startup-config.json")
const ANALYTICS_DIR = path.join(APP_DIR, "analytics")

const DEFAULT_STARTUP_CONFIG = {
  version: 1,
  providers: [],
  activeProviderId: undefined,
}

export const PATHS = {
  APP_DIR,
  GITHUB_TOKEN_PATH,
  STARTUP_CONFIG_PATH,
  ANALYTICS_DIR,
}

export async function ensurePaths(): Promise<void> {
  await fs.mkdir(PATHS.APP_DIR, { recursive: true })
  await fs.mkdir(PATHS.ANALYTICS_DIR, { recursive: true })
  await ensureFile(PATHS.GITHUB_TOKEN_PATH)
  await ensureJsonFile(PATHS.STARTUP_CONFIG_PATH, DEFAULT_STARTUP_CONFIG)
}

async function ensureFile(filePath: string): Promise<void> {
  try {
    await fs.access(filePath, fs.constants.W_OK)
  } catch {
    await fs.writeFile(filePath, "")
    await fs.chmod(filePath, 0o600)
  }
}

async function ensureJsonFile(
  filePath: string,
  defaultValue: object,
): Promise<void> {
  try {
    await fs.access(filePath, fs.constants.W_OK)
  } catch {
    await fs.writeFile(filePath, JSON.stringify(defaultValue, null, 2))
    await fs.chmod(filePath, 0o600)
  }
}
