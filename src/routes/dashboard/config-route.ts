import { Hono } from "hono"
import * as path from "node:path"

import { forwardError } from "~/lib/error"
import { state } from "~/lib/state"
import {
  getActiveProviderProfile,
  loadStartupConfig,
  saveStartupConfig,
  setActiveProvider,
  upsertProviderProfile,
} from "~/lib/startup-config"
import { buildClaudeModelSlotEnv, normalizeModelSlots } from "~/lib/startup-wizard"
import { cacheModels } from "~/lib/utils"
import { resolveProviderConfigFromProfile } from "~/lib/provider-config"
import {
  type ClaudeSettingsSyncTarget,
  resolveClaudeSettingsLocalCandidatePaths,
  syncClaudeSettingsGlobal,
  syncClaudeSettingsLocal,
  syncClaudeSettingsPath,
} from "~/lib/claude-settings"

const FALLBACK_MODEL = "qwen/qwen3.6-plus:free"
const SLOT_KEYS = ["defaultModel", "bigModel", "sonnetModel", "haikuModel"] as const

type SlotKey = (typeof SLOT_KEYS)[number]

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

export const dashboardConfigRoutes = new Hono()

dashboardConfigRoutes.get("/config", async (c) => {
  try {
    if (!state.models) {
      await cacheModels()
    }

    const startupConfig = await loadStartupConfig()
    const activeProfile = getActiveProviderProfile(startupConfig)

    const availableModels = state.models?.data.map((model) => model.id) || []

    if (!activeProfile) {
      const preferredDefault = state.provider.preferredModel || availableModels[0] || FALLBACK_MODEL
      const slots = normalizeModelSlots({
        defaultModel: preferredDefault,
      })

      return c.json({
        activeProvider: {
          id: state.provider.id,
          label: state.provider.id,
          baseUrl: state.provider.baseUrl,
          isPreset: false,
          requestHandlingMode: "balanced",
          updatedAt: new Date().toISOString(),
          apiKeyConfigured: Boolean(state.provider.apiKey),
        },
        slots,
        availableModels,
      })
    }

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

dashboardConfigRoutes.get("/candidates", async (c) => {
  try {
    const candidates = resolveClaudeSettingsLocalCandidatePaths(process.cwd())
    return c.json({
      candidates: candidates.map(p => ({
        path: p,
        isDefault: p.endsWith("settings.json") && !p.endsWith("settings.local.json")
      }))
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

    const body = await c.req.json<{ model?: string, target?: ClaudeSettingsSyncTarget, localPath?: string }>()
    const model = body.model?.trim()
    const target = body.target
    const localPath = body.localPath?.trim()

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
    applyRuntimeProviderConfig(updated)

    let syncPath: string | undefined = undefined

    if (target) {
      const envPatch = buildClaudeModelSlotEnv(nextSlots)
      let syncResult

      if (target === "global") {
        syncResult = await syncClaudeSettingsGlobal(envPatch)
      } else {
        if (localPath) {
          syncResult = await syncClaudeSettingsPath(localPath, envPatch)
        } else {
          syncResult = await syncClaudeSettingsLocal(process.cwd(), envPatch)
        }
      }

      if (syncResult.updated) {
        syncPath = syncResult.path
      }
    }

    return c.json({
      ok: true,
      slotId,
      model,
      slots: nextSlots,
      syncPath,
    })
  } catch (error) {
    return await forwardError(c, error)
  }
})
