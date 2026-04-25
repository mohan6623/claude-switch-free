import consola from "consola"
import { events } from "fetch-event-stream"
import { createHash } from "node:crypto"

import {
  DEFAULT_PROVIDER_REQUEST_HANDLING_MODE,
  type ProviderConfig,
  type ProviderRequestHandlingMode,
} from "~/lib/provider-config"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import {
  type AnalyticsTokenSource,
  recordAnalyticsEvent,
} from "~/lib/analytics-store"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"
import { sleep } from "~/lib/utils"

const providerQueueById = new Map<string, Promise<void>>()
const providerCooldownUntilById = new Map<string, number>()
const activeSessionRequestIds = new Set<string>()

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 1_500
const BALANCED_MAX_RATE_LIMIT_RETRIES = 2
const BALANCED_MAX_AUTORETRY_DELAY_MS = 12_000
const SESSION_REQUEST_CONFLICT_STATUS = 409

interface ProviderRequestHandlingPolicy {
  maxRateLimitRetries: number
  maxAutoRetryDelayMs: number
  maxTotalUpstreamCalls: number
  allowCompatibilityFallback: boolean
}

const PROVIDER_REQUEST_HANDLING_POLICIES: Record<
  ProviderRequestHandlingMode,
  ProviderRequestHandlingPolicy
> = {
  strict: {
    maxRateLimitRetries: 0,
    maxAutoRetryDelayMs: 0,
    maxTotalUpstreamCalls: 1,
    allowCompatibilityFallback: false,
  },
  balanced: {
    maxRateLimitRetries: BALANCED_MAX_RATE_LIMIT_RETRIES,
    maxAutoRetryDelayMs: BALANCED_MAX_AUTORETRY_DELAY_MS,
    maxTotalUpstreamCalls: 4,
    allowCompatibilityFallback: true,
  },
  resilient: {
    maxRateLimitRetries: 4,
    maxAutoRetryDelayMs: 20_000,
    maxTotalUpstreamCalls: 6,
    allowCompatibilityFallback: true,
  },
}

export interface ChatCompletionsRequestContext {
  sessionId?: string
}

export const createChatCompletions = async (
  payload: ChatCompletionsPayload,
  providerOverride?: ProviderConfig,
  requestContext?: ChatCompletionsRequestContext,
) => {
  const normalizedSessionId = normalizeInFlightSessionId(
    requestContext?.sessionId,
  )

  if (!normalizedSessionId) {
    return await createChatCompletionsInternal(payload, providerOverride)
  }

  if (activeSessionRequestIds.has(normalizedSessionId)) {
    throw createSessionRequestConflictError()
  }

  activeSessionRequestIds.add(normalizedSessionId)

  try {
    return await createChatCompletionsInternal(payload, providerOverride)
  } finally {
    activeSessionRequestIds.delete(normalizedSessionId)
  }
}

