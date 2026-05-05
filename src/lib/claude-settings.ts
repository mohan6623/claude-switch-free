import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { normalizeModelSlots, type ModelSlots } from "./startup-wizard"

export type ClaudeSettingsSyncTarget = "local" | "global"

export const MANAGED_CLAUDE_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "DISABLE_NON_ESSENTIAL_MODEL_CALLS",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
] as const

const MANAGED_CLAUDE_ENV_KEY_SET = new Set<string>(MANAGED_CLAUDE_ENV_KEYS)

export interface ClaudeSettingsJson {
  env: Record<string, string>
  [key: string]: unknown
}

export type ClaudeSettingsInspection =
  | { status: "missing"; path: string }
  | { status: "invalid-json"; path: string }
  | { status: "loaded"; path: string; hasUnrelatedSettings: boolean }

export function resolveDefaultClaudeSettingsLocalPath(
  startDir: string,
): string {
  return path.join(path.resolve(startDir), ".claude", "settings.json")
}

export function hasUnrelatedClaudeSettings(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return false
  }

  const source = input as Record<string, unknown>

  if (Object.keys(source).some((key) => key !== "env")) {
    return true
  }

  if (
    !source.env
    || typeof source.env !== "object"
    || Array.isArray(source.env)
  ) {
    return false
  }

  return Object.keys(source.env as Record<string, unknown>).some(
    (key) => !MANAGED_CLAUDE_ENV_KEY_SET.has(key),
  )
}

export async function inspectClaudeSettingsGlobal(
  options: { homeDir?: string } = {},
): Promise<ClaudeSettingsInspection> {
  const settingsPath = resolveClaudeSettingsGlobalPath(options.homeDir)

  try {
    const raw = await fs.readFile(settingsPath, "utf8")
    if (!raw.trim()) {
      return {
        status: "loaded",
        path: settingsPath,
        hasUnrelatedSettings: false,
      }
    }

    const parsed = JSON.parse(raw) as unknown
    return {
      status: "loaded",
      path: settingsPath,
      hasUnrelatedSettings: hasUnrelatedClaudeSettings(parsed),
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT") {
      return {
        status: "missing",
        path: settingsPath,
      }
    }

    return {
      status: "invalid-json",
      path: settingsPath,
    }
  }
}

export async function inspectClaudeSettingsLocal(
  startDir: string,
): Promise<ClaudeSettingsInspection> {
  const baseDir = path.resolve(startDir)
  const localSettingsPath = path.join(baseDir, ".claude", "settings.local.json")
  const defaultSettingsPath = resolveDefaultClaudeSettingsLocalPath(baseDir)

  const settingsPath = await (async () => {
    if (await isReadableWritable(localSettingsPath)) {
      return localSettingsPath
    }
    if (await isReadableWritable(defaultSettingsPath)) {
      return defaultSettingsPath
    }
    return defaultSettingsPath
  })()

  try {
    const raw = await fs.readFile(settingsPath, "utf8")
    if (!raw.trim()) {
      return {
        status: "loaded",
        path: settingsPath,
        hasUnrelatedSettings: false,
      }
    }

    const parsed = JSON.parse(raw) as unknown
    return {
      status: "loaded",
      path: settingsPath,
      hasUnrelatedSettings: hasUnrelatedClaudeSettings(parsed),
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT") {
      return {
        status: "missing",
        path: settingsPath,
      }
    }

    return {
      status: "invalid-json",
      path: settingsPath,
    }
  }
}
export function shouldPromptBeforeSync(
  inspection: ClaudeSettingsInspection,
): boolean {
  return (
    inspection.status === "invalid-json"
    || (inspection.status === "loaded" && inspection.hasUnrelatedSettings)
  )
}

export function buildClaudeSettingsPromptMessage(
  inspection: ClaudeSettingsInspection,
): string {
  if (inspection.status === "invalid-json") {
    return `Existing Claude settings is invalid JSON at ${inspection.path}. Overwrite with proxy Claude env settings?`
  }

  return `Found existing unrelated Claude settings at ${inspection.path}. Merge proxy Claude env settings while preserving existing settings?`
}

export function buildClaudeSettingsSkipMessage(
  inspection: ClaudeSettingsInspection,
): string {
  if (inspection.status === "invalid-json") {
    return "Skipped Claude settings overwrite because existing settings JSON is invalid and overwrite was declined."
  }

  return "Skipped Claude settings merge because user chose not to modify existing unrelated settings."
}

export function buildClaudeSettingsDefaultPromptValue(
  inspection: ClaudeSettingsInspection,
): boolean {
  return inspection.status !== "invalid-json"
}

export function buildClaudeSettingsMissingInfo(
  inspection: ClaudeSettingsInspection,
): string {
  return `No existing local Claude settings found. A new settings file will be created at ${inspection.path}.`
}

export function buildClaudeSettingsSuccessMessage(path: string): string {
  return `Synced Claude settings: ${path}`
}

export function buildManagedClaudeEnvKeysLabel(): string {
  return MANAGED_CLAUDE_ENV_KEYS.join(", ")
}

export interface LoadedClaudeModelSlots {
  path: string
  slots: ModelSlots
}

