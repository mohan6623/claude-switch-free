import { Hono } from "hono"

import { resolveProviderConfigFromProfile } from "~/lib/provider-config"
import { ROUTED_MODEL_PREFIX } from "~/lib/slot-routing"
import {
  getActiveProviderProfile,
  getProviderProfile,
  loadStartupConfig,
  removeProviderProfile,
  saveStartupConfig,
  setActiveProvider,
  upsertProviderProfile,
  type ProviderProfile,
} from "~/lib/startup-config"
import { normalizeModelSlots } from "~/lib/startup-wizard"
import { state } from "~/lib/state"
import { cacheModels } from "~/lib/utils"

const FALLBACK_MODEL = "qwen/qwen3.6-plus:free"
const SLOT_KEYS = [
  "defaultModel",
  "bigModel",
  "sonnetModel",
  "haikuModel",
] as const

type SlotKey = (typeof SLOT_KEYS)[number]

interface ProviderUpsertPayload {
  label?: string
  baseUrl?: string
  apiKey?: string
  apiKeyUrl?: string
  isPreset?: boolean
  requestHandlingMode?: "strict" | "balanced" | "resilient"
  modelSlots?: {
    defaultModel?: string
    bigModel?: string
    sonnetModel?: string
    haikuModel?: string
  }
}

export const desktopConfigRoutes = new Hono()

desktopConfigRoutes.get("/", async (c) => {
  await ensureModelCache()

  const startupConfig = await loadStartupConfig()
  return c.json(buildDesktopConfigPayload(startupConfig))
})

desktopConfigRoutes.patch("/active-provider", async (c) => {
  const body = await c.req.json<{ providerId?: string }>()
  const providerId = body.providerId?.trim().toLowerCase()

  if (!providerId) {
    return c.json(
      {
        error: {
          message: "providerId is required",
          type: "error",
        },
      },
      400,
    )
  }

  const startupConfig = await loadStartupConfig()
  const profile = getProviderProfile(startupConfig, providerId)

  if (!profile) {
    return c.json(
      {
        error: {
          message: `Provider not found: ${providerId}`,
          type: "error",
        },
      },
      404,
    )
  }

  const updated = setActiveProvider(startupConfig, providerId)
  await saveStartupConfig(updated)
  applyRuntimeProviderConfig(updated)

  return c.json({
    ok: true,
    ...buildDesktopConfigPayload(updated),
  })
})

desktopConfigRoutes.patch("/slots/:slotId", async (c) => {
  await ensureModelCache()

  const slotId = c.req.param("slotId") as SlotKey
  if (!SLOT_KEYS.includes(slotId)) {
    return c.json(
      {
        error: {
          message: `Invalid slot id: ${slotId}`,
          type: "error",
        },
      },
      400,
    )
  }

  const body = await c.req.json<{ model?: string }>()
  const model = body.model?.trim()
  if (!model) {
    return c.json(
      {
        error: {
          message: "model is required",
          type: "error",
        },
      },
      400,
    )
  }

  const availableModels = listAvailableModels()
  const isRouted = model.startsWith(ROUTED_MODEL_PREFIX)
  if (
    !isRouted
    && availableModels.length > 0
    && !availableModels.includes(model)
  ) {
    return c.json(
      {
        error: {
          message: `Model not available: ${model}`,
          type: "error",
        },
      },
      400,
    )
  }

  const startupConfig = await loadStartupConfig()
  const activeProfile = getActiveProviderProfile(startupConfig)

  if (!activeProfile) {
    return c.json(
      {
        error: {
          message: "No active provider configured",
          type: "error",
        },
      },
      400,
    )
  }

  const currentSlots = resolveSlots(activeProfile, availableModels)
  const nextSlots = normalizeModelSlots({
    defaultModel: slotId === "defaultModel" ? model : currentSlots.defaultModel,
    bigModel: slotId === "bigModel" ? model : currentSlots.bigModel,
    sonnetModel: slotId === "sonnetModel" ? model : currentSlots.sonnetModel,
    haikuModel: slotId === "haikuModel" ? model : currentSlots.haikuModel,
  })

  const updatedProfile: ProviderProfile = {
    ...activeProfile,
    modelSlots: nextSlots,
    updatedAt: new Date().toISOString(),
  }

  const updated = setActiveProvider(
    upsertProviderProfile(startupConfig, updatedProfile),
    updatedProfile.id,
  )
  await saveStartupConfig(updated)
  applyRuntimeProviderConfig(updated)

  return c.json({
    ok: true,
    slots: nextSlots,
    ...buildDesktopConfigPayload(updated),
  })
})