async function createChatCompletionsInternal(
  payload: ChatCompletionsPayload,
  providerOverride?: ProviderConfig,
) {
  const effectiveProvider = providerOverride || state.provider
  const route = payload.model.startsWith("cpapi-route:") ? "v1/messages" : "chat/completions"
  const startTime = Date.now()

  // Log the full request details for debugging
  const providerBaseUrl = effectiveProvider.mode === "openai-compatible"
    ? effectiveProvider.baseUrl
    : copilotBaseUrl(state)
  consola.info(`[PROXY REQUEST] Provider: ${effectiveProvider.id} (mode: ${effectiveProvider.mode})`)
  consola.info(`[PROXY REQUEST] Base URL: ${providerBaseUrl}`)
  consola.info(`[PROXY REQUEST] Model: ${payload.model}`)
  consola.info(`[PROXY REQUEST] Endpoint: ${effectiveProvider.mode === "openai-compatible" ? "/chat/completions" : copilotBaseUrl(state) + "/chat/completions"}`)

  const writeEvent = async (input: {
    statusCode: number
    latencyMs: number
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
    tokenSource: AnalyticsTokenSource
  }) => {
    try {
      await recordAnalyticsEvent({
        route,
        providerId: effectiveProvider.id,
        model: payload.model,
        statusCode: input.statusCode,
        latencyMs: input.latencyMs,
        stream: Boolean(payload.stream),
        promptTokens: input.promptTokens,
        completionTokens: input.completionTokens,
        totalTokens: input.totalTokens,
        tokenSource: input.tokenSource,
      })
    } catch {
      // best-effort analytics logging; never block request flow
    }
  }

  if (effectiveProvider.mode === "openai-compatible") {
    const response = await createOpenAICompatibleChatCompletions(
      payload,
      effectiveProvider,
    )

    if (isChatCompletionResponse(response)) {
      const usage = response.usage
      await writeEvent({
        statusCode: 200,
        latencyMs: Date.now() - startTime,
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens,
        tokenSource: usage ? "api_usage" : "unknown",
      })
    } else {
      await writeEvent({
        statusCode: 200,
        latencyMs: Date.now() - startTime,
        tokenSource: "unknown",
      })
    }

    return response
  }

  if (!state.copilotToken) throw new Error("Copilot token not found")

  // Agent/user check for X-Initiator header
  // Determine if any message is from an agent ("assistant" or "tool")
  const isAgentCall = payload.messages.some((msg) =>
    ["assistant", "tool"].includes(msg.role),
  )
  let workingPayload = payload
  const appliedFallbacks = new Set<string>()

  while (true) {
    const enableVision = payloadHasImages(workingPayload)

    // Build headers and add X-Initiator
    const headers: Record<string, string> = {
      ...copilotHeaders(state, enableVision),
      "X-Initiator": isAgentCall ? "agent" : "user",
    }

    const copilotUrl = `${copilotBaseUrl(state)}/chat/completions`
    consola.info(`[COPILOT API CALL] Full URL: ${copilotUrl}`)
    consola.info(`[COPILOT API CALL] Model sent: ${workingPayload.model}`)

    const response = await fetch(copilotUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(workingPayload),
    })

    if (!response.ok) {
      const errorText = await response.clone().text()

      if (shouldRetryCopilotViaResponses(response.status, errorText)) {
        consola.warn(
          `Copilot model ${workingPayload.model} is not available via /chat/completions. Retrying with /responses compatibility fallback.`,
        )

        const fallback = await createCopilotResponsesFallback(workingPayload, headers)
        if (isChatCompletionResponse(fallback)) {
          const usage = fallback.usage
          await writeEvent({
            statusCode: 200,
            latencyMs: Date.now() - startTime,
            promptTokens: usage?.prompt_tokens,
            completionTokens: usage?.completion_tokens,
            totalTokens: usage?.total_tokens,
            tokenSource: usage ? "api_usage" : "unknown",
          })
        } else {
          await writeEvent({
            statusCode: 200,
            latencyMs: Date.now() - startTime,
            tokenSource: "unknown",
          })
        }

        return fallback
      }

      const compatibilityFallback = buildCompatibilityFallback(
        workingPayload,
        errorText,
        appliedFallbacks,
      )
      if (compatibilityFallback) {
        consola.warn(
          `Copilot compatibility fallback applied: ${compatibilityFallback.reason}`,
        )
        appliedFallbacks.add(compatibilityFallback.key)
        workingPayload = compatibilityFallback.payload
        continue
      }

      await writeEvent({
        statusCode: response.status,
        latencyMs: Date.now() - startTime,
        tokenSource: "unknown",
      })

      consola.error("Failed to create chat completions", response)
      throw new HTTPError("Failed to create chat completions", response)
    }

    if (workingPayload.stream) {
      await writeEvent({
        statusCode: 200,
        latencyMs: Date.now() - startTime,
        tokenSource: "unknown",
      })
      return events(response)
    }

    const parsed = (await response.json()) as ChatCompletionResponse
    await writeEvent({
      statusCode: 200,
      latencyMs: Date.now() - startTime,
      promptTokens: parsed.usage?.prompt_tokens,
      completionTokens: parsed.usage?.completion_tokens,
      totalTokens: parsed.usage?.total_tokens,
      tokenSource: parsed.usage ? "api_usage" : "unknown",
    })

    return parsed
  }
}

function createSessionRequestConflictError(): HTTPError {
  return new HTTPError(
    "Another request is already in progress for this session",
    Response.json(
      {
        error: {
          message: "Another request is already in progress for this session.",
          type: "conflict",
          code: "session_busy",
        },
      },
      { status: SESSION_REQUEST_CONFLICT_STATUS },
    ),
  )
}

function normalizeInFlightSessionId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed || undefined
}

interface CopilotResponsesTextInputPart {
  type: "input_text"
  text: string
}

interface CopilotResponsesAssistantTextInputPart {
  type: "output_text"
  text: string
}

interface CopilotResponsesImageInputPart {
  type: "input_image"
  image_url: string
  detail?: "low" | "high" | "auto"
}

type CopilotResponsesInputPart =
  | CopilotResponsesTextInputPart
  | CopilotResponsesAssistantTextInputPart
  | CopilotResponsesImageInputPart

type CopilotResponsesInputItem =
  | {
      role: "system" | "user" | "assistant"
      content: Array<CopilotResponsesInputPart>
    }
  | {
      type: "function_call"
      call_id: string
      name: string
      arguments: string
    }
  | {
      type: "function_call_output"
      call_id: string
      output: string
    }

interface CopilotResponsesTool {
  type: "function"
  name: string
  description?: string
  parameters: Record<string, unknown>
}

