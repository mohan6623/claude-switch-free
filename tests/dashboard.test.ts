import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { PATHS } from "../src/lib/paths"
import { state } from "../src/lib/state"
import { server } from "../src/server"

const originalFetch = globalThis.fetch
const originalStartupConfigPath = PATHS.STARTUP_CONFIG_PATH
const originalAnalyticsDir = PATHS.ANALYTICS_DIR
const originalProvider = state.provider
const originalModels = state.models

describe("dashboard routes", () => {
  beforeEach(async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-api-dashboard-test-"))
    PATHS.STARTUP_CONFIG_PATH = path.join(tempDir, "startup-config.json")
    PATHS.ANALYTICS_DIR = path.join(tempDir, "analytics")

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
              baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
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
  })

  afterEach(() => {
    PATHS.STARTUP_CONFIG_PATH = originalStartupConfigPath
    PATHS.ANALYTICS_DIR = originalAnalyticsDir
    state.provider = originalProvider
    state.models = originalModels
    ;(globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch
  })

  test("serves dashboard html from same server", async () => {
    const response = await server.request("/dashboard")

    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain("copilot-api dashboard")
    expect(html).toContain("Live Request Log")
    expect(html).toContain("/dashboard/app.js")
  })

  test("serves dashboard frontend module script", async () => {
    const response = await server.request("/dashboard/app.js")

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("application/javascript")

    const script = await response.text()
    expect(script).toContain("/dashboard/api/config")
    expect(script).toContain("/dashboard/api/summary")
    expect(script).toContain("/dashboard/api/usage/daily")
    expect(script).toContain("/dashboard/api/requests?limit=50")
    expect(script).toContain("/dashboard/api/slots/")
    expect(script).toContain("/usage")
    expect(script).toContain("visibilitychange")
    expect(script).toContain("setInterval")
    expect(script).toContain("5000")
  })

  test("returns Jan-compatible dashboard models list", async () => {
    const response = await server.request("/dashboard/api/models")
    expect(response.status).toBe(200)

    const payload = (await response.json()) as {
      data: Array<{
        id: string
        name: string
        provider: string
        copilotPro: boolean
        supportsTools: boolean
      }>
    }

    expect(payload.data.length).toBeGreaterThan(0)
    expect(payload.data[0]?.id).toBe("gemini-3.1-pro")
    expect(payload.data[0]?.name).toBe("gemini-3.1-pro")
    expect(payload.data[0]?.provider).toBe("google")
    expect(payload.data[0]?.copilotPro).toBe(true)
    expect(payload.data[0]?.supportsTools).toBe(true)
  })

  test("returns dashboard bootstrap payload for Jan-style frontend", async () => {
    const response = await server.request("/dashboard/api/bootstrap")
    expect(response.status).toBe(200)

    const payload = (await response.json()) as {
      app: {
        mode: string
      }
      modelSlots: {
        defaultModel: string
        bigModel: string
        sonnetModel: string
        haikuModel: string
      }
      models: {
        data: Array<{ id: string }>
      }
    }

    expect(payload.app.mode).toBe("browser")
    expect(payload.modelSlots.defaultModel).toBe("gemini-3.1-pro")
    expect(payload.modelSlots.haikuModel).toBe("gemini-2.0-flash")
    expect(payload.models.data.some((model) => model.id === "gemini-2.0-flash")).toBe(true)
  })

  test("routes Jan-style chat adapter requests through existing completion pipeline", async () => {
    const fetchMock = mock((_url: string, _init: RequestInit) =>
      Promise.resolve(
        Response.json({
          id: "chatcmpl-jan-1",
          object: "chat.completion",
          created: 0,
          model: "gemini-3.1-pro",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "hello from adapter",
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

    const response = await server.request("/dashboard/api/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-3.1-pro",
        messages: [{ role: "user", content: "Say hi" }],
        stream: false,
      }),
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const payload = (await response.json()) as {
      id: string
      choices: Array<{ message: { role: string; content: string | null } }>
    }
    expect(payload.id).toBe("chatcmpl-jan-1")
    expect(payload.choices[0]?.message.role).toBe("assistant")
    expect(payload.choices.length).toBe(1)
  })

  test("supports Jan-style streaming chat adapter calls", async () => {
    const streamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{\"id\":\"chunk-1\"}\n"))
        controller.close()
      },
    })

    const fetchMock = mock((_url: string, _init: RequestInit) =>
      Promise.resolve(
        new Response(streamBody, {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
          },
        }),
      ),
    )

    ;(globalThis as unknown as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch

    const response = await server.request("/dashboard/api/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-3.1-pro",
        messages: [{ role: "user", content: "Stream hi" }],
        stream: true,
      }),
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const body = await response.text()
    expect(body).toContain("\"id\":\"chunk-1\"")
    expect(body).toContain("data: [DONE]")
  })

  test("returns dashboard config with redacted provider details", async () => {
    const response = await server.request("/dashboard/api/config")
    expect(response.status).toBe(200)

    const payload = (await response.json()) as {
      activeProvider: {
        id: string
        label: string
        apiKeyConfigured: boolean
        apiKey?: string
      }
      slots: {
        defaultModel: string
      }
      availableModels: Array<string>
    }

    expect(payload.activeProvider.id).toBe("gemini")
    expect(payload.activeProvider.apiKeyConfigured).toBe(true)
    expect(payload.activeProvider.apiKey).toBeUndefined()
    expect(payload.slots.defaultModel).toBe("gemini-3.1-pro")
    expect(payload.availableModels).toContain("gemini-2.0-flash")
  })

  test("updates selected slot model", async () => {
    const patchResponse = await server.request("/dashboard/api/slots/haikuModel", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-3.1-pro",
      }),
    })

    expect(patchResponse.status).toBe(200)

    const configResponse = await server.request("/dashboard/api/config")
    const payload = (await configResponse.json()) as {
      slots: {
        haikuModel: string
      }
    }

    expect(payload.slots.haikuModel).toBe("gemini-3.1-pro")
  })

  test("returns analytics views from metadata logs", async () => {
    await fs.mkdir(PATHS.ANALYTICS_DIR, { recursive: true })
    const day = new Date().toISOString().slice(0, 10)

    await fs.writeFile(
      path.join(PATHS.ANALYTICS_DIR, `${day}.jsonl`),
      `${JSON.stringify({
        id: "evt-1",
        timestamp: new Date().toISOString(),
        route: "chat/completions",
        providerId: "gemini",
        model: "gemini-3.1-pro",
        statusCode: 200,
        latencyMs: 120,
        stream: false,
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        tokenSource: "api_usage",
      })}\n`,
      "utf8",
    )

    const [requestsRes, dailyRes, summaryRes] = await Promise.all([
      server.request("/dashboard/api/requests?limit=10"),
      server.request("/dashboard/api/usage/daily?days=30&groupBy=model"),
      server.request("/dashboard/api/summary"),
    ])

    expect(requestsRes.status).toBe(200)
    expect(dailyRes.status).toBe(200)
    expect(summaryRes.status).toBe(200)

    const requests = (await requestsRes.json()) as { requests: Array<{ model: string; totalTokens: number }> }
    const daily = (await dailyRes.json()) as { days: Array<{ date: string; totalTokens: number }> }
    const summary = (await summaryRes.json()) as { insights: Array<string> }

    expect(requests.requests[0]?.model).toBe("gemini-3.1-pro")
    expect(requests.requests[0]?.totalTokens).toBe(150)
    expect(daily.days.some((row) => row.date === day && row.totalTokens === 150)).toBe(true)
    expect(summary.insights[0]).toContain("Today you used")
  })

  test("manages dashboard conversations via Jan-style endpoints", async () => {
    const createResponse = await server.request("/dashboard/api/conversations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "First chat",
      }),
    })

    expect(createResponse.status).toBe(201)
    const created = (await createResponse.json()) as {
      id: string
      title: string
      messages: Array<unknown>
    }

    expect(created.id.length).toBeGreaterThan(0)
    expect(created.title).toBe("First chat")
    expect(created.messages.length).toBe(0)

    const listResponse = await server.request("/dashboard/api/conversations")
    expect(listResponse.status).toBe(200)
    const listPayload = (await listResponse.json()) as {
      conversations: Array<{ id: string; title: string }>
    }
    expect(listPayload.conversations.some((item) => item.id === created.id)).toBe(true)

    const renameResponse = await server.request(`/dashboard/api/conversations/${created.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Renamed chat",
      }),
    })

    expect(renameResponse.status).toBe(200)
    const renamed = (await renameResponse.json()) as { title: string }
    expect(renamed.title).toBe("Renamed chat")

    const messagesResponse = await server.request(`/dashboard/api/conversations/${created.id}/messages`)
    expect(messagesResponse.status).toBe(200)
    const messagesPayload = (await messagesResponse.json()) as {
      conversationId: string
      messages: Array<unknown>
    }
    expect(messagesPayload.conversationId).toBe(created.id)
    expect(messagesPayload.messages.length).toBe(0)

    const deleteResponse = await server.request(`/dashboard/api/conversations/${created.id}`, {
      method: "DELETE",
    })

    expect(deleteResponse.status).toBe(200)

    const listAfterDeleteResponse = await server.request("/dashboard/api/conversations")
    const listAfterDelete = (await listAfterDeleteResponse.json()) as {
      conversations: Array<{ id: string }>
    }
    expect(listAfterDelete.conversations.some((item) => item.id === created.id)).toBe(false)
  })

  test("gets and updates dashboard settings", async () => {
    const getResponse = await server.request("/dashboard/api/settings")
    expect(getResponse.status).toBe(200)

    const initial = (await getResponse.json()) as {
      theme: string
      sendKey: string
      telemetryEnabled: boolean
    }

    expect(initial.theme).toBe("system")
    expect(initial.sendKey).toBe("enter")

    const putResponse = await server.request("/dashboard/api/settings", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        theme: "dark",
        sendKey: "ctrlEnter",
        telemetryEnabled: true,
      }),
    })

    expect(putResponse.status).toBe(200)

    const updated = (await putResponse.json()) as {
      theme: string
      sendKey: string
      telemetryEnabled: boolean
    }

    expect(updated.theme).toBe("dark")
    expect(updated.sendKey).toBe("ctrlEnter")
    expect(updated.telemetryEnabled).toBe(true)
  })

  test("rejects invalid slot id", async () => {
    const response = await server.request("/dashboard/api/slots/unknownSlot", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "gemini-3.1-pro" }),
    })

    expect(response.status).toBe(400)
  })

  test("rejects model not in available model list", async () => {
    const response = await server.request("/dashboard/api/slots/defaultModel", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "not-a-real-model" }),
    })

    expect(response.status).toBe(400)
  })
})
