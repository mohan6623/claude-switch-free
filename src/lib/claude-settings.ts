import fs from "node:fs/promises"
import path from "node:path"

export interface ClaudeSettingsJson {
  env: Record<string, string>
  [key: string]: unknown
}

export function mergeClaudeSettingsJson(
  input: unknown,
  envPatch: Record<string, string>,
): ClaudeSettingsJson {
  const source = input && typeof input === "object"
    ? (input as Record<string, unknown>)
    : {}

  const existingEnv = source.env && typeof source.env === "object"
    ? (source.env as Record<string, unknown>)
    : {}

  const mergedEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(existingEnv)) {
    if (typeof value === "string") {
      mergedEnv[key] = value
    }
  }

  for (const [key, value] of Object.entries(envPatch)) {
    mergedEnv[key] = value
  }

  return {
    ...source,
    env: mergedEnv,
  }
}

export async function resolveClaudeSettingsLocalPath(
  startDir: string,
): Promise<string | undefined> {
  let current = path.resolve(startDir)

  while (true) {
    const candidate = path.join(current, ".claude", "settings.local.json")
    try {
      await fs.access(candidate, fs.constants.R_OK | fs.constants.W_OK)
      return candidate
    } catch {
      // keep walking up
    }

    const parent = path.dirname(current)
    if (parent === current) {
      return undefined
    }

    current = parent
  }
}

export async function syncClaudeSettingsLocal(
  startDir: string,
  envPatch: Record<string, string>,
): Promise<{ updated: boolean; path?: string }> {
  const settingsPath = await resolveClaudeSettingsLocalPath(startDir)
  if (!settingsPath) {
    return { updated: false }
  }

  let parsed: unknown = {}
  try {
    const raw = await fs.readFile(settingsPath, "utf8")
    parsed = raw.trim().length > 0 ? JSON.parse(raw) : {}
  } catch {
    parsed = {}
  }

  const merged = mergeClaudeSettingsJson(parsed, envPatch)
  await fs.writeFile(settingsPath, JSON.stringify(merged, null, 2), "utf8")

  return {
    updated: true,
    path: settingsPath,
  }
}
