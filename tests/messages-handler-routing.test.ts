import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { Hono } from "hono"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { StartupConfig } from "../src/lib/startup-config"

import { PATHS } from "../src/lib/paths"
import { state } from "../src/lib/state"
import { handleCompletion } from "../src/routes/messages/handler"

const originalFetch = globalThis.fetch
const originalStartupConfigPath = PATHS.STARTUP_CONFIG_PATH
const originalProvider = state.provider
const originalRateLimitSeconds = state.rateLimitSeconds
const originalManualApprove = state.manualApprove
const originalCopilotToken = state.copilotToken

describe("messages handler routed provider override", () => {
  beforeEach(() => {
    state.provider = {
      id: "copilot",
      mode: "copilot",
    }
    state.rateLimitSeconds = undefined
    state.manualApprove = false
    state.copilotToken = undefined
  })

  afterEach(() => {
    PATHS.STARTUP_CONFIG_PATH = originalStartupConfigPath
    state.provider = originalProvider
    state.rateLimitSeconds = originalRateLimitSeconds
    state.manualApprove = originalManualApprove
    state.copilotToken = originalCopilotToken
    ;(globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch
  })

  test("routes cpapi-route model through configured provider override", async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "cpapi-route-test-"),
    )
    PATHS.STARTUP_CONFIG_PATH = path.join(tempDir, "startup-config.json")

    const startupConfig: StartupConfig = {
      version: 1,
      activeProviderId: "openrouter",
      providers: [
        {
          id: "openrouter",
          label: "OpenRouter",
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: "sk-openrouter",
          isPreset: true,
          updatedAt: "2026-04-07T00:00:00.000Z",
          modelSlots: {
            defaultModel: "qwen/qwen3.6-plus:free",
            bigModel: "qwen/qwen3.6-plus:free",
            sonnetModel: "qwen/qwen3.6-plus:free",
            haikuModel: "qwen/qwen3.6-plus:free",
          },
        },
      ],
    }
    await fs.writeFile(
      PATHS.STARTUP_CONFIG_PATH,
      JSON.stringify(startupConfig, null, 2),
      "utf8",
    )

    const fetchMock = mock((_url: string, _init: RequestInit) =>
      Promise.resolve(
        Response.json({
          id: "chatcmpl-1",
          object: "chat.completion",
          created: 0,
          model: "gpt-4o",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "ok",
              },
              logprobs: null,
              finish_reason: "stop",
            },
          ],
        }),
      ),
    )
    ;(globalThis as unknown as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch

    const app = new Hono()
    app.post("/v1/messages", handleCompletion)

    const response = await app.request("/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "cpapi-route:openrouter::gpt-4o",
        messages: [{ role: "user", content: "hello" }],
        max_tokens: 64,
      }),
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const call = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(call[0]).toBe("https://openrouter.ai/api/v1/chat/completions")

    const headers = call[1].headers as Record<string, string>
    expect(headers.authorization).toBe("Bearer sk-openrouter")
  })
})
