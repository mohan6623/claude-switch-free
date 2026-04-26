import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { PATHS } from "../src/lib/paths"
import {
  clearProviderModelSlots,
  getActiveProviderProfile,
  loadStartupConfig,
  removeProviderProfile,
  saveStartupConfig,
  setActiveProvider,
  upsertProviderProfile,
  type StartupConfig,
} from "../src/lib/startup-config"

const originalPath = PATHS.STARTUP_CONFIG_PATH

afterEach(() => {
  PATHS.STARTUP_CONFIG_PATH = originalPath
})

describe("startup config persistence", () => {
  test("loads empty config when file is missing", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-switch-startup-config-"))
    PATHS.STARTUP_CONFIG_PATH = path.join(tempDir, "startup-config.json")

    const config = await loadStartupConfig()

    expect(config).toEqual<StartupConfig>({
      version: 1,
      providers: [],
      activeProviderId: undefined,
    })
  })

  test("saves and reloads provider profile with model slots", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-switch-startup-config-"))
    PATHS.STARTUP_CONFIG_PATH = path.join(tempDir, "startup-config.json")

    const initial = await loadStartupConfig()
    const withProfile = upsertProviderProfile(initial, {
      id: "opencode",
      label: "OpenCode",
      baseUrl: "https://opencode.ai/zen/v1",
      apiKey: "sk-test",
      apiKeyUrl: "https://opencode.ai/settings/keys",
      isPreset: true,
      requestHandlingMode: "resilient",
      modelSlots: {
        defaultModel: "qwen3.6-plus-free",
        bigModel: "gpt-5.4",
        sonnetModel: "qwen3.6-plus-free",
        haikuModel: "qwen3.6-plus-free",
      },
      updatedAt: "2026-04-07T00:00:00.000Z",
    })

    await saveStartupConfig(withProfile)
    const reloaded = await loadStartupConfig()

    expect(reloaded.providers).toHaveLength(1)
    expect(reloaded.providers[0]?.id).toBe("opencode")
    expect(reloaded.providers[0]?.modelSlots?.bigModel).toBe("gpt-5.4")
    expect(reloaded.providers[0]?.requestHandlingMode).toBe("resilient")
  })

  test("defaults request handling mode to balanced for legacy provider configs", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-switch-startup-config-"))
    PATHS.STARTUP_CONFIG_PATH = path.join(tempDir, "startup-config.json")

    const legacyConfig = {
      version: 1,
      activeProviderId: "opencode",
      providers: [
        {
          id: "opencode",
          label: "OpenCode",
          baseUrl: "https://opencode.ai/zen/v1",
          apiKey: "sk-test",
          isPreset: true,
          updatedAt: "2026-04-07T00:00:00.000Z",
        },
      ],
    }

    await fs.writeFile(
      PATHS.STARTUP_CONFIG_PATH,
      JSON.stringify(legacyConfig, null, 2),
      "utf8",
    )

    const reloaded = await loadStartupConfig()
    expect(reloaded.providers[0]?.requestHandlingMode).toBe("balanced")
  })

  test("upsert replaces existing provider with same id", () => {
    const empty: StartupConfig = { version: 1, providers: [] }

    const first = upsertProviderProfile(empty, {
      id: "custom-work",
      label: "Custom Work",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-1",
      isPreset: false,
      updatedAt: "2026-04-07T00:00:00.000Z",
    })

    const second = upsertProviderProfile(first, {
      id: "custom-work",
      label: "Custom Work",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-2",
      isPreset: false,
      modelSlots: {
        defaultModel: "model-a",
        bigModel: "model-b",
        sonnetModel: "model-c",
        haikuModel: "model-d",
      },
      updatedAt: "2026-04-07T01:00:00.000Z",
    })

    expect(second.providers).toHaveLength(1)
    expect(second.providers[0]?.apiKey).toBe("sk-2")
    expect(second.providers[0]?.modelSlots?.defaultModel).toBe("model-a")
  })

  test("sets active provider and resolves active profile", () => {
    const empty: StartupConfig = { version: 1, providers: [] }

    const withA = upsertProviderProfile(empty, {
      id: "opencode",
      label: "OpenCode",
      baseUrl: "https://opencode.ai/zen/v1",
      apiKey: "sk-a",
      isPreset: true,
      updatedAt: "2026-04-07T00:00:00.000Z",
    })

    const withB = upsertProviderProfile(withA, {
      id: "openrouter",
      label: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-b",
      isPreset: true,
      updatedAt: "2026-04-07T01:00:00.000Z",
    })

    const activeSet = setActiveProvider(withB, "openrouter")

    expect(activeSet.activeProviderId).toBe("openrouter")
    expect(getActiveProviderProfile(activeSet)?.id).toBe("openrouter")
  })

  test("removes provider and reassigns active provider", () => {
    const base: StartupConfig = {
      version: 1,
      activeProviderId: "openrouter",
      providers: [
        {
          id: "openrouter",
          label: "OpenRouter",
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: "sk-or",
          isPreset: true,
          updatedAt: "2026-04-09T00:00:00.000Z",
        },
        {
          id: "gemini",
          label: "Google Gemini (OpenAI-compatible)",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
          apiKey: "sk-gm",
          isPreset: true,
          updatedAt: "2026-04-09T00:00:01.000Z",
        },
      ],
    }

    const removed = removeProviderProfile(base, "openrouter")

    expect(removed.providers).toHaveLength(1)
    expect(removed.providers[0]?.id).toBe("gemini")
    expect(removed.activeProviderId).toBe("gemini")
  })

  test("clears model slots for selected provider", () => {
    const base: StartupConfig = {
      version: 1,
      activeProviderId: "gemini",
      providers: [
        {
          id: "gemini",
          label: "Google Gemini (OpenAI-compatible)",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
          apiKey: "sk-gm",
          isPreset: true,
          modelSlots: {
            defaultModel: "gemini-2.0-flash",
            bigModel: "gemini-2.5-pro",
            sonnetModel: "gemini-2.0-flash",
            haikuModel: "gemini-2.0-flash",
          },
          updatedAt: "2026-04-09T00:00:00.000Z",
        },
      ],
    }

    const cleared = clearProviderModelSlots(base, "gemini")

    expect(cleared.providers).toHaveLength(1)
    expect(cleared.providers[0]?.id).toBe("gemini")
    expect(cleared.providers[0]?.modelSlots).toBeUndefined()
    expect(cleared.activeProviderId).toBe("gemini")
  })
})
