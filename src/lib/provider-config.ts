export type ProviderMode = "copilot" | "openai-compatible"

export type ProviderRequestHandlingMode =
  | "strict"
  | "balanced"
  | "resilient"

export const DEFAULT_PROVIDER_REQUEST_HANDLING_MODE: ProviderRequestHandlingMode =
  "balanced"

export function normalizeProviderRequestHandlingMode(
  value?: string,
): ProviderRequestHandlingMode {
  const normalized = value?.trim().toLowerCase()

  if (normalized === "strict") {
    return "strict"
  }

  if (normalized === "resilient") {
    return "resilient"
  }

  return DEFAULT_PROVIDER_REQUEST_HANDLING_MODE
}

export interface ProviderConfig {
  id: string
  mode: ProviderMode
  baseUrl?: string
  apiKey?: string
  headers?: Record<string, string>
  preferredModel?: string
  preferredSmallModel?: string
  requestHandlingMode?: ProviderRequestHandlingMode
}

export interface ResolveProviderOptions {
  provider?: string
  providerBaseUrl?: string
  providerApiKey?: string
  providerModel?: string
  providerSmallModel?: string
  providerRequestHandlingMode?: string
}

export interface SavedProviderProfileLike {
  id: string
  baseUrl: string
  apiKey: string
  isPreset: boolean
  requestHandlingMode?: ProviderRequestHandlingMode
}

const trim = (value?: string) => {
  const v = value?.trim()
  return v && v.length > 0 ? v : undefined
}

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, "")

function openAICompatibleConfig(input: {
  id: string
  baseUrl?: string
  apiKey?: string
  model?: string
  smallModel?: string
  headers?: Record<string, string>
  requestHandlingMode?: string
}): ProviderConfig {
  if (!input.baseUrl) {
    throw new Error(`Missing base URL for provider \"${input.id}\"`)
  }

  if (!input.apiKey) {
    throw new Error(`Missing API key for provider \"${input.id}\"`)
  }

  return {
    id: input.id,
    mode: "openai-compatible",
    baseUrl: normalizeBaseUrl(input.baseUrl),
    apiKey: input.apiKey,
    headers: input.headers,
    preferredModel: input.model,
    preferredSmallModel: input.smallModel,
    requestHandlingMode: normalizeProviderRequestHandlingMode(
      input.requestHandlingMode,
    ),
  }
}

