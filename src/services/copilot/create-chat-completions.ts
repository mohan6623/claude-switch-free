import consola from "consola"
import { events } from "fetch-event-stream"

import type { ProviderConfig } from "~/lib/provider-config"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"
import { sleep } from "~/lib/utils"

const providerQueueById = new Map<string, Promise<void>>()
const providerCooldownUntilById = new Map<string, number>()

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 1_500
const MAX_RATE_LIMIT_RETRIES = 2
const MAX_AUTORETRY_DELAY_MS = 12_000

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

  let workingPayload = payload
  const appliedFallbacks = new Set<string>()
  let rateLimitRetries = 0

  while (true) {
    const response = await postOpenAICompatibleChatCompletions(
      workingPayload,
      provider,
    )

    if (response.ok) {
      if (workingPayload.stream) {
        return events(response)
      }

      return (await response.json()) as ChatCompletionResponse
    }

    const errorText = await response.clone().text()

    if (response.status === 429) {
      const delayMs = getRateLimitDelayMs(response)
      const allowRetry =
        rateLimitRetries < MAX_RATE_LIMIT_RETRIES
        && delayMs <= MAX_AUTORETRY_DELAY_MS

      if (allowRetry) {
        rateLimitRetries = rateLimitRetries + 1
        consola.warn(
          `Provider rate limited request (${provider.id}); retrying ${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES} after cooldown.`,
        )
        continue
      }

      const retryHint =
        delayMs > MAX_AUTORETRY_DELAY_MS ?
          ` retry-after ~${Math.ceil(delayMs / 1000)}s`
        : ""
      consola.warn(
        `Provider rate limited request (${provider.id}) and auto-retry budget is exhausted.${retryHint}`,
      )
    }

    const fallback = buildCompatibilityFallback(
      workingPayload,
      errorText,
      appliedFallbacks,
    )

    if (!fallback) {
      consola.error("Failed to create chat completions", response)
      throw new HTTPError("Failed to create chat completions", response)
    }

    consola.warn(`Provider compatibility fallback applied: ${fallback.reason}`)
    appliedFallbacks.add(fallback.key)
    workingPayload = fallback.payload
  }
}