interface CopilotResponsesRequest {
  model: string
  input: Array<CopilotResponsesInputItem>
  stream: boolean
  temperature?: number
  top_p?: number
  max_output_tokens?: number
  tools?: Array<CopilotResponsesTool>
  tool_choice?: "none" | "auto" | "required" | { type: "function"; name: string }
}

const COPILOT_RESPONSES_MAX_CALL_ID_LENGTH = 64
const COPILOT_RESPONSES_HASHED_CALL_ID_PREFIX = "cpid_"
const COPILOT_RESPONSES_HASHED_CALL_ID_HEX_LENGTH =
  COPILOT_RESPONSES_MAX_CALL_ID_LENGTH
  - COPILOT_RESPONSES_HASHED_CALL_ID_PREFIX.length

async function createCopilotResponsesFallback(
  payload: ChatCompletionsPayload,
  headers: Record<string, string>,
): Promise<ChatCompletionResponse | AsyncIterable<{ data?: string }>> {
  const responsesUrl = `${copilotBaseUrl(state)}/responses`
  consola.info(`[RESPONSES FALLBACK] Full URL: ${responsesUrl}`)
  consola.info(`[RESPONSES FALLBACK] Model sent: ${payload.model}`)

  const response = await fetch(responsesUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(buildCopilotResponsesPayload(payload)),
  })

  if (!response.ok) {
    consola.error("Failed to create chat completions", response)
    throw new HTTPError("Failed to create chat completions", response)
  }

  const parsed = (await response.json()) as unknown
  const chatCompletion = mapResponsesToChatCompletion(parsed, payload.model)

  if (payload.stream) {
    return createSyntheticChatCompletionStream(chatCompletion)
  }

  return chatCompletion
}

function buildCopilotResponsesPayload(
  payload: ChatCompletionsPayload,
): CopilotResponsesRequest {
  const request: CopilotResponsesRequest = {
    model: payload.model,
    input: mapMessagesToResponsesInput(payload.messages),
    // We request a non-stream response and synthesize chat-completions SSE locally
    // when callers asked for stream mode.
    stream: false,
  }

  if (typeof payload.temperature === "number") {
    request.temperature = payload.temperature
  }

  if (typeof payload.top_p === "number") {
    request.top_p = payload.top_p
  }

  if (typeof payload.max_tokens === "number") {
    request.max_output_tokens = payload.max_tokens
  }

  const mappedTools = mapToolsToResponsesTools(payload.tools)
  if (mappedTools) {
    request.tools = mappedTools
  }

  const mappedToolChoice = mapToolChoiceToResponsesToolChoice(payload.tool_choice)
  if (mappedToolChoice) {
    request.tool_choice = mappedToolChoice
  }

  return request
}

function mapMessagesToResponsesInput(
  messages: Array<Message>,
): Array<CopilotResponsesInputItem> {
  const input: Array<CopilotResponsesInputItem> = []

  for (const message of messages) {
    if (message.role === "tool") {
      const rawCallId = message.tool_call_id || message.name || "tool-output"
      input.push({
        type: "function_call_output",
        call_id: normalizeResponsesCallId(rawCallId),
        output: flattenMessageContentToText(message.content),
      })
      continue
    }

    const role =
      message.role === "developer" ?
        "system"
      : message.role

    if (role === "system" || role === "user" || role === "assistant") {
      const contentParts = mapMessageContentToResponsesInput(
        message.content,
        role,
      )

      const emptyContentPart: CopilotResponsesInputPart =
        role === "assistant" ?
          {
            type: "output_text",
            text: "",
          }
        : {
            type: "input_text",
            text: "",
          }

      input.push({
        role,
        content:
          contentParts.length > 0 ?
            contentParts
          : [emptyContentPart],
      })
    }

    if (role === "assistant" && message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        input.push({
          type: "function_call",
          call_id: normalizeResponsesCallId(toolCall.id),
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        })
      }
    }
  }

  return input
}

function normalizeResponsesCallId(callId: string): string {
  if (callId.length <= COPILOT_RESPONSES_MAX_CALL_ID_LENGTH) {
    return callId
  }

  const digest = createHash("sha256").update(callId).digest("hex")
  return `${COPILOT_RESPONSES_HASHED_CALL_ID_PREFIX}${digest.slice(0, COPILOT_RESPONSES_HASHED_CALL_ID_HEX_LENGTH)}`
}

