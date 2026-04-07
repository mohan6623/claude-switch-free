import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export const getModels = async () => {
  if (state.provider.mode === "openai-compatible") {
    return await getOpenAICompatibleModels()
  }

  const response = await fetch(`${copilotBaseUrl(state)}/models`, {
    headers: copilotHeaders(state),
  })

  if (!response.ok) throw new HTTPError("Failed to get models", response)

  return (await response.json()) as ModelsResponse
}

async function getOpenAICompatibleModels(): Promise<ModelsResponse> {
  const provider = state.provider

  if (!provider.baseUrl || !provider.apiKey) {
    throw new Error(
      "Provider mode is enabled but base URL or API key is missing",
    )
  }

  const response = await fetch(`${provider.baseUrl}/models`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${provider.apiKey}`,
      ...(provider.headers || {}),
    },
  })

  if (!response.ok) {
    if (provider.preferredModel) {
      return buildFallbackModels(provider.id, [
        provider.preferredModel,
        provider.preferredSmallModel,
      ])
    }

    throw new HTTPError("Failed to get models", response)
  }

  const upstream = (await response.json()) as {
    data?: Array<{
      id: string
      object?: string
      owned_by?: string
      created?: number
    }>
    object?: string
  }

  const mapped = (upstream.data || []).map((model) =>
    normalizeModel(model.id, provider.id, model.owned_by),
  )

  if (mapped.length === 0 && provider.preferredModel) {
    return buildFallbackModels(provider.id, [
      provider.preferredModel,
      provider.preferredSmallModel,
    ])
  }

  return {
    object: upstream.object || "list",
    data: mapped,
  }
}

function normalizeModel(
  modelId: string,
  providerId: string,
  owner?: string,
): Model {
  return {
    id: modelId,
    object: "model",
    name: modelId,
    vendor: owner || providerId,
    version: "unknown",
    preview: false,
    model_picker_enabled: true,
    capabilities: {
      family: providerId,
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
  }
}

function buildFallbackModels(
  providerId: string,
  modelIds: Array<string | undefined>,
): ModelsResponse {
  const unique = [...new Set(modelIds.filter(Boolean) as Array<string>)]

  return {
    object: "list",
    data: unique.map((id) => normalizeModel(id, providerId)),
  }
}

export interface ModelsResponse {
  data: Array<Model>
  object: string
}

interface ModelLimits {
  max_context_window_tokens?: number
  max_output_tokens?: number
  max_prompt_tokens?: number
  max_inputs?: number
}

interface ModelSupports {
  tool_calls?: boolean
  parallel_tool_calls?: boolean
  dimensions?: boolean
}

interface ModelCapabilities {
  family: string
  limits: ModelLimits
  object: string
  supports: ModelSupports
  tokenizer: string
  type: string
}

export interface Model {
  capabilities: ModelCapabilities
  id: string
  model_picker_enabled: boolean
  name: string
  object: string
  preview: boolean
  vendor: string
  version: string
  policy?: {
    state: string
    terms: string
  }
}
