import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import type { ChatCompletionsPayload } from "../src/services/copilot/create-chat-completions"

import { state } from "../src/lib/state"
import { createChatCompletions } from "../src/services/copilot/create-chat-completions"

const originalFetch = globalThis.fetch

function installFetchMock(
  implementation: (url: string, init: RequestInit) => Response,
) {
  const fetchMock = mock((url: string, init: RequestInit) =>
    Promise.resolve(implementation(url, init)),
  )

  ;(globalThis as unknown as { fetch: typeof fetch }).fetch =
    fetchMock as unknown as typeof fetch

  return fetchMock
}

function buildSuccessResponse(model: string): Response {
  return Response.json({
    id: "123",
    object: "chat.completion",
    created: 0,
    model,
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
  })
}

describe("createChatCompletions", () => {
  beforeEach(() => {
    state.copilotToken = "test-token"
    state.vsCodeVersion = "1.0.0"
    state.accountType = "individual"
    state.provider = {
      id: "copilot",
      mode: "copilot",
    }
  })

  afterEach(() => {
    ;(globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch
  })

  test("sets X-Initiator to agent if tool/assistant present", async () => {
    const fetchMock = installFetchMock((_url, init) => {
      const headers = init.headers as Record<string, string>
      return new Response(
        JSON.stringify({ id: "123", object: "chat.completion", choices: [] }),
        {
          status: 200,
          headers,
        },
      )
    })

    const payload: ChatCompletionsPayload = {
      messages: [
        { role: "user", content: "hi" },
        { role: "tool", content: "tool call" },
      ],
      model: "gpt-test",
    }

    await createChatCompletions(payload)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const firstCall = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = firstCall[1].headers as Record<string, string> | undefined
    expect(headers?.["X-Initiator"]).toBe("agent")
  })

  test("sets X-Initiator to user if only user present", async () => {
    const fetchMock = installFetchMock((_url, init) => {
      const headers = init.headers as Record<string, string>
      return new Response(
        JSON.stringify({ id: "123", object: "chat.completion", choices: [] }),
        {
          status: 200,
          headers,
        },
      )
    })

    const payload: ChatCompletionsPayload = {
      messages: [
        { role: "user", content: "hi" },
        { role: "user", content: "hello again" },
      ],
      model: "gpt-test",
    }

    await createChatCompletions(payload)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const firstCall = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = firstCall[1].headers as Record<string, string> | undefined
    expect(headers?.["X-Initiator"]).toBe("user")
  })

  test("retries provider request without images when model is non-multimodal", async () => {
    state.provider = {
      id: "opencode",
      mode: "openai-compatible",
      baseUrl: "https://opencode.ai/zen/v1",
      apiKey: "sk-provider",
    }

    const capturedBodies: Array<ChatCompletionsPayload> = []
    let attempt = 0
    const fetchMock = installFetchMock((url, init) => {
      expect(url).toBe("https://opencode.ai/zen/v1/chat/completions")

      const body = init.body as string
      capturedBodies.push(JSON.parse(body) as ChatCompletionsPayload)

      if (attempt === 0) {
        attempt = attempt + 1
        return Response.json(
          {
            error: {
              message:
                '{"error":{"message":"/config/models/kimi_k2 is not a multimodal model","type":"BadRequestError","param":null,"code":400}}',
              type: "error",
            },
          },
          { status: 400 },
        )
      }

      return buildSuccessResponse("kimi_k2")
    })

    const payload: ChatCompletionsPayload = {
      model: "kimi_k2",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this" },
            {
              type: "image_url",
              image_url: {
                url: "data:image/png;base64,ZmFrZS1pbWFnZS1kYXRh",
              },
            },
          ],
        },
      ],
    }

    await createChatCompletions(payload)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const first = capturedBodies[0]?.messages[0]?.content
    const second = capturedBodies[1]?.messages[0]?.content

    expect(Array.isArray(first)).toBe(true)
    expect(Array.isArray(second)).toBe(true)

    if (!Array.isArray(first) || !Array.isArray(second)) {
      throw new TypeError(
        "Expected message content arrays in captured payloads",
      )
    }

    expect(first.some((part) => part.type === "image_url")).toBe(true)
    expect(second.some((part) => part.type === "image_url")).toBe(false)
    expect(second.some((part) => part.type === "text")).toBe(true)
  })
})