function mapMessageContentToResponsesInput(
  content: Message["content"],
  role: "system" | "user" | "assistant",
): Array<CopilotResponsesInputPart> {
  if (role === "assistant") {
    if (typeof content === "string") {
      return [{ type: "output_text", text: content }]
    }

    if (!Array.isArray(content)) {
      return []
    }

    return content
      .filter((part): part is TextPart => part.type === "text")
      .map((part) => ({
        type: "output_text" as const,
        text: part.text,
      }))
  }

  if (typeof content === "string") {
    return [{ type: "input_text", text: content }]
  }

  if (!Array.isArray(content)) {
    return []
  }

  const mapped: Array<CopilotResponsesInputPart> = []

  for (const part of content) {
    if (part.type === "text") {
      mapped.push({
        type: "input_text",
        text: part.text,
      })
      continue
    }

    mapped.push({
      type: "input_image",
      image_url: part.image_url.url,
      detail: part.image_url.detail,
    })
  }

  return mapped
}

function mapToolsToResponsesTools(
  tools: Array<Tool> | null | undefined,
): Array<CopilotResponsesTool> | undefined {
  if (!tools || tools.length === 0) {
    return undefined
  }

  return tools.map((tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }))
}

function mapToolChoiceToResponsesToolChoice(
  toolChoice: ChatCompletionsPayload["tool_choice"],
): "none" | "auto" | "required" | { type: "function"; name: string } | undefined {
  if (!toolChoice) {
    return undefined
  }

  if (
    toolChoice === "none"
    || toolChoice === "auto"
    || toolChoice === "required"
  ) {
    return toolChoice
  }

  if (toolChoice.type === "function") {
    return {
      type: "function",
      name: toolChoice.function.name,
    }
  }

  return undefined
}

function flattenMessageContentToText(content: Message["content"]): string {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

function mapResponsesToChatCompletion(
  input: unknown,
  fallbackModel: string,
): ChatCompletionResponse {
  const nowEpochSeconds = Math.floor(Date.now() / 1000)
  const source = asRecord(input)

  const usage = asRecord(source.usage)
  const promptTokens = asInteger(usage.input_tokens)
  const completionTokens = asInteger(usage.output_tokens)

  const output = Array.isArray(source.output) ? source.output : []
  const textSegments: Array<string> = []
  const toolCalls: Array<ToolCall> = []

  for (const item of output) {
    const outputItem = asRecord(item)
    const itemType = asString(outputItem.type)

    if (itemType === "message") {
      const content = Array.isArray(outputItem.content) ? outputItem.content : []
      for (const part of content) {
        const contentPart = asRecord(part)
        const partType = asString(contentPart.type)

        if (partType === "output_text" || partType === "text") {
          const text = asString(contentPart.text)
          if (text) {
            textSegments.push(text)
          }
        }
      }
    }

    if (itemType === "output_text") {
      const text = asString(outputItem.text)
      if (text) {
        textSegments.push(text)
      }
    }

    if (itemType === "function_call") {
      const callId = asString(outputItem.call_id) || asString(outputItem.id) || "tool-call"
      const name = asString(outputItem.name) || "tool"
      const argumentsValue = outputItem.arguments

      let argumentsText = "{}"
      if (typeof argumentsValue === "string") {
        argumentsText = argumentsValue
      } else if (isRecord(argumentsValue) || Array.isArray(argumentsValue)) {
        argumentsText = JSON.stringify(argumentsValue)
      }

      toolCalls.push({
        id: callId,
        type: "function",
        function: {
          name,
          arguments: argumentsText,
        },
      })
    }
  }

  if (textSegments.length === 0) {
    const outputText = source.output_text
    if (typeof outputText === "string" && outputText) {
      textSegments.push(outputText)
    }
  }

  const content = textSegments.join("") || null

  return {
    id: asString(source.id) || "response-fallback",
    object: "chat.completion",
    created: nowEpochSeconds,
    model: asString(source.model) || fallbackModel,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
          ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
        },
        logprobs: null,
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens:
        asInteger(usage.total_tokens) || promptTokens + completionTokens,
    },
  }
}

function createSyntheticChatCompletionStream(
  response: ChatCompletionResponse,
): AsyncIterable<{ data: string }> {
  return (async function* () {
    const choice = response.choices[0]
    const toolCalls = choice?.message.tool_calls?.map((toolCall, index) => ({
      index,
      id: toolCall.id,
      type: "function" as const,
      function: {
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      },
    }))

    const chunk: ChatCompletionChunk = {
      id: response.id,
      object: "chat.completion.chunk",
      created: response.created,
      model: response.model,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            ...(choice?.message.content && {
              content: choice.message.content,
            }),
            ...(toolCalls && toolCalls.length > 0 && {
              tool_calls: toolCalls,
            }),
          },
          finish_reason: choice?.finish_reason || "stop",
          logprobs: null,
        },
      ],
      ...(response.usage && {
        usage: {
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens,
        },
      }),
    }

    yield {
      data: JSON.stringify(chunk),
    }

    yield {
      data: "[DONE]",
    }
  })()
}