export function mergeClaudeSettingsJson(
  input: unknown,
  envPatch: Record<string, string>,
): ClaudeSettingsJson {
  const source =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {}

  const existingEnv =
    source.env && typeof source.env === "object" ?
      (source.env as Record<string, unknown>)
    : {}

  const mergedEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(existingEnv)) {
    if (typeof value === "string") {
      mergedEnv[key] = value
    }
  }

  const result: Record<string, unknown> = { ...source }

  for (const [key, value] of Object.entries(envPatch)) {
    if (key === "ANTHROPIC_BASE_URL") {
      result.customApiUrl = value
    } else if (key === "ANTHROPIC_API_KEY" || key === "ANTHROPIC_AUTH_TOKEN") {
      result.customApiKey = value
    } else {
      mergedEnv[key] = value
    }
  }

  result.env = mergedEnv

  return result as ClaudeSettingsJson
}

export async function resolveClaudeSettingsLocalPath(
  startDir: string,
): Promise<string | undefined> {
  const candidates = resolveClaudeSettingsLocalCandidatePaths(startDir)

  for (const candidate of candidates) {
    if (await isReadableWritable(candidate)) {
      return candidate
    }
  }

  return undefined
}

export function resolveClaudeSettingsGlobalPath(homeDir?: string): string {
  return path.join(homeDir || os.homedir(), ".claude", "settings.json")
}

export async function loadClaudeModelSlotsForTarget(
  syncTarget: ClaudeSettingsSyncTarget,
  startDir: string,
  options: { homeDir?: string } = {},
): Promise<LoadedClaudeModelSlots | undefined> {
  const candidates =
    syncTarget === "global" ?
      resolveClaudeSettingsGlobalCandidatePaths(options.homeDir)
    : resolveClaudeSettingsLocalCandidatePaths(startDir)

  for (const candidate of candidates) {
    const slots = await readClaudeModelSlotsFromPath(candidate)
    if (slots) {
      return {
        path: candidate,
        slots,
      }
    }
  }

  return undefined
}

export async function syncClaudeSettingsLocal(
  startDir: string,
  envPatch: Record<string, string>,
): Promise<{ updated: boolean; path?: string }> {
  const settingsPath = await resolveClaudeSettingsLocalPath(startDir)
  if (!settingsPath) {
    return { updated: false }
  }

  return await syncClaudeSettingsPath(settingsPath, envPatch)
}

export async function syncClaudeSettingsGlobal(
  envPatch: Record<string, string>,
  options: { homeDir?: string } = {},
): Promise<{ updated: boolean; path?: string }> {
  const settingsPath = resolveClaudeSettingsGlobalPath(options.homeDir)
  await fs.mkdir(path.dirname(settingsPath), { recursive: true })
  return await syncClaudeSettingsPath(settingsPath, envPatch)
}

export async function syncClaudeSettingsPath(
  settingsPath: string,
  envPatch: Record<string, string>,
): Promise<{ updated: boolean; path?: string }> {
  const parsed = await (async (): Promise<unknown> => {
    try {
      const raw = await fs.readFile(settingsPath, "utf8")
      return raw.trim().length > 0 ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  })()

  const merged = mergeClaudeSettingsJson(parsed, envPatch)
  await fs.writeFile(settingsPath, JSON.stringify(merged, null, 2), "utf8")

  return {
    updated: true,
    path: settingsPath,
  }
}

export function resolveClaudeSettingsLocalCandidatePaths(
  startDir: string,
): Array<string> {
  const candidates: Array<string> = []
  let current = path.resolve(startDir)

  while (true) {
    candidates.push(
      path.join(current, ".claude", "settings.local.json"),
      path.join(current, ".claude", "settings.json"),
    )

    const parent = path.dirname(current)
    if (parent === current) {
      break
    }

    current = parent
  }

  return candidates
}

function resolveClaudeSettingsGlobalCandidatePaths(
  homeDir?: string,
): Array<string> {
  const home = homeDir || os.homedir()
  return [
    path.join(home, ".claude", "settings.json"),
    path.join(home, ".claude", "settings.local.json"),
  ]
}

async function isReadableWritable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fs.constants.R_OK | fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

async function readClaudeModelSlotsFromPath(
  filePath: string,
): Promise<ModelSlots | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8")
    if (!raw.trim()) {
      return undefined
    }

    const parsed = JSON.parse(raw) as unknown
    return extractModelSlotsFromClaudeSettingsJson(parsed)
  } catch {
    return undefined
  }
}

function extractModelSlotsFromClaudeSettingsJson(
  input: unknown,
): ModelSlots | undefined {
  if (!input || typeof input !== "object") {
    return undefined
  }

  const source = input as { env?: unknown }
  if (!source.env || typeof source.env !== "object") {
    return undefined
  }

  const env = source.env as Record<string, unknown>

  const defaultModel =
    readEnvString(env.ANTHROPIC_MODEL)
    || readEnvString(env.ANTHROPIC_DEFAULT_SONNET_MODEL)

  if (!defaultModel) {
    return undefined
  }

  try {
    return normalizeModelSlots({
      defaultModel,
      bigModel: readEnvString(env.ANTHROPIC_DEFAULT_OPUS_MODEL),
      sonnetModel: readEnvString(env.ANTHROPIC_DEFAULT_SONNET_MODEL),
      haikuModel:
        readEnvString(env.ANTHROPIC_DEFAULT_HAIKU_MODEL)
        || readEnvString(env.ANTHROPIC_SMALL_FAST_MODEL),
    })
  } catch {
    return undefined
  }
}

function readEnvString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