export function resolveProviderConfig(
  options: ResolveProviderOptions,
): ProviderConfig {
  const requestedProvider =
    trim(options.provider)?.toLowerCase()
    || trim(process.env.PROVIDER)?.toLowerCase()
    || "copilot"

  const customBaseUrl =
    trim(options.providerBaseUrl) || trim(process.env.PROVIDER_BASE_URL)
  const customApiKey =
    trim(options.providerApiKey) || trim(process.env.PROVIDER_API_KEY)

  const providerModel =
    trim(options.providerModel) || trim(process.env.PROVIDER_MODEL)
  const providerSmallModel =
    trim(options.providerSmallModel) || trim(process.env.PROVIDER_SMALL_MODEL)
  const providerRequestHandlingMode =
    trim(options.providerRequestHandlingMode)
    || trim(process.env.PROVIDER_REQUEST_HANDLING_MODE)

  if (requestedProvider === "copilot") {
    return {
      id: "copilot",
      mode: "copilot",
      preferredModel: providerModel,
      preferredSmallModel: providerSmallModel,
    }
  }

  if (requestedProvider === "custom") {
    return openAICompatibleConfig({
      id: "custom",
      baseUrl: customBaseUrl,
      apiKey: customApiKey,
      model: providerModel,
      smallModel: providerSmallModel,
      requestHandlingMode: providerRequestHandlingMode,
    })
  }

  if (requestedProvider === "opencode") {
    return openAICompatibleConfig({
      id: "opencode",
      baseUrl: customBaseUrl || "https://opencode.ai/zen/v1",
      apiKey: customApiKey || trim(process.env.OPENCODE_API_KEY),
      model: providerModel || "qwen3.6-plus-free",
      smallModel: providerSmallModel || "qwen3.6-plus-free",
      requestHandlingMode: providerRequestHandlingMode,
    })
  }

  if (requestedProvider === "openrouter") {
    return openAICompatibleConfig({
      id: "openrouter",
      baseUrl: customBaseUrl || "https://openrouter.ai/api/v1",
      apiKey: customApiKey || trim(process.env.OPENROUTER_API_KEY),
      model: providerModel,
      smallModel: providerSmallModel,
      requestHandlingMode: providerRequestHandlingMode,
      headers: {
        ...(trim(process.env.OPENROUTER_HTTP_REFERER) && {
          "HTTP-Referer": trim(process.env.OPENROUTER_HTTP_REFERER)!,
        }),
        ...(trim(process.env.OPENROUTER_X_TITLE) && {
          "X-Title": trim(process.env.OPENROUTER_X_TITLE)!,
        }),
      },
    })
  }

  if (requestedProvider === "groq") {
    return openAICompatibleConfig({
      id: "groq",
      baseUrl: customBaseUrl || "https://api.groq.com/openai/v1",
      apiKey: customApiKey || trim(process.env.GROQ_API_KEY),
      model: providerModel,
      smallModel: providerSmallModel,
      requestHandlingMode: providerRequestHandlingMode,
    })
  }

  if (requestedProvider === "xai") {
    return openAICompatibleConfig({
      id: "xai",
      baseUrl: customBaseUrl || "https://api.x.ai/v1",
      apiKey: customApiKey || trim(process.env.XAI_API_KEY),
      model: providerModel,
      smallModel: providerSmallModel,
      requestHandlingMode: providerRequestHandlingMode,
    })
  }

  if (requestedProvider === "nvidia-nim" || requestedProvider === "nvidia") {
    return openAICompatibleConfig({
      id: "nvidia-nim",
      baseUrl: customBaseUrl || "https://integrate.api.nvidia.com/v1",
      apiKey: customApiKey || trim(process.env.NVIDIA_API_KEY),
      model: providerModel,
      smallModel: providerSmallModel,
      requestHandlingMode: providerRequestHandlingMode,
    })
  }

  if (requestedProvider === "gemini") {
    return openAICompatibleConfig({
      id: "gemini",
      baseUrl:
        customBaseUrl || "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: customApiKey || trim(process.env.GEMINI_API_KEY),
      model: providerModel,
      smallModel: providerSmallModel,
      requestHandlingMode: providerRequestHandlingMode,
    })
  }

  if (customBaseUrl && customApiKey) {
    return openAICompatibleConfig({
      id: requestedProvider,
      baseUrl: customBaseUrl,
      apiKey: customApiKey,
      model: providerModel,
      smallModel: providerSmallModel,
      requestHandlingMode: providerRequestHandlingMode,
    })
  }

  throw new Error(
    `Unsupported provider \"${requestedProvider}\". Use a saved provider profile, custom provider, or one of: copilot, opencode, openrouter, groq, xai, nvidia-nim, gemini`,
  )
}

export function resolveProviderConfigFromProfile(
  profile: SavedProviderProfileLike,
  models?: {
    defaultModel?: string
    smallModel?: string
  },
): ProviderConfig {
  if (profile.id === "copilot") {
    return {
      id: "copilot",
      mode: "copilot",
      preferredModel: models?.defaultModel,
      preferredSmallModel: models?.smallModel,
    }
  }

  return resolveProviderConfig({
    provider: profile.id,
    providerBaseUrl: profile.baseUrl,
    providerApiKey: profile.apiKey,
    providerModel: models?.defaultModel,
    providerSmallModel: models?.smallModel,
    providerRequestHandlingMode: profile.requestHandlingMode,
  })
}