function shouldRetryCopilotViaResponses(
  status: number,
  errorText: string,
): boolean {
  if (status !== 400) {
    return false
  }

  const normalized = errorText.toLowerCase()

  return (
    normalized.includes("unsupported_api_for_model")
    && normalized.includes("/chat/completions")
  )
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) {
    return {}
  }

  return input
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input)
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function asInteger(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value)
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0
}

interface GeminiNativeGenerationConfig {
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  stopSequences?: Array<string>
}

interface GeminiNativeFunctionDeclaration {
  name: string
  description?: string
  parameters: Record<string, unknown>
}

interface GeminiNativeToolDeclaration {
  functionDeclarations: Array<GeminiNativeFunctionDeclaration>
}

interface GeminiNativeFunctionCallPart {
  functionCall: {
    name: string
    args?: unknown
  }
  thoughtSignature?: string
  thought_signature?: string
}

interface GeminiNativeFunctionResponsePart {
  functionResponse: {
    name: string
    response: unknown
  }
}

interface GeminiNativeTextPart {
  text: string
}

interface GeminiNativeInlineDataPart {
  inlineData: {
    mimeType: string
    data: string
  }
}

interface GeminiNativeFileDataPart {
  fileData: {
    fileUri: string
  }
}

type GeminiNativePart =
  | GeminiNativeFunctionCallPart
  | GeminiNativeFunctionResponsePart
  | GeminiNativeTextPart
  | GeminiNativeInlineDataPart
  | GeminiNativeFileDataPart

interface GeminiNativeContent {
  role: "user" | "model"
  parts: Array<GeminiNativePart>
}

interface GeminiNativeRequest {
  contents: Array<GeminiNativeContent>
  systemInstruction?: {
    parts: Array<{ text: string }>
  }
  generationConfig?: GeminiNativeGenerationConfig
  tools?: Array<GeminiNativeToolDeclaration>
  toolConfig?: {
    functionCallingConfig: {
      mode: "AUTO" | "ANY" | "NONE"
      allowedFunctionNames?: Array<string>
    }
  }
}

const GEMINI_UNSUPPORTED_SCHEMA_KEYS = new Set([
  "additionalProperties",
  "unevaluatedProperties",
  "propertyNames",
  "patternProperties",
  "$schema",
  "$defs",
  "definitions",
  "const",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "unevaluatedItems",
  "contains",
  "dependentRequired",
  "dependentSchemas",
  "if",
  "then",
  "else",
  "not",
])

function isGeminiAiStudioNativeProvider(provider: ProviderConfig): boolean {
  if (provider.mode !== "openai-compatible") {
    return false
  }

  if (provider.id === "gemini") {
    return true
  }

  return (provider.baseUrl || "")
    .toLowerCase()
    .includes("generativelanguage.googleapis.com")
}

function resolveGeminiNativeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "")
  if (trimmed.endsWith("/openai")) {
    return trimmed.slice(0, -"/openai".length)
  }

  return trimmed
}

function normalizeGeminiModelId(model: string): string {
  return model.startsWith("models/")
    ? model.slice("models/".length)
    : model
}

const GEMINI_TOOL_CALLING_MODEL_COMPATIBILITY: Readonly<
  Record<string, string>
> = {
  "gemini-3.1-pro-preview": "gemini-3.1-pro-preview-customtools",
}

const GEMINI_THOUGHT_SIGNATURE_DELIMITER = "::cpapi-thoughtsig:"

function encodeGeminiToolCallId(
  baseId: string,
  thoughtSignature: string | undefined,
): string {
  if (!thoughtSignature) {
    return baseId
  }

  return `${baseId}${GEMINI_THOUGHT_SIGNATURE_DELIMITER}${encodeURIComponent(thoughtSignature)}`
}

function decodeGeminiToolCallId(toolCallId: string): {
  baseId: string
  thoughtSignature?: string
} {
  const markerIndex = toolCallId.indexOf(GEMINI_THOUGHT_SIGNATURE_DELIMITER)
  if (markerIndex < 0) {
    return { baseId: toolCallId }
  }

  const baseId = toolCallId.slice(0, markerIndex) || toolCallId
  const encodedSignature = toolCallId.slice(
    markerIndex + GEMINI_THOUGHT_SIGNATURE_DELIMITER.length,
  )

  if (!encodedSignature) {
    return { baseId }
  }

  try {
    return {
      baseId,
      thoughtSignature: decodeURIComponent(encodedSignature),
    }
  } catch {
    return {
      baseId,
      thoughtSignature: encodedSignature,
    }
  }
}

function resolveGeminiToolCallingModel(
  model: string,
  payload: ChatCompletionsPayload,
): string {
  const normalized = normalizeGeminiModelId(model)
  if (!payload.tools || payload.tools.length === 0) {
    return normalized
  }

  return GEMINI_TOOL_CALLING_MODEL_COMPATIBILITY[normalized] || normalized
}

