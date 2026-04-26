import { Hono } from "hono"

import { forwardError } from "~/lib/error"
import { state } from "~/lib/state"
import {
  getActiveProviderProfile,
  loadStartupConfig,
} from "~/lib/startup-config"
import { normalizeModelSlots } from "~/lib/startup-wizard"
import { cacheModels } from "~/lib/utils"

const FALLBACK_MODEL = "qwen/qwen3.6-plus:free"

interface DashboardModelItem {
  id: string
  name: string
  provider: string
  copilotPro: boolean
  supportsTools: boolean
}

export const dashboardBootstrapRoutes = new Hono()

dashboardBootstrapRoutes.get("/models", async (c) => {
  try {
    const models = await listDashboardModels()

    return c.json({
      object: "list",
      data: models,
      has_more: false,
    })
  } catch (error) {
    return await forwardError(c, error)
  }
})

dashboardBootstrapRoutes.get("/bootstrap", async (c) => {
  try {
    const models = await listDashboardModels()

    const startupConfig = await loadStartupConfig()
    const activeProfile = getActiveProviderProfile(startupConfig)

    const preferredDefault =
      activeProfile?.modelSlots?.defaultModel
      || state.provider.preferredModel
      || models[0]?.id
      || FALLBACK_MODEL

    const modelSlots = normalizeModelSlots({
      defaultModel: preferredDefault,
      bigModel: activeProfile?.modelSlots?.bigModel,
      sonnetModel: activeProfile?.modelSlots?.sonnetModel,
      haikuModel: activeProfile?.modelSlots?.haikuModel,
    })

    return c.json({
      app: {
        mode: "browser",
        name: "claude-switch-dashboard",
      },
      activeProvider: activeProfile
        ? {
            id: activeProfile.id,
            label: activeProfile.label,
            requestHandlingMode: activeProfile.requestHandlingMode,
          }
        : {
            id: state.provider.id,
            label: state.provider.id,
            requestHandlingMode: "balanced",
          },
      modelSlots,
      models: {
        object: "list",
        data: models,
        has_more: false,
      },
    })
  } catch (error) {
    return await forwardError(c, error)
  }
})

async function listDashboardModels(): Promise<Array<DashboardModelItem>> {
  if (!state.models) {
    await cacheModels()
  }

  return (state.models?.data || []).map((model) => ({
    id: model.id,
    name: model.name || model.id,
    provider: model.vendor,
    copilotPro: true,
    supportsTools: Boolean(model.capabilities?.supports?.tool_calls),
  }))
}
