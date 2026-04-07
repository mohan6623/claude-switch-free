import consola from "consola"
import { events } from "fetch-event-stream"

import type { ProviderConfig } from "~/lib/provider-config"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export const createChatCompletions = async (
  payload: ChatCompletionsPayload,
  providerOverride?: ProviderConfig,
) => {
  const effectiveProvider = providerOverride || state.provider

  if (effectiveProvider.mode === "openai-compatible") {
    return await createOpenAICompatibleChatCompletions(
      payload,
      effectiveProvider,
    )
  }

  if (!state.copilotToken) throw new Error("Copilot token not found")

  const enableVision = payload.messages.some(
    (x) =>
      typeof x.content !== "string"
      && x.content?.some((x) => x.type === "image_url"),
  )

  // Agent/user check for X-Initiator header
  // Determine if any message is from an agent ("assistant" or "tool")
  const isAgentCall = payload.messages.some((msg) =>
    ["assistant", "tool"].includes(msg.role),
  )

  // Build headers and add X-Initiator
  const headers: Record<string, string> = {
    ...copilotHeaders(state, enableVision),
    "X-Initiator": isAgentCall ? "agent" : "user",
  }

  const response = await fetch(`${copilotBaseUrl(state)}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    consola.error("Failed to create chat completions", response)
    throw new HTTPError("Failed to create chat completions", response)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as ChatCompletionResponse
}

async function createOpenAICompatibleChatCompletions(
  payload: ChatCompletionsPayload,
  provider: ProviderConfig,
) {
  if (!provider.baseUrl || !provider.apiKey) {
    throw new Error(
      "Provider mode is enabled but base URL or API key is missing",
    )
  }

  const response = await postOpenAICompatibleChatCompletions(payload, provider)

  if (!response.ok) {
    if (payloadHasImages(payload)) {
      const errorText = await response.clone().text()
      if (isNonMultimodalModelError(errorText)) {
        const fallbackPayload = stripImagesFromPayload(payload)
        consola.warn(
          "Upstream model rejected multimodal request; retrying without image blocks.",
        )

        const retry = await postOpenAICompatibleChatCompletions(
          fallbackPayload,
          provider,
        )
        if (!retry.ok) {
          consola.error("Failed to create chat completions", retry)
          throw new HTTPError("Failed to create chat completions", retry)
        }

        if (fallbackPayload.stream) {
          return events(retry)
        }

        return (await retry.json()) as ChatCompletionResponse
      }
    }

    consola.error("Failed to create chat completions", response)
    throw new HTTPError("Failed to create chat completions", response)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as ChatCompletionResponse
}

async function postOpenAICompatibleChatCompletions(
  payload: ChatCompletionsPayload,
  provider: ProviderConfig,
): Promise<Response> {
  return await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`,
      ...provider.headers,
    },
    body: JSON.stringify(payload),
  })
}

function payloadHasImages(payload: ChatCompletionsPayload): boolean {
  return payload.messages.some(
    (message) =>
      Array.isArray(message.content)
      && message.content.some((part) => part.type === "image_url"),
  )
}

function stripImagesFromPayload(
  payload: ChatCompletionsPayload,
): ChatCompletionsPayload {
  return {
    ...payload,
    messages: payload.messages.map((message) => {
      if (!Array.isArray(message.content)) {
        return message
      }

      const withoutImages = message.content.filter(
        (part) => part.type !== "image_url",
      )
      if (withoutImages.length === message.content.length) {
        return message
      }

      if (withoutImages.length > 0) {
        return {
          ...message,
          content: withoutImages,
        }
      }

      return {
        ...message,
        content: [
          {
            type: "text",
            text: "[Image omitted because selected model is not multimodal.]",
          },
        ],
      }
    }),
  }
}

function isNonMultimodalModelError(errorText: string): boolean {
  const normalized = errorText.toLowerCase()
  return (
    normalized.includes("not a multimodal model")
    || normalized.includes("not multimodal")
    || normalized.includes("does not support image")
  )
}

// Streaming types

export interface ChatCompletionChunk {
  id: string
  object: "chat.completion.chunk"
  created: number
  model: string
  choices: Array<Choice>
  system_fingerprint?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens: number
    }
    completion_tokens_details?: {
      accepted_prediction_tokens: number
      rejected_prediction_tokens: number
    }
  }
}

interface Delta {
  content?: string | null
  role?: "user" | "assistant" | "system" | "tool"
  tool_calls?: Array<{
    index: number
    id?: string
    type?: "function"
    function?: {
      name?: string
      arguments?: string
    }
  }>
}

interface Choice {
  index: number
  delta: Delta
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null
  logprobs: object | null
}

// Non-streaming types

export interface ChatCompletionResponse {
  id: string
  object: "chat.completion"
  created: number
  model: string
  choices: Array<ChoiceNonStreaming>
  system_fingerprint?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens: number
    }
  }
}

interface ResponseMessage {
  role: "assistant"
  content: string | null
  tool_calls?: Array<ToolCall>
}

interface ChoiceNonStreaming {
  index: number
  message: ResponseMessage
  logprobs: object | null
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter"
}

// Payload types

export interface ChatCompletionsPayload {
  messages: Array<Message>
  model: string
  temperature?: number | null
  top_p?: number | null
  max_tokens?: number | null
  stop?: string | Array<string> | null
  n?: number | null
  stream?: boolean | null

  frequency_penalty?: number | null
  presence_penalty?: number | null
  logit_bias?: Record<string, number> | null
  logprobs?: boolean | null
  response_format?: { type: "json_object" } | null
  seed?: number | null
  tools?: Array<Tool> | null
  tool_choice?:
    | "none"
    | "auto"
    | "required"
    | { type: "function"; function: { name: string } }
    | null
  user?: string | null
}

export interface Tool {
  type: "function"
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool" | "developer"
  content: string | Array<ContentPart> | null

  name?: string
  tool_calls?: Array<ToolCall>
  tool_call_id?: string
}

export interface ToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

export type ContentPart = TextPart | ImagePart

export interface TextPart {
  type: "text"
  text: string
}

export interface ImagePart {
  type: "image_url"
  image_url: {
    url: string
    detail?: "low" | "high" | "auto"
  }
}
