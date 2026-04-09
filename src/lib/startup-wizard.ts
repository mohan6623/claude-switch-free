import { summarizeRoutedModel } from "./slot-routing"

export interface ModelSlots {
  defaultModel: string
  bigModel: string
  sonnetModel: string
  haikuModel: string
}

export interface ProviderPreset {
  id: string
  label: string
  baseUrl: string
  apiKeyUrl: string
}

export interface ProviderDisplayInput {
  label: string
  baseUrl: string
  isActive?: boolean
}

const PROVIDER_PRESETS: Array<ProviderPreset> = [
  {
    id: "opencode",
    label: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen/v1",
    apiKeyUrl: "https://opencode.ai/settings/keys",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyUrl: "https://openrouter.ai/keys",
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyUrl: "https://console.groq.com/keys",
  },
  {
    id: "xai",
    label: "xAI",
    baseUrl: "https://api.x.ai/v1",
    apiKeyUrl: "https://console.x.ai/team/api-keys",
  },
  {
    id: "nvidia-nim",
    label: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiKeyUrl: "https://build.nvidia.com/settings/api-keys",
  },
  {
    id: "gemini",
    label: "Google Gemini (OpenAI-compatible)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
  },
]

const FEATURED_MODEL_PATTERNS = [
  "qwen",
  "openrouter/free",
  "claude-sonnet",
  "claude-opus",
  "gpt-5",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
  "gemini-2.0-flash",
  "gemini-3.1-pro",
  "gemini",
  "nemotron",
  "deepseek",
  "llama",
]

export function getProviderPresets(): Array<ProviderPreset> {
  return [...PROVIDER_PRESETS]
}

export function getProviderPreset(
  providerId: string,
): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === providerId)
}

export function hasCompleteModelSlots(
  slots?: Partial<ModelSlots>,
): slots is ModelSlots {
  return Boolean(
    slots?.defaultModel
      && slots.bigModel
      && slots.sonnetModel
      && slots.haikuModel,
  )
}

export function normalizeModelSlots(slots: Partial<ModelSlots>): ModelSlots {
  const defaultModel = slots.defaultModel?.trim() || slots.sonnetModel?.trim()

  if (!defaultModel) {
    throw new Error("defaultModel is required to normalize model slots")
  }

  return {
    defaultModel,
    bigModel: slots.bigModel?.trim() || defaultModel,
    sonnetModel: slots.sonnetModel?.trim() || defaultModel,
    haikuModel:
      slots.haikuModel?.trim()
      || slots.sonnetModel?.trim()
      || defaultModel,
  }
}

export function shouldReuseSavedModels(
  existingSlots: Partial<ModelSlots> | undefined,
  keepExisting: boolean,
): existingSlots is ModelSlots {
  return keepExisting && hasCompleteModelSlots(existingSlots)
}

export function getFeaturedModelCandidates(
  models: Array<string>,
  limit: number = 12,
): Array<string> {
  const scored = rankModels(models)

  return scored.slice(0, Math.max(1, limit)).map((item) => item.model)
}

export function getCopilotModelIds(input: {
  data?: Array<{ id?: string }>
} | undefined): Array<string> {
  if (!Array.isArray(input?.data)) {
    return []
  }

  return [...new Set(
    input.data
      .map((model) => model.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  )]
}

export function filterModelsBySearch(
  models: Array<string>,
  searchText: string,
  limit: number = 300,
): Array<string> {
  const normalized = searchText.trim().toLowerCase()
  const filtered = normalized.length === 0
    ? models
    : models.filter((model) => model.toLowerCase().includes(normalized))

  return rankModels(filtered)
    .slice(0, Math.max(1, limit))
    .map((item) => item.model)
}

export function summarizeModelSlots(slots: ModelSlots): string {
  return `default=${summarizeRoutedModel(slots.defaultModel)}, opus=${summarizeRoutedModel(slots.bigModel)}, sonnet=${summarizeRoutedModel(slots.sonnetModel)}, haiku=${summarizeRoutedModel(slots.haikuModel)}`
}

export function buildSearchStatusLabel(
  searchText: string,
  matchCount: number,
): string {
  const suffix = matchCount === 1 ? "match" : "matches"
  const term = searchText.trim()
  if (!term) {
    return `(${matchCount} ${suffix})`
  }
  return `${term} (${matchCount} ${suffix})`
}

export function buildProviderDisplayLabel(input: ProviderDisplayInput): string {
  const host = getProviderHost(input.baseUrl)
  const active = input.isActive ? " [active]" : ""
  return `${input.label}${active} (${host})`
}

export function buildClaudeModelEnv(serverUrl: string, slots: ModelSlots) {
  const slotEnv = buildClaudeModelSlotEnv(slots)

  return {
    ANTHROPIC_BASE_URL: serverUrl,
    ANTHROPIC_AUTH_TOKEN: "dummy",
    ...slotEnv,
  }
}

export function buildClaudeModelSlotEnv(slots: ModelSlots) {
  return {
    ANTHROPIC_MODEL: slots.defaultModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: slots.sonnetModel,
    ANTHROPIC_DEFAULT_OPUS_MODEL: slots.bigModel,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: slots.haikuModel,
    ANTHROPIC_SMALL_FAST_MODEL: slots.haikuModel,
    DISABLE_NON_ESSENTIAL_MODEL_CALLS: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  }
}

function scoreModel(model: string): number {
  const id = model.toLowerCase()

  let score = 0
  FEATURED_MODEL_PATTERNS.forEach((pattern, index) => {
    if (id.includes(pattern)) {
      score += FEATURED_MODEL_PATTERNS.length - index
    }
  })

  if (id.includes(":free") || id.endsWith("-free") || id.endsWith("/free")) {
    score += 2
  }

  return score
}

function getProviderHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname
  } catch {
    return baseUrl
  }
}

function rankModels(models: Array<string>): Array<{ model: string; score: number }> {
  const unique = [...new Set(models)]
  return unique
    .map((model) => ({ model, score: scoreModel(model) }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score
      }
      return a.model.localeCompare(b.model)
    })
}
