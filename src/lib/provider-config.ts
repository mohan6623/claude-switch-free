export type ProviderMode = "copilot" | "openai-compatible"

export interface ProviderConfig {
  id: string
  mode: ProviderMode
  baseUrl?: string
  apiKey?: string
  headers?: Record<string, string>
  preferredModel?: string
  preferredSmallModel?: string
}

export interface ResolveProviderOptions {
  provider?: string
  providerBaseUrl?: string
  providerApiKey?: string
  providerModel?: string
  providerSmallModel?: string
}

export interface SavedProviderProfileLike {
  id: string
  baseUrl: string
  apiKey: string
  isPreset: boolean
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
    })
  }

  if (requestedProvider === "opencode") {
    return openAICompatibleConfig({
      id: "opencode",
      baseUrl: customBaseUrl || "https://opencode.ai/zen/v1",
      apiKey: customApiKey || trim(process.env.OPENCODE_API_KEY),
      model: providerModel || "qwen3.6-plus-free",
      smallModel: providerSmallModel || "qwen3.6-plus-free",
    })
  }

  if (requestedProvider === "openrouter") {
    return openAICompatibleConfig({
      id: "openrouter",
      baseUrl: customBaseUrl || "https://openrouter.ai/api/v1",
      apiKey: customApiKey || trim(process.env.OPENROUTER_API_KEY),
      model: providerModel,
      smallModel: providerSmallModel,
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
    })
  }

  if (requestedProvider === "xai") {
    return openAICompatibleConfig({
      id: "xai",
      baseUrl: customBaseUrl || "https://api.x.ai/v1",
      apiKey: customApiKey || trim(process.env.XAI_API_KEY),
      model: providerModel,
      smallModel: providerSmallModel,
    })
  }

  if (requestedProvider === "nvidia-nim" || requestedProvider === "nvidia") {
    return openAICompatibleConfig({
      id: "nvidia-nim",
      baseUrl: customBaseUrl || "https://integrate.api.nvidia.com/v1",
      apiKey: customApiKey || trim(process.env.NVIDIA_API_KEY),
      model: providerModel,
      smallModel: providerSmallModel,
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
    })
  }

  throw new Error(
    `Unsupported provider \"${requestedProvider}\". Use one of: copilot, opencode, openrouter, groq, xai, nvidia-nim, gemini, custom`,
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

  const provider = profile.isPreset ? profile.id : "custom"

  return resolveProviderConfig({
    provider,
    providerBaseUrl: profile.baseUrl,
    providerApiKey: profile.apiKey,
    providerModel: models?.defaultModel,
    providerSmallModel: models?.smallModel,
  })
}
