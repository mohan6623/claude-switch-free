import { Hono } from "hono"

import { forwardError } from "~/lib/error"
import { state } from "~/lib/state"
import {
  getActiveProviderProfile,
  loadStartupConfig,
  saveStartupConfig,
  setActiveProvider,
  upsertProviderProfile,
} from "~/lib/startup-config"
import { normalizeModelSlots } from "~/lib/startup-wizard"
import { cacheModels } from "~/lib/utils"

const FALLBACK_MODEL = "qwen/qwen3.6-plus:free"
const SLOT_KEYS = ["defaultModel", "bigModel", "sonnetModel", "haikuModel"] as const

type SlotKey = (typeof SLOT_KEYS)[number]

export const dashboardConfigRoutes = new Hono()

dashboardConfigRoutes.get("/config", async (c) => {
  try {
    if (!state.models) {
      await cacheModels()
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

    const availableModels = state.models?.data.map((model) => model.id) || []
    const preferredDefault =
      activeProfile.modelSlots?.defaultModel
      || state.provider.preferredModel
      || availableModels[0]
      || FALLBACK_MODEL

    const slots = normalizeModelSlots({
      defaultModel: preferredDefault,
      bigModel: activeProfile.modelSlots?.bigModel,
      sonnetModel: activeProfile.modelSlots?.sonnetModel,
      haikuModel: activeProfile.modelSlots?.haikuModel,
    })

    return c.json({
      activeProvider: {
        id: activeProfile.id,
        label: activeProfile.label,
        baseUrl: activeProfile.baseUrl,
        isPreset: activeProfile.isPreset,
        requestHandlingMode: activeProfile.requestHandlingMode,
        updatedAt: activeProfile.updatedAt,
        apiKeyConfigured: Boolean(activeProfile.apiKey),
      },
      slots,
      availableModels,
    })
  } catch (error) {
    return await forwardError(c, error)
  }
})

dashboardConfigRoutes.patch("/slots/:slotId", async (c) => {
  try {
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

    if (!state.models) {
      await cacheModels()
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

    const availableModels = state.models?.data.map((item) => item.id) || []
    if (availableModels.length > 0 && !availableModels.includes(model)) {
      return c.json(
        {
          error: {
            message: `Model not found in available models: ${model}`,
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

    const nextSlots = normalizeModelSlots({
      defaultModel:
        slotId === "defaultModel" ? model : (activeProfile.modelSlots?.defaultModel || model),
      bigModel: slotId === "bigModel" ? model : activeProfile.modelSlots?.bigModel,
      sonnetModel: slotId === "sonnetModel" ? model : activeProfile.modelSlots?.sonnetModel,
      haikuModel: slotId === "haikuModel" ? model : activeProfile.modelSlots?.haikuModel,
    })

    const nextProfile = {
      ...activeProfile,
      modelSlots: nextSlots,
      updatedAt: new Date().toISOString(),
    }

    const upserted = upsertProviderProfile(startupConfig, nextProfile)
    const updated = setActiveProvider(upserted, activeProfile.id)
    await saveStartupConfig(updated)

    return c.json({
      ok: true,
      slotId,
      model,
      slots: nextSlots,
    })
  } catch (error) {
    return await forwardError(c, error)
  }
})