function parseDataUri(
  value: string,
): { mimeType: string; base64: string } | undefined {
  const match = value.match(/^data:([^;,]+);base64,(.+)$/i)
  if (!match?.[1] || !match[2]) {
    return undefined
  }

  return {
    mimeType: match[1],
    base64: match[2],
  }
}

function normalizeStopSequences(
  stop: ChatCompletionsPayload["stop"],
): Array<string> | undefined {
  if (!stop) {
    return undefined
  }

  if (typeof stop === "string") {
    return stop.length > 0 ? [stop] : undefined
  }

  const filtered = stop.filter((item) => typeof item === "string" && item.length > 0)
  return filtered.length > 0 ? filtered : undefined
}

function parseToolOutput(value: string): unknown {
  const text = value.trim()
  if (!text) {
    return { content: "" }
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    return { content: text }
  }
}

function parseGeminiToolResponse(value: string): Record<string, unknown> {
  const parsed = parseToolOutput(value)

  if (isRecord(parsed)) {
    return parsed
  }

  if (Array.isArray(parsed)) {
    return { data: parsed }
  }

  return { content: parsed }
}

function sanitizeGeminiSchema(input: unknown): unknown {
  return sanitizeGeminiSchemaValue(input)
}

function sanitizeGeminiSchemaValue(
  input: unknown,
  context?: { preserveKeys?: boolean },
): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeGeminiSchemaValue(item, context))
  }

  if (!isRecord(input)) {
    return input
  }

  const sanitized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(input)) {
    if (!context?.preserveKeys && GEMINI_UNSUPPORTED_SCHEMA_KEYS.has(key)) {
      continue
    }

    const nextContext =
      key === "properties" || key === "patternProperties"
        ? { preserveKeys: true }
        : undefined

    sanitized[key] = sanitizeGeminiSchemaValue(value, nextContext)
  }

  return sanitized
}

function mapGeminiToolChoice(
  toolChoice: ChatCompletionsPayload["tool_choice"],
): GeminiNativeRequest["toolConfig"] {
  if (!toolChoice || toolChoice === "auto") {
    return {
      functionCallingConfig: {
        mode: "AUTO",
      },
    }
  }

  if (toolChoice === "none") {
    return {
      functionCallingConfig: {
        mode: "NONE",
      },
    }
  }

  if (toolChoice === "required") {
    return {
      functionCallingConfig: {
        mode: "ANY",
      },
    }
  }

  return {
    functionCallingConfig: {
      mode: "ANY",
      allowedFunctionNames: [toolChoice.function.name],
    },
  }
}

function buildGeminiNativeRequest(
  payload: ChatCompletionsPayload,
): GeminiNativeRequest {
  const toolNameByCallId = new Map<string, string>()

  for (const message of payload.messages) {
    if (message.role !== "assistant" || !message.tool_calls) {
      continue
    }

    for (const toolCall of message.tool_calls) {
      const decodedToolCallId = decodeGeminiToolCallId(toolCall.id)
      toolNameByCallId.set(toolCall.id, toolCall.function.name)
      toolNameByCallId.set(decodedToolCallId.baseId, toolCall.function.name)
    }
  }

  const systemTexts: Array<string> = []
  const contents: Array<GeminiNativeContent> = []

  for (const message of payload.messages) {
    if (message.role === "system" || message.role === "developer") {
      const text = flattenMessageContentToText(message.content)
      if (text.trim().length > 0) {
        systemTexts.push(text)
      }
      continue
    }

    if (message.role === "tool") {
      const callId = message.tool_call_id || message.name || "tool"
      const decodedCallId = decodeGeminiToolCallId(callId)
      const toolName =
        toolNameByCallId.get(callId)
        || toolNameByCallId.get(decodedCallId.baseId)
        || message.name
        || "tool"
      const responseText = flattenMessageContentToText(message.content)

      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: toolName,
              response: parseGeminiToolResponse(responseText),
            },
          },
        ],
      })
      continue
    }

    const parts: Array<GeminiNativePart> = []

    if (typeof message.content === "string") {
      parts.push({ text: message.content })
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === "text") {
          parts.push({ text: part.text })
          continue
        }

        const imageUrl = part.image_url.url
        const dataUri = parseDataUri(imageUrl)
        if (dataUri) {
          parts.push({
            inlineData: {
              mimeType: dataUri.mimeType,
              data: dataUri.base64,
            },
          })
        } else {
          parts.push({
            fileData: {
              fileUri: imageUrl,
            },
          })
        }
      }
    }

    if (message.role === "assistant" && message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        const decodedToolCallId = decodeGeminiToolCallId(toolCall.id)
        const functionCallPart: GeminiNativeFunctionCallPart = {
          functionCall: {
            name: toolCall.function.name,
            args: parseToolOutput(toolCall.function.arguments),
          },
        }

        if (decodedToolCallId.thoughtSignature) {
          functionCallPart.thoughtSignature = decodedToolCallId.thoughtSignature
        }

        parts.push({
          ...functionCallPart,
        })
      }
    }

    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: parts.length > 0 ? parts : [{ text: "" }],
    })
  }

  const request: GeminiNativeRequest = {
    contents,
  }

  if (systemTexts.length > 0) {
    request.systemInstruction = {
      parts: [{ text: systemTexts.join("\n\n") }],
    }
  }

  const generationConfig: GeminiNativeGenerationConfig = {}

  if (typeof payload.temperature === "number") {
    generationConfig.temperature = payload.temperature
  }

  if (typeof payload.top_p === "number") {
    generationConfig.topP = payload.top_p
  }

  if (typeof payload.max_tokens === "number") {
    generationConfig.maxOutputTokens = payload.max_tokens
  }

  const stopSequences = normalizeStopSequences(payload.stop)
  if (stopSequences) {
    generationConfig.stopSequences = stopSequences
  }

  if (Object.keys(generationConfig).length > 0) {
    request.generationConfig = generationConfig
  }

  if (payload.tools && payload.tools.length > 0) {
    request.tools = [
      {
        functionDeclarations: payload.tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description,
          parameters:
            (sanitizeGeminiSchema(tool.function.parameters) as Record<string, unknown>)
            || {},
        })),
      },
    ]

    request.toolConfig = mapGeminiToolChoice(payload.tool_choice)
  }

  return request
}

