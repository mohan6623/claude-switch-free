import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import type { ChatCompletionsPayload } from "../src/services/copilot/create-chat-completions"

import { HTTPError } from "../src/lib/error"
import { state } from "../src/lib/state"
import { createChatCompletions } from "../src/services/copilot/create-chat-completions"

const originalFetch = globalThis.fetch

function resetStateForTests() {
  state.copilotToken = "test-token"
  state.vsCodeVersion = "1.0.0"
  state.accountType = "individual"
  state.provider = {
    id: "copilot",
    mode: "copilot",
  }
}

function restoreFetchForTests() {
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch
}

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

function buildUnsupportedApiForModelResponse(): Response {
  return Response.json(
    {
      error: {
        message:
          '{"error":{"message":"model \\\"gpt-5.3-codex\\\" is not accessible via the /chat/completions endpoint","code":"unsupported_api_for_model"}}\n',
        type: "error",
      },
    },
    { status: 400 },
  )
}

function buildModelNotSupportedResponse(): Response {
  return Response.json(
    {
      error: {
        message: "The requested model is not supported.",
        code: "model_not_supported",
        param: "model",
        type: "invalid_request_error",
      },
    },
    { status: 400 },
  )
}

function buildGeminiNativeTextResponse(): Response {
  return Response.json({
    responseId: "gemini_resp_1",
    modelVersion: "gemini-3.1-pro-preview",
    candidates: [
      {
        content: {
          role: "model",
          parts: [{ text: "ok" }],
        },
        finishReason: "STOP",
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount: 4,
      candidatesTokenCount: 1,
      totalTokenCount: 5,
    },
  })
}

function buildGeminiNativeToolCallResponse(): Response {
  return Response.json({
    responseId: "gemini_resp_tool_1",
    modelVersion: "gemini-3.1-pro-preview",
    candidates: [
      {
        content: {
          role: "model",
          parts: [
            {
              functionCall: {
                name: "search_web",
                args: { query: "latest ai news" },
              },
            },
          ],
        },
        finishReason: "STOP",
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount: 12,
      candidatesTokenCount: 2,
      totalTokenCount: 14,
    },
  })
}

function buildGeminiNativeToolCallWithThoughtSignatureResponse(): Response {
  return Response.json({
    responseId: "gemini_resp_tool_2",
    modelVersion: "gemini-3.1-pro-preview",
    candidates: [
      {
        content: {
          role: "model",
          parts: [
            {
              functionCall: {
                name: "get_weather",
                args: { city: "London" },
              },
              thoughtSignature: "sig+/=value",
            },
          ],
        },
        finishReason: "STOP",
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 3,
      totalTokenCount: 13,
    },
  })
}

function buildGeminiNativeToolCallWithTopLevelThoughtSignatureResponse(): Response {
  return Response.json({
    responseId: "gemini_resp_tool_3",
    modelVersion: "gemini-3.1-pro-preview",
    candidates: [
      {
        content: {
          role: "model",
          parts: [
            {
              functionCall: {
                name: "get_weather",
                args: { city: "London" },
              },
              thoughtSignature: "sig-top-level",
            },
          ],
        },
        finishReason: "STOP",
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 3,
      totalTokenCount: 13,
    },
  })
}

describe("createChatCompletions core behavior", () => {
  beforeEach(resetStateForTests)

  afterEach(restoreFetchForTests)

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

  test("allows concurrent requests for the same session id", async () => {
    state.provider = {
      id: "opencode",
      mode: "openai-compatible",
      baseUrl: "https://opencode.ai/zen/v1",
      apiKey: "sk-provider",
    }

    let releaseFirstRequest: (() => void) | undefined
    const firstRequestGate = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve
    })

    const fetchMock = mock((url: string) => {
      expect(url).toBe("https://opencode.ai/zen/v1/chat/completions")
      return firstRequestGate.then(() => buildSuccessResponse("kimi_k2"))
    })

    ;(globalThis as unknown as { fetch: typeof fetch }).fetch =
      fetchMock as unknown as typeof fetch

    const payload: ChatCompletionsPayload = {
      model: "kimi_k2",
      messages: [{ role: "user", content: "hello" }],
    }

    const firstRequest = createChatCompletions(
      payload,
      undefined,
      { sessionId: "session-123" },
    )

    const secondRequest = createChatCompletions(
      payload,
      undefined,
      { sessionId: "session-123" },
    )

    releaseFirstRequest?.()

    const [firstResponse, secondResponse] = await Promise.all([
      firstRequest,
      secondRequest,
    ])

    expect(Object.hasOwn(firstResponse, "choices")).toBe(true)
    expect(Object.hasOwn(secondResponse, "choices")).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
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

  test("retries copilot request without images when media type is unsupported", async () => {
    const capturedBodies: Array<ChatCompletionsPayload> = []
    let attempt = 0
    const fetchMock = installFetchMock((url, init) => {
      expect(url.endsWith("/chat/completions")).toBe(true)

      const body = init.body as string
      capturedBodies.push(JSON.parse(body) as ChatCompletionsPayload)

      if (attempt === 0) {
        attempt = attempt + 1
        return Response.json(
          {
            error: {
              message: "validating image item: image media type not supported",
              code: "invalid_request_body",
            },
          },
          { status: 400 },
        )
      }

      return buildSuccessResponse("minimax/m2.5")
    })

    const payload: ChatCompletionsPayload = {
      model: "minimax/m2.5",
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

  test("retries provider request after dropping unsupported top-level field", async () => {
    state.provider = {
      id: "opencode",
      mode: "openai-compatible",
      baseUrl: "https://opencode.ai/zen/v1",
      apiKey: "sk-provider",
    }

    const capturedBodies: Array<Record<string, unknown>> = []
    let attempt = 0
    const fetchMock = installFetchMock((url, init) => {
      expect(url).toBe("https://opencode.ai/zen/v1/chat/completions")

      const body = init.body as string
      capturedBodies.push(JSON.parse(body) as Record<string, unknown>)

      if (attempt === 0) {
        attempt = attempt + 1
        return Response.json(
          {
            error: {
              message: "Unsupported parameter: response_format",
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
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: "hello" }],
    }

    await createChatCompletions(payload)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(capturedBodies[0]).toBeDefined()
    expect(capturedBodies[1]).toBeDefined()

    expect(capturedBodies[0]?.response_format).toEqual({
      type: "json_object",
    })
    expect(capturedBodies[1]?.response_format).toBeUndefined()
  })

  test("falls back to /responses when Copilot rejects model on /chat/completions", async () => {
    const capturedFallbackBodies: Array<Record<string, unknown>> = []

    const fetchMock = installFetchMock((url, init) => {
      if (url.endsWith("/chat/completions")) {
        return buildUnsupportedApiForModelResponse()
      }

      if (url.endsWith("/responses")) {
        capturedFallbackBodies.push(
          JSON.parse(init.body as string) as Record<string, unknown>,
        )

        return Response.json({
          id: "resp_123",
          model: "gpt-5.3-codex",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: "responses fallback ok",
                },
              ],
            },
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 5,
            total_tokens: 17,
          },
        })
      }

      throw new Error(`Unexpected request URL: ${url}`)
    })

    const payload: ChatCompletionsPayload = {
      model: "gpt-5.3-codex",
      messages: [{ role: "user", content: "hello" }],
    }

    const response = await createChatCompletions(payload)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    expect(Object.hasOwn(response, "choices")).toBe(true)
    if (!Object.hasOwn(response, "choices")) {
      throw new Error("Expected non-streaming chat completion response")
    }

    const nonStreaming = response as {
      choices: Array<{ message: { content: string | null } }>
      model: string
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
      }
    }

    expect(nonStreaming.choices[0]?.message.content).toBe("responses fallback ok")
    expect(nonStreaming.model).toBe("gpt-5.3-codex")
    expect(nonStreaming.usage?.prompt_tokens).toBe(12)
    expect(nonStreaming.usage?.completion_tokens).toBe(5)

    expect(capturedFallbackBodies).toHaveLength(1)
    expect(capturedFallbackBodies[0]?.model).toBe("gpt-5.3-codex")
    expect(capturedFallbackBodies[0]?.stream).toBe(false)

    const fallbackInput = capturedFallbackBodies[0]?.input
    expect(Array.isArray(fallbackInput)).toBe(true)

    if (!Array.isArray(fallbackInput)) {
      throw new Error("Expected responses fallback payload input array")
    }

    const firstItem = fallbackInput[0] as {
      role?: string
      content?: Array<{ type?: string; text?: string }>
    }

    expect(firstItem.role).toBe("user")
    expect(firstItem.content?.[0]?.type).toBe("input_text")
    expect(firstItem.content?.[0]?.text).toBe("hello")
  })

  test("maps assistant history to output_text for /responses fallback", async () => {
    const capturedFallbackBodies: Array<Record<string, unknown>> = []

    const fetchMock = installFetchMock((url, init) => {
      if (url.endsWith("/chat/completions")) {
        return buildUnsupportedApiForModelResponse()
      }

      if (url.endsWith("/responses")) {
        capturedFallbackBodies.push(
          JSON.parse(init.body as string) as Record<string, unknown>,
        )

        return Response.json({
          id: "resp_456",
          model: "gpt-5.3-codex",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "ok" }],
            },
          ],
          usage: {
            input_tokens: 8,
            output_tokens: 1,
            total_tokens: 9,
          },
        })
      }

      throw new Error(`Unexpected request URL: ${url}`)
    })

    const payload: ChatCompletionsPayload = {
      model: "gpt-5.3-codex",
      messages: [
        { role: "user", content: "First question" },
        { role: "assistant", content: "Previous answer" },
        { role: "user", content: "Follow-up" },
      ],
    }

    await createChatCompletions(payload)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const fallbackInput = capturedFallbackBodies[0]?.input
    expect(Array.isArray(fallbackInput)).toBe(true)
    if (!Array.isArray(fallbackInput)) {
      throw new Error("Expected responses fallback payload input array")
    }

    const assistantItem = fallbackInput[1] as {
      role?: string
      content?: Array<{ type?: string; text?: string }>
    }

    expect(assistantItem.role).toBe("assistant")
    expect(assistantItem.content?.[0]?.type).toBe("output_text")
    expect(assistantItem.content?.[0]?.text).toBe("Previous answer")
  })

  test("normalizes oversized function call ids for /responses fallback", async () => {
    const capturedFallbackBodies: Array<Record<string, unknown>> = []

    const fetchMock = installFetchMock((url, init) => {
      if (url.endsWith("/chat/completions")) {
        return buildUnsupportedApiForModelResponse()
      }

      if (url.endsWith("/responses")) {
        capturedFallbackBodies.push(
          JSON.parse(init.body as string) as Record<string, unknown>,
        )

        return Response.json({
          id: "resp_callid_1",
          model: "gpt-5.3-codex",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "ok" }],
            },
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 1,
            total_tokens: 13,
          },
        })
      }

      throw new Error(`Unexpected request URL: ${url}`)
    })

    const oversizedCallId = `call_${"x".repeat(2000)}`
    const payload: ChatCompletionsPayload = {
      model: "gpt-5.3-codex",
      messages: [
        { role: "user", content: "hello" },
        {
          role: "assistant",
          content: "I will call a tool",
          tool_calls: [
            {
              id: oversizedCallId,
              type: "function",
              function: {
                name: "search_docs",
                arguments: '{"query":"retry policy"}',
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: oversizedCallId,
          content: "tool result",
        },
      ],
    }

    await createChatCompletions(payload)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const fallbackInput = capturedFallbackBodies[0]?.input
    expect(Array.isArray(fallbackInput)).toBe(true)
    if (!Array.isArray(fallbackInput)) {
      throw new Error("Expected responses fallback payload input array")
    }

    const functionCallItem = fallbackInput.find(
      (item) =>
        typeof item === "object"
        && item !== null
        && (item as { type?: string }).type === "function_call",
    ) as { call_id?: string } | undefined

    const functionCallOutputItem = fallbackInput.find(
      (item) =>
        typeof item === "object"
        && item !== null
        && (item as { type?: string }).type === "function_call_output",
    ) as { call_id?: string } | undefined

    expect(typeof functionCallItem?.call_id).toBe("string")
    expect(typeof functionCallOutputItem?.call_id).toBe("string")

    if (!functionCallItem?.call_id || !functionCallOutputItem?.call_id) {
      throw new Error("Expected function_call and function_call_output call ids")
    }

    expect(functionCallItem.call_id.length).toBeLessThanOrEqual(64)
    expect(functionCallOutputItem.call_id.length).toBeLessThanOrEqual(64)
    expect(functionCallItem.call_id).toBe(functionCallOutputItem.call_id)
  })

  test("does not fallback via /responses when Copilot returns model_not_supported", async () => {
    const fetchMock = installFetchMock((url) => {
      if (url.endsWith("/chat/completions")) {
        return buildModelNotSupportedResponse()
      }

      if (url.endsWith("/responses")) {
        return Response.json({
          id: "resp_model_supported",
          model: "claude-sonnet-4",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "fallback worked" }],
            },
          ],
          usage: {
            input_tokens: 5,
            output_tokens: 2,
            total_tokens: 7,
          },
        })
      }

      throw new Error(`Unexpected request URL: ${url}`)
    })

    const payload: ChatCompletionsPayload = {
      model: "claude-sonnet-4.5",
      messages: [{ role: "user", content: "hello" }],
    }

    let thrown: unknown
    try {
      await createChatCompletions(payload)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(HTTPError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test("synthesizes chat-completions stream after /responses fallback", async () => {
    const fetchMock = installFetchMock((url) => {
      if (url.endsWith("/chat/completions")) {
        return buildUnsupportedApiForModelResponse()
      }

      if (url.endsWith("/responses")) {
        return Response.json({
          id: "resp_stream_1",
          model: "gpt-5.3-codex",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: "stream fallback content",
                },
              ],
            },
          ],
          usage: {
            input_tokens: 8,
            output_tokens: 4,
            total_tokens: 12,
          },
        })
      }

      throw new Error(`Unexpected request URL: ${url}`)
    })

    const payload: ChatCompletionsPayload = {
      model: "gpt-5.3-codex",
      stream: true,
      messages: [{ role: "user", content: "hello" }],
    }

    const response = await createChatCompletions(payload)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    expect(Object.hasOwn(response, "choices")).toBe(false)

    const stream = response as AsyncIterable<{ data: string }>
    const events: Array<string> = []
    for await (const event of stream) {
      events.push(event.data)
    }

    expect(events).toHaveLength(2)
    expect(events[1]).toBe("[DONE]")

    const firstChunk = JSON.parse(events[0] || "{}") as {
      model?: string
      choices?: Array<{
        finish_reason?: string
        delta?: { content?: string }
      }>
    }

    expect(firstChunk.model).toBe("gpt-5.3-codex")
    expect(firstChunk.choices?.[0]?.finish_reason).toBe("stop")
    expect(firstChunk.choices?.[0]?.delta?.content).toBe(
      "stream fallback content",
    )
  })

  test("routes Gemini provider through native generateContent endpoint", async () => {
    state.provider = {
      id: "gemini",
      mode: "openai-compatible",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: "gm-key",
    }

    const fetchMock = installFetchMock((url, init) => {
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=gm-key",
      )

      const headers = (init.headers || {}) as Record<string, string>
      expect(headers.authorization).toBeUndefined()
      expect(headers["content-type"]).toBe("application/json")

      return buildGeminiNativeTextResponse()
    })

    const payload: ChatCompletionsPayload = {
      model: "gemini-3.1-pro-preview",
      messages: [{ role: "user", content: "Reply with ok only" }],
      max_tokens: 64,
    }

    const response = await createChatCompletions(payload)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(Object.hasOwn(response, "choices")).toBe(true)

    const nonStreaming = response as {
      model: string
      choices: Array<{ message: { content: string | null } }>
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        total_tokens?: number
      }
    }

    expect(nonStreaming.model).toBe("gemini-3.1-pro-preview")
    expect(nonStreaming.choices[0]?.message.content).toBe("ok")
    expect(nonStreaming.usage?.prompt_tokens).toBe(4)
    expect(nonStreaming.usage?.completion_tokens).toBe(1)
    expect(nonStreaming.usage?.total_tokens).toBe(5)
  })

  test("maps Gemini native functionCall parts to chat tool_calls", async () => {
    state.provider = {
      id: "gemini",
      mode: "openai-compatible",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: "gm-key",
    }

    const fetchMock = installFetchMock((url) => {
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview-customtools:generateContent?key=gm-key",
      )

      return buildGeminiNativeToolCallResponse()
    })

    const payload: ChatCompletionsPayload = {
      model: "gemini-3.1-pro-preview",
      messages: [{ role: "user", content: "Search the web" }],
      tools: [
        {
          type: "function",
          function: {
            name: "search_web",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
            },
          },
        },
      ],
    }

    const response = await createChatCompletions(payload)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(Object.hasOwn(response, "choices")).toBe(true)

    const nonStreaming = response as {
      choices: Array<{
        finish_reason: string
        message: {
          tool_calls?: Array<{
            type: string
            function: { name: string; arguments: string }
          }>
        }
      }>
    }

    expect(nonStreaming.choices[0]?.finish_reason).toBe("tool_calls")
    expect(nonStreaming.choices[0]?.message.tool_calls?.[0]?.type).toBe("function")
    expect(nonStreaming.choices[0]?.message.tool_calls?.[0]?.function.name).toBe("search_web")
    expect(nonStreaming.choices[0]?.message.tool_calls?.[0]?.function.arguments).toContain(
      "latest ai news",
    )
  })

  test("wraps primitive tool_result values for Gemini native function responses", async () => {
    state.provider = {
      id: "gemini",
      mode: "openai-compatible",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: "gm-key",
    }

    let capturedBody: Record<string, unknown> | undefined
    const fetchMock = installFetchMock((url, init) => {
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview-customtools:generateContent?key=gm-key",
      )

      capturedBody = JSON.parse(init.body as string) as Record<string, unknown>
      return buildGeminiNativeTextResponse()
    })

    const payload: ChatCompletionsPayload = {
      model: "gemini-3.1-pro-preview",
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_add_1",
              type: "function",
              function: {
                name: "add",
                arguments: "{\"a\":2,\"b\":3}",
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_add_1",
          content: "5",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "add",
            parameters: {
              type: "object",
              properties: {
                a: { type: "number" },
                b: { type: "number" },
              },
              required: ["a", "b"],
            },
          },
        },
      ],
    }

    await createChatCompletions(payload)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const requestContents = capturedBody?.contents
    expect(Array.isArray(requestContents)).toBe(true)
    if (!Array.isArray(requestContents)) {
      throw new Error("Expected Gemini native request contents array")
    }

    const toolResponseContent = requestContents[1] as {
      parts?: Array<{
        functionResponse?: {
          response?: unknown
        }
      }>
    }

    const functionResponse = toolResponseContent.parts?.[0]?.functionResponse
    expect(functionResponse?.response).toEqual({ content: 5 })
  })

  test("sanitizes unsupported Gemini schema keywords in tool declarations", async () => {
    state.provider = {
      id: "gemini",
      mode: "openai-compatible",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: "gm-key",
    }

    let capturedBody: Record<string, unknown> | undefined
    const fetchMock = installFetchMock((url, init) => {
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview-customtools:generateContent?key=gm-key",
      )

      capturedBody = JSON.parse(init.body as string) as Record<string, unknown>
      return buildGeminiNativeTextResponse()
    })

    const payload: ChatCompletionsPayload = {
      model: "gemini-3.1-pro-preview",
      messages: [{ role: "user", content: "Use the tool" }],
      tools: [
        {
          type: "function",
          function: {
            name: "complex_tool",
            parameters: {
              type: "object",
              properties: {
                filters: {
                  type: "object",
                  propertyNames: { pattern: "^[a-z_]+$" },
                },
                score: {
                  type: "number",
                  exclusiveMinimum: 0,
                },
                mode: {
                  anyOf: [
                    { type: "string" },
                    { const: "auto" },
                  ],
                },
              },
              required: ["filters"],
            },
          },
        },
      ],
    }

    await createChatCompletions(payload)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const tools = capturedBody?.tools as
      | Array<{
          functionDeclarations?: Array<{
            parameters?: Record<string, unknown>
          }>
        }>
      | undefined

    const parameters = tools?.[0]?.functionDeclarations?.[0]?.parameters
    expect(parameters).toBeDefined()

    const properties = parameters?.properties as Record<string, unknown> | undefined
    const filters = properties?.filters as Record<string, unknown> | undefined
    const score = properties?.score as Record<string, unknown> | undefined
    const mode = properties?.mode as Record<string, unknown> | undefined
    const modeAnyOf = mode?.anyOf as Array<Record<string, unknown>> | undefined

    expect(filters?.propertyNames).toBeUndefined()
    expect(score?.exclusiveMinimum).toBeUndefined()
    expect(modeAnyOf?.[1]?.const).toBeUndefined()
  })

  test("preserves user-defined property names while sanitizing nested schema keywords", async () => {
    state.provider = {
      id: "gemini",
      mode: "openai-compatible",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: "gm-key",
    }

    let capturedBody: Record<string, unknown> | undefined
    const fetchMock = installFetchMock((url, init) => {
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview-customtools:generateContent?key=gm-key",
      )

      capturedBody = JSON.parse(init.body as string) as Record<string, unknown>
      return buildGeminiNativeTextResponse()
    })

    const payload: ChatCompletionsPayload = {
      model: "gemini-3.1-pro-preview",
      messages: [{ role: "user", content: "Use the tool" }],
      tools: [
        {
          type: "function",
          function: {
            name: "preserve_property_keys",
            parameters: {
              type: "object",
              properties: {
                const: {
                  type: "object",
                  properties: {
                    nested: {
                      type: "number",
                      exclusiveMinimum: 1,
                    },
                  },
                },
              },
            },
          },
        },
      ],
    }

    await createChatCompletions(payload)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const tools = capturedBody?.tools as
      | Array<{
          functionDeclarations?: Array<{
            parameters?: Record<string, unknown>
          }>
        }>
      | undefined

    const parameters = tools?.[0]?.functionDeclarations?.[0]?.parameters
    const properties = parameters?.properties as Record<string, unknown> | undefined
    const constProperty = properties?.const as Record<string, unknown> | undefined
    const nestedProperties = constProperty?.properties as
      | Record<string, unknown>
      | undefined
    const nested = nestedProperties?.nested as Record<string, unknown> | undefined

    expect(constProperty).toBeDefined()
    expect(nested?.exclusiveMinimum).toBeUndefined()
  })

  test("keeps propertyNames key inside properties while sanitizing schema rules", async () => {
    state.provider = {
      id: "gemini",
      mode: "openai-compatible",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: "gm-key",
    }

    let capturedBody: Record<string, unknown> | undefined
    const fetchMock = installFetchMock((url, init) => {
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview-customtools:generateContent?key=gm-key",
      )

      capturedBody = JSON.parse(init.body as string) as Record<string, unknown>
      return buildGeminiNativeTextResponse()
    })

    const payload: ChatCompletionsPayload = {
      model: "gemini-3.1-pro-preview",
      messages: [{ role: "user", content: "Use the tool" }],
      tools: [
        {
          type: "function",
          function: {
            name: "preserve_property_names_key",
            parameters: {
              type: "object",
              properties: {
                propertyNames: {
                  type: "object",
                  properties: {
                    value: {
                      type: "string",
                    },
                  },
                  exclusiveMinimum: 0,
                },
              },
            },
          },
        },
      ],
    }

    await createChatCompletions(payload)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const tools = capturedBody?.tools as
      | Array<{
          functionDeclarations?: Array<{
            parameters?: Record<string, unknown>
          }>
        }>
      | undefined

    const parameters = tools?.[0]?.functionDeclarations?.[0]?.parameters
    const properties = parameters?.properties as Record<string, unknown> | undefined
    const propertyNamesProperty = properties?.propertyNames as
      | Record<string, unknown>
      | undefined

    expect(propertyNamesProperty).toBeDefined()
    expect(propertyNamesProperty?.exclusiveMinimum).toBeUndefined()
  })

  test("preserves Gemini thoughtSignature for tool_result follow-up requests", async () => {
    state.provider = {
      id: "gemini",
      mode: "openai-compatible",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: "gm-key",
    }

    const capturedBodies: Array<Record<string, unknown>> = []
    const fetchMock = installFetchMock((url, init) => {
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview-customtools:generateContent?key=gm-key",
      )

      capturedBodies.push(JSON.parse(init.body as string) as Record<string, unknown>)

      if (capturedBodies.length === 1) {
        return buildGeminiNativeToolCallWithThoughtSignatureResponse()
      }

      return buildGeminiNativeTextResponse()
    })

    const basePayload: ChatCompletionsPayload = {
      model: "gemini-3.1-pro-preview",
      messages: [{ role: "user", content: "Get weather for London" }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            parameters: {
              type: "object",
              properties: {
                city: { type: "string" },
              },
              required: ["city"],
            },
          },
        },
      ],
    }

    const initialResponse = await createChatCompletions(basePayload)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(Object.hasOwn(initialResponse, "choices")).toBe(true)

    const initialNonStreaming = initialResponse as {
      choices: Array<{
        message: {
          tool_calls?: Array<{
            id: string
            type: "function"
            function: { name: string; arguments: string }
          }>
        }
      }>
    }

    const returnedToolCall = initialNonStreaming.choices[0]?.message.tool_calls?.[0]
    expect(returnedToolCall).toBeDefined()
    expect(returnedToolCall?.id).toContain("::cpapi-thoughtsig:")

    if (!returnedToolCall) {
      throw new Error("Expected Gemini tool call in initial response")
    }

    const followUpPayload: ChatCompletionsPayload = {
      model: "gemini-3.1-pro-preview",
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [returnedToolCall],
        },
        {
          role: "tool",
          tool_call_id: returnedToolCall.id,
          content: "{\"city\":\"London\",\"weather\":\"Cloudy 18C\"}",
        },
      ],
      tools: basePayload.tools,
    }

    await createChatCompletions(followUpPayload)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const secondRequestContents = capturedBodies[1]?.contents
    expect(Array.isArray(secondRequestContents)).toBe(true)
    if (!Array.isArray(secondRequestContents)) {
      throw new Error("Expected Gemini follow-up contents array")
    }

    const assistantParts = (secondRequestContents[0] as {
      parts?: Array<{
        functionCall?: {
          thoughtSignature?: string
        }
      }>
    }).parts

    const functionCall = assistantParts?.[0]?.functionCall
    const thoughtSignature = (assistantParts?.[0] as {
      thoughtSignature?: string
    } | undefined)?.thoughtSignature
    expect(functionCall).toBeDefined()
    expect(thoughtSignature).toBe("sig+/=value")
  })

  test("maps top-level Gemini thoughtSignature into encoded tool call ids", async () => {
    state.provider = {
      id: "gemini",
      mode: "openai-compatible",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: "gm-key",
    }

    const fetchMock = installFetchMock((url) => {
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview-customtools:generateContent?key=gm-key",
      )

      return buildGeminiNativeToolCallWithTopLevelThoughtSignatureResponse()
    })

    const payload: ChatCompletionsPayload = {
      model: "gemini-3.1-pro-preview",
      messages: [{ role: "user", content: "Get weather for London" }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            parameters: {
              type: "object",
              properties: {
                city: { type: "string" },
              },
              required: ["city"],
            },
          },
        },
      ],
    }

    const response = await createChatCompletions(payload)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(Object.hasOwn(response, "choices")).toBe(true)

    const nonStreaming = response as {
      choices: Array<{
        message: {
          tool_calls?: Array<{
            id: string
          }>
        }
      }>
    }

    const toolCallId = nonStreaming.choices[0]?.message.tool_calls?.[0]?.id
    expect(toolCallId).toContain("::cpapi-thoughtsig:")
  })

  test("synthesizes stream chunks for Gemini native provider responses", async () => {
    state.provider = {
      id: "gemini",
      mode: "openai-compatible",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: "gm-key",
    }

    const fetchMock = installFetchMock((url) => {
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=gm-key",
      )

      return buildGeminiNativeTextResponse()
    })

    const payload: ChatCompletionsPayload = {
      model: "gemini-3.1-pro-preview",
      stream: true,
      messages: [{ role: "user", content: "Reply with ok only" }],
    }

    const response = await createChatCompletions(payload)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(Object.hasOwn(response, "choices")).toBe(false)

    const stream = response as AsyncIterable<{ data: string }>
    const events: Array<string> = []
    for await (const event of stream) {
      events.push(event.data)
    }

    expect(events).toHaveLength(2)
    expect(events[1]).toBe("[DONE]")

    const firstChunk = JSON.parse(events[0] || "{}") as {
      model?: string
      choices?: Array<{
        finish_reason?: string
        delta?: { content?: string }
      }>
    }

    expect(firstChunk.model).toBe("gemini-3.1-pro-preview")
    expect(firstChunk.choices?.[0]?.finish_reason).toBe("stop")
    expect(firstChunk.choices?.[0]?.delta?.content).toBe("ok")
  })

})

