import {
  setActiveProvider,
  upsertProviderProfile,
  type ProviderProfile,
  type StartupConfig,
} from "~/lib/startup-config"
import { normalizeModelSlots, type ModelSlots } from "~/lib/startup-wizard"

export function applyModelSlotDraft(
  startupConfig: StartupConfig,
  activeProfile: ProviderProfile,
  modelSlots: ModelSlots,
): StartupConfig {
  const normalizedSlots = normalizeModelSlots(modelSlots)

  const refreshedProfile: ProviderProfile = {
    ...activeProfile,
    modelSlots: normalizedSlots,
    updatedAt: new Date().toISOString(),
  }

  const updatedConfig = upsertProviderProfile(startupConfig, refreshedProfile)
  return setActiveProvider(updatedConfig, activeProfile.id)
}
