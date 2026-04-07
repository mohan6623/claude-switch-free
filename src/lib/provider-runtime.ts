import { getProviderProfile, loadStartupConfig } from "~/lib/startup-config"
import {
  resolveProviderConfigFromProfile,
  type ProviderConfig,
} from "~/lib/provider-config"

export async function resolveProviderOverride(
  providerId?: string,
  models?: {
    defaultModel?: string
    smallModel?: string
  },
): Promise<ProviderConfig | undefined> {
  if (!providerId) {
    return undefined
  }

  if (providerId === "copilot") {
    return resolveProviderConfigFromProfile(
      {
        id: "copilot",
        baseUrl: "",
        apiKey: "",
        isPreset: true,
      },
      models,
    )
  }

  const startupConfig = await loadStartupConfig()
  const profile = getProviderProfile(startupConfig, providerId)
  if (!profile) {
    throw new Error(`Configured provider not found for routed model: ${providerId}`)
  }

  return resolveProviderConfigFromProfile(profile, models)
}