// eslint-disable-next-line complexity
desktopConfigRoutes.put("/providers/:providerId", async (c) => {
  const providerId = c.req.param("providerId").trim().toLowerCase()
  const body = await c.req.json<ProviderUpsertPayload>()

  if (!providerId) {
    return c.json(
      {
        error: {
          message: "providerId is required",
          type: "error",
        },
      },
      400,
    )
  }

  if (!body.label?.trim() || !body.baseUrl?.trim()) {
    return c.json(
      {
        error: {
          message: "label and baseUrl are required",
          type: "error",
        },
      },
      400,
    )
  }

  const startupConfig = await loadStartupConfig()
  const existing = getProviderProfile(startupConfig, providerId)
  const modelSlots =
    body.modelSlots ?
      normalizeModelSlots(body.modelSlots)
    : existing?.modelSlots

  const nextProfile: ProviderProfile = {
    id: providerId,
    label: body.label.trim(),
    baseUrl: stripTrailingSlash(body.baseUrl),
    apiKey: body.apiKey?.trim() || existing?.apiKey || "",
    apiKeyUrl: body.apiKeyUrl?.trim() || existing?.apiKeyUrl,
    isPreset: Boolean(body.isPreset),
    requestHandlingMode:
      body.requestHandlingMode || existing?.requestHandlingMode || "balanced",
    modelSlots,
    updatedAt: new Date().toISOString(),
  }

  const updated = setActiveProvider(
    upsertProviderProfile(startupConfig, nextProfile),
    providerId,
  )
  await saveStartupConfig(updated)
  applyRuntimeProviderConfig(updated)

  return c.json({
    ok: true,
    provider: summarizeProvider(nextProfile),
    ...buildDesktopConfigPayload(updated),
  })
})

desktopConfigRoutes.delete("/providers/:providerId", async (c) => {
  const providerId = c.req.param("providerId").trim().toLowerCase()
  const startupConfig = await loadStartupConfig()
  const updated = removeProviderProfile(startupConfig, providerId)
  await saveStartupConfig(updated)
  applyRuntimeProviderConfig(updated)

  return c.json({
    ok: true,
    ...buildDesktopConfigPayload(updated),
  })
})

function buildDesktopConfigPayload(
  config: Awaited<ReturnType<typeof loadStartupConfig>>,
) {
  const availableModels = listAvailableModels()
  const activeProfile = getActiveProviderProfile(config)
  const slots =
    activeProfile ? resolveSlots(activeProfile, availableModels) : undefined

  return {
    providers: config.providers.map((provider) => summarizeProvider(provider)),
    activeProviderId: activeProfile?.id || null,
    slots,
    availableModels,
    configRevision: buildConfigRevision(config),
  }
}

function buildConfigRevision(
  config: Awaited<ReturnType<typeof loadStartupConfig>>,
): string {
  const providersRevision = config.providers
    .map((provider) => `${provider.id}:${provider.updatedAt || ""}`)
    .sort()
    .join("|")

  return `${config.activeProviderId || ""}::${providersRevision}`
}

async function ensureModelCache(): Promise<void> {
  if (!state.models) {
    try {
      await cacheModels()
    } catch {
      // Desktop config endpoints should remain usable even when model discovery is unavailable.
    }
  }
}

function listAvailableModels(): Array<string> {
  return state.models?.data.map((model) => model.id) || []
}

function resolveSlots(
  profile: ProviderProfile,
  availableModels: Array<string>,
) {
  const fallback = availableModels[0] || FALLBACK_MODEL

  return normalizeModelSlots({
    defaultModel: profile.modelSlots?.defaultModel || fallback,
    bigModel: profile.modelSlots?.bigModel,
    sonnetModel: profile.modelSlots?.sonnetModel,
    haikuModel: profile.modelSlots?.haikuModel,
  })
}

function summarizeProvider(profile: ProviderProfile) {
  const effectiveApiKey = resolveEffectiveApiKey(profile)

  return {
    id: profile.id,
    label: profile.label,
    baseUrl: profile.baseUrl,
    isPreset: profile.isPreset,
    requestHandlingMode: profile.requestHandlingMode,
    updatedAt: profile.updatedAt,
    enabled: true,
    apiKeyConfigured: Boolean(effectiveApiKey),
    apiKey: effectiveApiKey,
    modelSlots: profile.modelSlots,
  }
}

function resolveEffectiveApiKey(profile: ProviderProfile): string {
  try {
    return resolveProviderConfigFromProfile(profile).apiKey || ""
  } catch {
    return profile.apiKey || ""
  }
}

function applyRuntimeProviderConfig(
  config: Awaited<ReturnType<typeof loadStartupConfig>>,
) {
  const active = getActiveProviderProfile(config)
  if (!active) {
    return
  }

  const slots = active.modelSlots
  state.provider = resolveProviderConfigFromProfile(active, {
    defaultModel: slots?.defaultModel,
    smallModel: slots?.haikuModel,
  })
}

function stripTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "")
}