describe("createChatCompletions strict compatibility handling", () => {
  beforeEach(resetStateForTests)

  afterEach(restoreFetchForTests)

  test("strict mode does not retry non-multimodal payloads", async () => {
    state.provider = {
      id: "opencode",
      mode: "openai-compatible",
      baseUrl: "https://opencode.ai/zen/v1",
      apiKey: "sk-provider",
      requestHandlingMode: "strict",
    }

    const fetchMock = installFetchMock((url) => {
      expect(url).toBe("https://opencode.ai/zen/v1/chat/completions")
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

    let thrown: unknown
    try {
      await createChatCompletions(payload)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(HTTPError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test("strict mode does not retry unsupported top-level field payloads", async () => {
    state.provider = {
      id: "opencode",
      mode: "openai-compatible",
      baseUrl: "https://opencode.ai/zen/v1",
      apiKey: "sk-provider",
      requestHandlingMode: "strict",
    }

    const fetchMock = installFetchMock((url) => {
      expect(url).toBe("https://opencode.ai/zen/v1/chat/completions")
      return Response.json(
        {
          error: {
            message: "Unsupported parameter: response_format",
            type: "error",
          },
        },
        { status: 400 },
      )
    })

    const payload: ChatCompletionsPayload = {
      model: "kimi_k2",
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: "hello" }],
    }

    let thrown: unknown
    try {
      await createChatCompletions(payload)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(HTTPError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("createChatCompletions rate limit handling", () => {
  beforeEach(resetStateForTests)

  afterEach(restoreFetchForTests)

  test("retries on upstream 429 using provider cooldown and succeeds", async () => {
    state.provider = {
      id: "nvidia-nim",
      mode: "openai-compatible",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKey: "sk-provider",
    }

    let attempt = 0
    const fetchMock = installFetchMock((url) => {
      expect(url).toBe("https://integrate.api.nvidia.com/v1/chat/completions")

      if (attempt === 0) {
        attempt = attempt + 1
        return new Response(
          JSON.stringify({ status: 429, title: "Too Many Requests" }),
          {
            status: 429,
            headers: {
              "content-type": "application/problem+json",
              "retry-after": "0",
            },
          },
        )
      }

      return buildSuccessResponse("minimaxai/minimax-m2.5")
    })

    const payload: ChatCompletionsPayload = {
      model: "minimaxai/minimax-m2.5",
      messages: [{ role: "user", content: "hello" }],
    }

    await createChatCompletions(payload)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test("stops retrying when upstream 429 persists", async () => {
    state.provider = {
      id: "nvidia-nim",
      mode: "openai-compatible",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKey: "sk-provider",
    }

    const fetchMock = installFetchMock((url) => {
      expect(url).toBe("https://integrate.api.nvidia.com/v1/chat/completions")
      return new Response(
        JSON.stringify({ status: 429, title: "Too Many Requests" }),
        {
          status: 429,
          headers: {
            "content-type": "application/problem+json",
            "retry-after": "0",
          },
        },
      )
    })

    const payload: ChatCompletionsPayload = {
      model: "minimaxai/minimax-m2.5",
      messages: [{ role: "user", content: "hello" }],
    }

    let thrown: unknown
    try {
      await createChatCompletions(payload)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(HTTPError)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test("strict mode returns after a single upstream 429", async () => {
    state.provider = {
      id: "nvidia-nim",
      mode: "openai-compatible",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKey: "sk-provider",
      requestHandlingMode: "strict",
    }

    const fetchMock = installFetchMock((url) => {
      expect(url).toBe("https://integrate.api.nvidia.com/v1/chat/completions")
      return new Response(
        JSON.stringify({ status: 429, title: "Too Many Requests" }),
        {
          status: 429,
          headers: {
            "content-type": "application/problem+json",
            "retry-after": "0",
          },
        },
      )
    })

    const payload: ChatCompletionsPayload = {
      model: "minimaxai/minimax-m2.5",
      messages: [{ role: "user", content: "hello" }],
    }

    let thrown: unknown
    try {
      await createChatCompletions(payload)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(HTTPError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