function mapGeminiFinishReason(
  value: unknown,
): "stop" | "length" | "tool_calls" | "content_filter" {
  const normalized = String(value || "").toUpperCase()

  if (normalized === "MAX_TOKENS") {
    return "length"
  }

  if (normalized === "SAFETY" || normalized === "RECITATION") {
    return "content_filter"
  }

  if (normalized === "TOOL_CALLS") {
    return "tool_calls"
  }

  return "stop"
}

function mapGeminiNativeResponseToChatCompletion(
  input: unknown,
  fallbackModel: string,
): ChatCompletionResponse {
  const source = asRecord(input)
  const candidates = Array.isArray(source.candidates) ? source.candidates : []
  const firstCandidate = asRecord(candidates[0])
  const firstContent = asRecord(firstCandidate.content)
  const firstParts = Array.isArray(firstContent.parts) ? firstContent.parts : []

  const textParts: Array<string> = []
  const toolCalls: Array<ToolCall> = []

  for (let i = 0; i < firstParts.length; i = i + 1) {
    const part = asRecord(firstParts[i])

    const text = asString(part.text)
    if (text) {
      textParts.push(text)
      continue
    }

    const functionCall = asRecord(part.functionCall)
    const functionName = asString(functionCall.name)
    if (!functionName) {
      continue
    }

    const thoughtSignature =
      asString(part.thoughtSignature)
      || asString(part.thought_signature)
      ||
      asString(functionCall.thoughtSignature)
      || asString(functionCall.thought_signature)

    const args = functionCall.args
    let argumentsText = "{}"
    if (typeof args === "string") {
      argumentsText = args
    } else if (isRecord(args) || Array.isArray(args)) {
      argumentsText = JSON.stringify(args)
    }

    const baseToolCallId = asString(functionCall.id) || `gemini-tool-${i}`

    toolCalls.push({
      id: encodeGeminiToolCallId(baseToolCallId, thoughtSignature),
      type: "function",
      function: {
        name: functionName,
        arguments: argumentsText,
      },
    })
  }

  const usage = asRecord(source.usageMetadata)
  const finishReason = mapGeminiFinishReason(firstCandidate.finishReason)

  return {
    id: asString(source.responseId) || asString(source.id) || `gemini-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: normalizeGeminiModelId(asString(source.modelVersion) || fallbackModel),
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: textParts.join("") || null,
          ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
        },
        logprobs: null,
        finish_reason: toolCalls.length > 0 ? "tool_calls" : finishReason,
      },
    ],
    usage: {
      prompt_tokens: asInteger(usage.promptTokenCount),
      completion_tokens: asInteger(usage.candidatesTokenCount),
      total_tokens: asInteger(usage.totalTokenCount),
    },
  }
}

async function createGeminiNativeChatCompletions(
  payload: ChatCompletionsPayload,
  provider: ProviderConfig,
): Promise<ChatCompletionResponse | AsyncIterable<{ data?: string }>> {
  if (!provider.baseUrl || !provider.apiKey) {
    throw new Error(
      "Gemini provider requires base URL and API key",
    )
  }

  const baseUrl = resolveGeminiNativeBaseUrl(provider.baseUrl)
  const modelId = resolveGeminiToolCallingModel(payload.model, payload)
  const url = `${baseUrl}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(provider.apiKey)}`

  const response = await runSerializedProviderRequest(provider.id, async () => {
    await waitForProviderCooldown(provider.id)

    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(buildGeminiNativeRequest(payload)),
    })

    if (upstream.status === 429) {
      const delayMs = getRateLimitDelayMs(upstream)
      setProviderCooldown(provider.id, delayMs)
    }

    return upstream
  })

  if (!response.ok) {
    consola.error("Failed to create chat completions", response)
    throw new HTTPError("Failed to create chat completions", response)
  }

  const parsed = (await response.json()) as unknown
  const normalized = mapGeminiNativeResponseToChatCompletion(parsed, payload.model)

  if (payload.stream) {
    return createSyntheticChatCompletionStream(normalized)
  }

  return normalized
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

  if (isGeminiAiStudioNativeProvider(provider)) {
    return await createGeminiNativeChatCompletions(payload, provider)
  }

  let workingPayload = payload
  const appliedFallbacks = new Set<string>()
  let rateLimitRetries = 0
  let totalUpstreamCalls = 0

  const requestHandlingMode =
    provider.requestHandlingMode || DEFAULT_PROVIDER_REQUEST_HANDLING_MODE
  const policy =
    PROVIDER_REQUEST_HANDLING_POLICIES[requestHandlingMode]
    || PROVIDER_REQUEST_HANDLING_POLICIES[DEFAULT_PROVIDER_REQUEST_HANDLING_MODE]

  while (true) {
    const response = await postOpenAICompatibleChatCompletions(
      workingPayload,
      provider,
    )
    totalUpstreamCalls = totalUpstreamCalls + 1

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
        rateLimitRetries < policy.maxRateLimitRetries
        && delayMs <= policy.maxAutoRetryDelayMs
        && totalUpstreamCalls < policy.maxTotalUpstreamCalls

      if (allowRetry) {
        rateLimitRetries = rateLimitRetries + 1
        consola.warn(
          `Provider rate limited request (${provider.id}); retrying ${rateLimitRetries}/${policy.maxRateLimitRetries} after cooldown (mode=${requestHandlingMode}).`,
        )
        continue
      }

      const retryHint =
        delayMs > policy.maxAutoRetryDelayMs ?
          ` retry-after ~${Math.ceil(delayMs / 1000)}s`
        : ""
      consola.warn(
        `Provider rate limited request (${provider.id}) and auto-retry budget is exhausted (mode=${requestHandlingMode}, attempts=${totalUpstreamCalls}/${policy.maxTotalUpstreamCalls}).${retryHint}`,
      )

      consola.error("Failed to create chat completions", response)
      throw new HTTPError("Failed to create chat completions", response)
    }

    const fallback = policy.allowCompatibilityFallback
      ? buildCompatibilityFallback(
        workingPayload,
        errorText,
        appliedFallbacks,
      )
      : undefined

    if (
      fallback
      && totalUpstreamCalls < policy.maxTotalUpstreamCalls
    ) {
      consola.warn(
        `Provider compatibility fallback applied: ${fallback.reason} (mode=${requestHandlingMode})`,
      )
      appliedFallbacks.add(fallback.key)
      workingPayload = fallback.payload
      continue
    }

    if (fallback && !policy.allowCompatibilityFallback) {
      consola.warn(
        `Provider compatibility fallback skipped because mode=${requestHandlingMode}.`,
      )
    }

    if (fallback && totalUpstreamCalls >= policy.maxTotalUpstreamCalls) {
      consola.warn(
        `Provider compatibility fallback blocked by upstream call budget (${totalUpstreamCalls}/${policy.maxTotalUpstreamCalls}, mode=${requestHandlingMode}).`,
      )
    }

    consola.error("Failed to create chat completions", response)
    throw new HTTPError("Failed to create chat completions", response)
  }
}

async function postOpenAICompatibleChatCompletions(
  payload: ChatCompletionsPayload,
  provider: ProviderConfig,
): Promise<Response> {
  return await runSerializedProviderRequest(provider.id, async () => {
    await waitForProviderCooldown(provider.id)

    const fullUrl = `${provider.baseUrl}/chat/completions`
    consola.info(`[OPENAI_COMPATIBLE API CALL] Provider: ${provider.id}`)
    consola.info(`[OPENAI_COMPATIBLE API CALL] Full URL: ${fullUrl}`)
    consola.info(`[OPENAI_COMPATIBLE API CALL] Model sent: ${payload.model}`)

    const response = await fetch(fullUrl, {
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
    || normalized.includes("support image input")
    || normalized.includes("image media type not supported")
    || normalized.includes("validating image item")
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

function isChatCompletionResponse(
  response: ChatCompletionResponse | AsyncIterable<{ data?: string }>,
): response is ChatCompletionResponse {
  return Object.hasOwn(response, "choices")
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
