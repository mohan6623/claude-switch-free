import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { normalizeModelSlots, type ModelSlots } from "./startup-wizard"

export type ClaudeSettingsSyncTarget = "local" | "global"

export interface ClaudeSettingsJson {
  env: Record<string, string>
  [key: string]: unknown
}

export interface LoadedClaudeModelSlots {
  path: string
  slots: ModelSlots
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
  const candidates = syncTarget === "global"
    ? resolveClaudeSettingsGlobalCandidatePaths(options.homeDir)
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

async function syncClaudeSettingsPath(
  settingsPath: string,
  envPatch: Record<string, string>,
): Promise<{ updated: boolean; path?: string }> {
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

function resolveClaudeSettingsLocalCandidatePaths(startDir: string): Array<string> {
  const candidates: Array<string> = []
  let current = path.resolve(startDir)

  while (true) {
    candidates.push(path.join(current, ".claude", "settings.local.json"))
    candidates.push(path.join(current, ".claude", "settings.json"))

    const parent = path.dirname(current)
    if (parent === current) {
      break
    }

    current = parent
  }

  return candidates
}

function resolveClaudeSettingsGlobalCandidatePaths(homeDir?: string): Array<string> {
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