async function postOpenAICompatibleChatCompletions(
  payload: ChatCompletionsPayload,
  provider: ProviderConfig,
): Promise<Response> {
  return await runSerializedProviderRequest(provider.id, async () => {
    await waitForProviderCooldown(provider.id)

    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${provider.apiKey}`,
        ...provider.headers,
      },
      body: JSON.stringify(payload),
    })

    if (response.status === 429) {
      const delayMs = getRateLimitDelayMs(response)
      setProviderCooldown(provider.id, delayMs)
    }

    return response
  })
}

async function runSerializedProviderRequest<T>(
  providerId: string,
  run: () => Promise<T>,
): Promise<T> {
  const previous = providerQueueById.get(providerId) || Promise.resolve()

  let releaseQueue: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    releaseQueue = resolve
  })

  providerQueueById.set(
    providerId,
    previous.catch(() => undefined).then(() => gate),
  )

  await previous.catch(() => undefined)

  try {
    return await run()
  } finally {
    releaseQueue?.()
  }
}

async function waitForProviderCooldown(providerId: string): Promise<void> {
  const until = providerCooldownUntilById.get(providerId)
  if (!until) {
    return
  }

  const remainingMs = until - Date.now()
  if (remainingMs > 0) {
    await sleep(remainingMs)
  }
}

function setProviderCooldown(providerId: string, delayMs: number): void {
  if (delayMs <= 0) {
    return
  }

  const nextUntil = Date.now() + delayMs
  const previousUntil = providerCooldownUntilById.get(providerId) || 0
  providerCooldownUntilById.set(providerId, Math.max(previousUntil, nextUntil))
}

function getRateLimitDelayMs(response: Response): number {
  const retryAfter = parseRetryAfterHeader(response.headers.get("retry-after"))
  if (retryAfter !== undefined) {
    return clampRateLimitDelayMs(retryAfter)
  }

  const resetHeaders = [
    response.headers.get("x-ratelimit-reset-requests"),
    response.headers.get("x-ratelimit-reset"),
    response.headers.get("ratelimit-reset"),
    response.headers.get("x-rate-limit-reset"),
  ]

  for (const header of resetHeaders) {
    const parsed = parseRateLimitResetHeader(header)
    if (parsed !== undefined) {
      return clampRateLimitDelayMs(parsed)
    }
  }

  return DEFAULT_RATE_LIMIT_COOLDOWN_MS
}

function parseRetryAfterHeader(headerValue: string | null): number | undefined {
  if (!headerValue) {
    return undefined
  }

  const raw = headerValue.trim()
  if (!raw) {
    return undefined
  }

  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    return Number(raw) * 1000
  }

  const parsedDate = Date.parse(raw)
  if (Number.isNaN(parsedDate)) {
    return undefined
  }

  return Math.max(0, parsedDate - Date.now())
}

function parseRateLimitResetHeader(
  headerValue: string | null,
): number | undefined {
  if (!headerValue) {
    return undefined
  }

  const raw = headerValue.trim().toLowerCase()
  if (!raw) {
    return undefined
  }

  // Handle values such as "1s", "500ms", "6m0s"
  const unitMatches = [...raw.matchAll(/(\d+(?:\.\d+)?)(ms|[smh])/g)]
  if (unitMatches.length > 0) {
    const matchedText = unitMatches.map((match) => match[0]).join("")
    if (matchedText.length === raw.length) {
      let totalMs = 0

      for (const match of unitMatches) {
        const value = Number(match[1])
        const unit = match[2]

        switch (unit) {
          case "ms": {
            totalMs = totalMs + value
            break
          }
          case "s": {
            totalMs = totalMs + value * 1000
            break
          }
          case "m": {
            totalMs = totalMs + value * 60_000
            break
          }
          case "h": {
            totalMs = totalMs + value * 3_600_000
            break
          }
          default: {
            break
          }
        }
      }

      return totalMs
    }
  }

  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw)
    if (numeric > 1_000_000_000) {
      // Epoch seconds
      return Math.max(0, numeric * 1000 - Date.now())
    }

    // Assume seconds-until-reset
    return numeric * 1000
  }

  return undefined
}

function clampRateLimitDelayMs(delayMs: number): number {
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return 0
  }

  return Math.min(delayMs, 300_000)
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

type RemovableTopLevelField =
  | "temperature"
  | "top_p"
  | "max_tokens"
  | "stop"
  | "n"
  | "frequency_penalty"
  | "presence_penalty"
  | "logit_bias"
  | "logprobs"
  | "response_format"
  | "seed"
  | "tools"
  | "tool_choice"
  | "user"

const REMOVABLE_TOP_LEVEL_FIELDS: ReadonlySet<RemovableTopLevelField> = new Set(
  [
    "temperature",
    "top_p",
    "max_tokens",
    "stop",
    "n",
    "frequency_penalty",
    "presence_penalty",
    "logit_bias",
    "logprobs",
    "response_format",
    "seed",
    "tools",
    "tool_choice",
    "user",
  ],
)

function buildCompatibilityFallback(
  payload: ChatCompletionsPayload,
  errorText: string,
  appliedFallbacks: Set<string>,
):
  | {
      key: string
      reason: string
      payload: ChatCompletionsPayload
    }
  | undefined {
  if (payloadHasImages(payload) && isNonMultimodalModelError(errorText)) {
    const key = "strip-images"
    if (!appliedFallbacks.has(key)) {
      return {
        key,
        reason: "upstream model does not support multimodal input",
        payload: stripImagesFromPayload(payload),
      }
    }
  }

  const unsupportedField = extractUnsupportedField(errorText)
  if (unsupportedField && isRemovableTopLevelField(unsupportedField)) {
    const key = `drop-field:${unsupportedField}`
    if (!appliedFallbacks.has(key)) {
      const fallbackPayload = dropTopLevelField(payload, unsupportedField)
      if (fallbackPayload) {
        return {
          key,
          reason: `upstream rejected parameter ${unsupportedField}`,
          payload: fallbackPayload,
        }
      }
    }
  }

  return undefined
}

function isRemovableTopLevelField(
  field: string,
): field is RemovableTopLevelField {
  return REMOVABLE_TOP_LEVEL_FIELDS.has(field as RemovableTopLevelField)
}

function extractUnsupportedField(errorText: string): string | undefined {
  const normalized = errorText.toLowerCase()

  const matches = [
    normalized.match(/unsupported\s+parameter[^a-z0-9]+(\w+)/i),
    normalized.match(/unknown\s+parameter[^a-z0-9]+(\w+)/i),
    normalized.match(/unrecognized\s+request\s+argument[^a-z0-9]+(\w+)/i),
  ]

  for (const match of matches) {
    const candidate = match?.[1]
    if (candidate) {
      return candidate
    }
  }

  return undefined
}

function dropTopLevelField(
  payload: ChatCompletionsPayload,
  field: RemovableTopLevelField,
): ChatCompletionsPayload | undefined {
  if (payload[field] === undefined) {
    return undefined
  }

  const nextPayload: ChatCompletionsPayload = { ...payload }
  nextPayload[field] = undefined
  return nextPayload
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
