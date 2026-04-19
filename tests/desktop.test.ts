/* eslint-disable max-lines-per-function */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { PATHS } from "../src/lib/paths"
import { state } from "../src/lib/state"
import { server } from "../src/server"

const originalStartupConfigPath = PATHS.STARTUP_CONFIG_PATH
const originalAnalyticsDir = PATHS.ANALYTICS_DIR
const originalGitHubTokenPath = PATHS.GITHUB_TOKEN_PATH
const originalProvider = state.provider
const originalModels = state.models
const originalGitHubToken = state.githubToken
const originalCopilotToken = state.copilotToken

describe("desktop routes", () => {
  beforeEach(async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "copilot-api-desktop-test-"),
    )

    PATHS.STARTUP_CONFIG_PATH = path.join(tempDir, "startup-config.json")
    PATHS.ANALYTICS_DIR = path.join(tempDir, "analytics")
    PATHS.GITHUB_TOKEN_PATH = path.join(tempDir, "github_token")

    await fs.writeFile(
      PATHS.STARTUP_CONFIG_PATH,
      JSON.stringify(
        {
          version: 1,
          activeProviderId: "gemini",
          providers: [
            {
              id: "gemini",
              label: "Google Gemini",
              baseUrl:
                "https://generativelanguage.googleapis.com/v1beta/openai",
              apiKey: "gm-secret-key",
              isPreset: true,
              requestHandlingMode: "balanced",
              modelSlots: {
                defaultModel: "gemini-3.1-pro",
                bigModel: "gemini-3.1-pro",
                sonnetModel: "gemini-3.1-pro",
                haikuModel: "gemini-2.0-flash",
              },
              updatedAt: "2026-04-09T00:00:00.000Z",
            },
            {
              id: "openrouter",
              label: "OpenRouter",
              baseUrl: "https://openrouter.ai/api/v1",
              apiKey: "or-secret-key",
              isPreset: true,
              requestHandlingMode: "balanced",
              modelSlots: {
                defaultModel: "openrouter/auto",
                bigModel: "openrouter/auto",
                sonnetModel: "openrouter/auto",
                haikuModel: "openrouter/auto",
              },
              updatedAt: "2026-04-09T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    )

    state.provider = {
      id: "gemini",
      mode: "openai-compatible",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: "gm-secret-key",
      preferredModel: "gemini-3.1-pro",
      preferredSmallModel: "gemini-2.0-flash",
    }

    state.models = {
      object: "list",
      data: [
        {
          id: "gemini-3.1-pro",
          object: "model",
          name: "gemini-3.1-pro",
          vendor: "google",
          version: "unknown",
          preview: false,
          model_picker_enabled: true,
          capabilities: {
            family: "google",
            object: "model_capabilities",
            type: "chat",
            tokenizer: "o200k_base",
            limits: {
              max_context_window_tokens: 128000,
              max_output_tokens: 16384,
            },
            supports: {
              tool_calls: true,
            },
          },
        },
        {
          id: "gemini-2.0-flash",
          object: "model",
          name: "gemini-2.0-flash",
          vendor: "google",
          version: "unknown",
          preview: false,
          model_picker_enabled: true,
          capabilities: {
            family: "google",
            object: "model_capabilities",
            type: "chat",
            tokenizer: "o200k_base",
            limits: {
              max_context_window_tokens: 128000,
              max_output_tokens: 8192,
            },
            supports: {
              tool_calls: true,
            },
          },
        },
      ],
    }

    state.githubToken = "gh-test"
    state.copilotToken = "cp-test"
  })

  afterEach(() => {
    PATHS.STARTUP_CONFIG_PATH = originalStartupConfigPath
    PATHS.ANALYTICS_DIR = originalAnalyticsDir
    PATHS.GITHUB_TOKEN_PATH = originalGitHubTokenPath
    state.provider = originalProvider
    state.models = originalModels
    state.githubToken = originalGitHubToken
    state.copilotToken = originalCopilotToken
  })

  test("returns desktop status payload", async () => {
    const response = await server.request("/desktop/status")
    expect(response.status).toBe(200)

    const payload = (await response.json()) as {
      app: { mode: string }
      proxy: { providerId: string }
      auth: { hasGitHubToken: boolean; hasCopilotToken: boolean }
      runtime: { mode: string }
    }

    expect(payload.app.mode).toBe("desktop-integration")
    expect(payload.proxy.providerId).toBe("gemini")
    expect(payload.auth.hasGitHubToken).toBe(true)
    expect(payload.auth.hasCopilotToken).toBe(true)
    expect(["terminal", "desktop-managed"]).toContain(payload.runtime.mode)
  })

  test("returns desktop config summary", async () => {
    const response = await server.request("/desktop/config")
    expect(response.status).toBe(200)

    const payload = (await response.json()) as {
      providers: Array<{
        id: string
        apiKeyConfigured: boolean
        enabled: boolean
      }>
      activeProviderId: string
      availableModels: Array<string>
      configRevision: string
    }

    expect(payload.providers.length).toBe(2)
    expect(payload.providers[0]?.apiKeyConfigured).toBe(true)
    expect(payload.providers.every((provider) => provider.enabled)).toBe(true)
    expect(payload.activeProviderId).toBe("gemini")
    expect(payload.availableModels).toContain("gemini-2.0-flash")
    expect(payload.configRevision).toContain("gemini")
    expect(payload.configRevision).toContain("openrouter")
  })

  test("returns env-backed provider api key in desktop config summary", async () => {
    process.env.OPENCODE_API_KEY = "env-opencode-key"

    const existing = JSON.parse(
      await fs.readFile(PATHS.STARTUP_CONFIG_PATH),
    ) as {
      version: number
      activeProviderId: string
      providers: Array<Record<string, unknown>>
    }

    existing.providers.push({
      id: "opencode",
      label: "OpenCode",
      baseUrl: "https://opencode.ai/zen/v1",
      apiKey: "",
      isPreset: true,
      requestHandlingMode: "balanced",
      updatedAt: "2026-04-09T00:00:00.000Z",
    })

    await fs.writeFile(
      PATHS.STARTUP_CONFIG_PATH,
      JSON.stringify(existing, null, 2),
      "utf8",
    )

    const response = await server.request("/desktop/config")
    expect(response.status).toBe(200)

    const payload = (await response.json()) as {
      providers: Array<{
        id: string
        apiKeyConfigured: boolean
        apiKey?: string
      }>
    }

    const opencode = payload.providers.find(
      (provider) => provider.id === "opencode",
    )
    expect(opencode).toBeDefined()
    expect(opencode?.apiKeyConfigured).toBe(true)
    expect(opencode?.apiKey).toBe("env-opencode-key")

    delete process.env.OPENCODE_API_KEY
  })

  test("switches active provider via desktop config endpoint", async () => {
    const response = await server.request("/desktop/config/active-provider", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: "openrouter" }),
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      activeProviderId: string
      providers: Array<{ id: string }>
      configRevision: string
    }
    expect(payload.activeProviderId).toBe("openrouter")
    expect(
      payload.providers.some((provider) => provider.id === "openrouter"),
    ).toBe(true)
    expect(payload.configRevision).toContain("openrouter")

    expect(state.provider.id).toBe("openrouter")
    expect(state.provider.mode).toBe("openai-compatible")
    expect(state.provider.baseUrl).toBe("https://openrouter.ai/api/v1")

    const updatedRaw = await fs.readFile(PATHS.STARTUP_CONFIG_PATH)
    const updated = JSON.parse(updatedRaw) as { activeProviderId: string }
    expect(updated.activeProviderId).toBe("openrouter")
  })

  test("updates slot mapping via desktop config endpoint", async () => {
    const response = await server.request("/desktop/config/slots/haikuModel", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gemini-3.1-pro" }),
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      slots: { haikuModel: string }
      activeProviderId: string
      configRevision: string
    }
    expect(payload.slots.haikuModel).toBe("gemini-3.1-pro")
    expect(payload.activeProviderId).toBe("gemini")
    expect(payload.configRevision).toContain("gemini")

    expect(state.provider.id).toBe("gemini")
    expect(state.provider.preferredSmallModel).toBe("gemini-3.1-pro")
    expect(state.provider.mode).toBe("openai-compatible")
  })

  test("applies dashboard slot updates to runtime provider without restart", async () => {
    const response = await server.request("/dashboard/api/slots/defaultModel", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gemini-2.0-flash" }),
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      slotId: string
      model: string
      slots: { defaultModel: string }
    }

    expect(payload.slotId).toBe("defaultModel")
    expect(payload.model).toBe("gemini-2.0-flash")
    expect(payload.slots.defaultModel).toBe("gemini-2.0-flash")

    expect(state.provider.id).toBe("gemini")
    expect(state.provider.preferredModel).toBe("gemini-2.0-flash")
  })

  test("logs out desktop auth state", async () => {
    const response = await server.request("/desktop/auth/logout", {
      method: "POST",
    })

    expect(response.status).toBe(200)

    const statusResponse = await server.request("/desktop/auth/status")
    const statusPayload = (await statusResponse.json()) as {
      hasGitHubToken: boolean
      hasCopilotToken: boolean
    }

    expect(statusPayload.hasGitHubToken).toBe(false)
    expect(statusPayload.hasCopilotToken).toBe(false)
  })
})
