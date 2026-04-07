import fs from "node:fs/promises"
import path from "node:path"

import { PATHS } from "~/lib/paths"

import type { ModelSlots } from "./startup-wizard"

export interface ProviderProfile {
  id: string
  label: string
  baseUrl: string
  apiKey: string
  apiKeyUrl?: string
  isPreset: boolean
  modelSlots?: ModelSlots
  updatedAt: string
}

export interface StartupConfig {
  version: 1
  providers: Array<ProviderProfile>
  activeProviderId?: string
}

const DEFAULT_STARTUP_CONFIG: StartupConfig = {
  version: 1,
  providers: [],
  activeProviderId: undefined,
}

export function defaultStartupConfig(): StartupConfig {
  return {
    version: 1,
    providers: [],
    activeProviderId: undefined,
  }
}

export async function loadStartupConfig(): Promise<StartupConfig> {
  try {
    const raw = await fs.readFile(PATHS.STARTUP_CONFIG_PATH, "utf8")
    if (!raw.trim()) {
      return defaultStartupConfig()
    }

    return sanitizeStartupConfig(JSON.parse(raw))
  } catch {
    return defaultStartupConfig()
  }
}

export async function saveStartupConfig(config: StartupConfig): Promise<void> {
  await fs.mkdir(path.dirname(PATHS.STARTUP_CONFIG_PATH), { recursive: true })
  await fs.writeFile(
    PATHS.STARTUP_CONFIG_PATH,
    JSON.stringify(sanitizeStartupConfig(config), null, 2),
    "utf8",
  )
}

export function upsertProviderProfile(
  config: StartupConfig,
  profile: ProviderProfile,
): StartupConfig {
  const sanitized = sanitizeStartupConfig(config)
  const filtered = sanitized.providers.filter((item) => item.id !== profile.id)

  return {
    ...sanitized,
    providers: [...filtered, profile],
    activeProviderId: sanitized.activeProviderId || profile.id,
  }
}

export function setActiveProvider(
  config: StartupConfig,
  providerId: string,
): StartupConfig {
  const sanitized = sanitizeStartupConfig(config)

  if (!sanitized.providers.some((provider) => provider.id === providerId)) {
    return sanitized
  }

  return {
    ...sanitized,
    activeProviderId: providerId,
  }
}

export function getProviderProfile(
  config: StartupConfig,
  providerId: string,
): ProviderProfile | undefined {
  return sanitizeStartupConfig(config).providers.find(
    (provider) => provider.id === providerId,
  )
}

export function getActiveProviderProfile(
  config: StartupConfig,
): ProviderProfile | undefined {
  const sanitized = sanitizeStartupConfig(config)

  if (sanitized.activeProviderId) {
    const active = sanitized.providers.find(
      (provider) => provider.id === sanitized.activeProviderId,
    )
    if (active) {
      return active
    }
  }

  return [...sanitized.providers].sort((a, b) => {
    const aTime = new Date(a.updatedAt).getTime()
    const bTime = new Date(b.updatedAt).getTime()
    return bTime - aTime
  })[0]
}

function sanitizeStartupConfig(input: unknown): StartupConfig {
  if (!input || typeof input !== "object") {
    return DEFAULT_STARTUP_CONFIG
  }

  const source = input as {
    version?: number
    providers?: Array<ProviderProfile>
    activeProviderId?: string
  }

  if (!Array.isArray(source.providers)) {
    return DEFAULT_STARTUP_CONFIG
  }

  const providers = source.providers.filter((provider) => {
    if (!provider || typeof provider !== "object") {
      return false
    }

    return (
      typeof provider.id === "string"
      && typeof provider.label === "string"
      && typeof provider.baseUrl === "string"
      && typeof provider.apiKey === "string"
      && typeof provider.isPreset === "boolean"
      && typeof provider.updatedAt === "string"
    )
  })

  return {
    version: 1,
    providers,
    activeProviderId:
      typeof source.activeProviderId === "string"
        ? source.activeProviderId
        : undefined,
  }
}
