import { describe, expect, test } from "bun:test"

import { encodeRoutedModel } from "../src/lib/slot-routing"
import {
  getProviderProfile,
  type ProviderProfile,
  type StartupConfig,
} from "../src/lib/startup-config"
import { applyModelSlotDraft } from "../src/lib/switch-model-draft"

describe("switch model draft application", () => {
  test("keeps active provider unchanged while updating active profile model slots", () => {
    const openrouterProfile: ProviderProfile = {
      id: "openrouter",
      label: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-openrouter",
      isPreset: true,
      updatedAt: "2026-04-07T00:00:00.000Z",
      modelSlots: {
        defaultModel: "qwen/qwen3.6-plus:free",
        bigModel: "qwen/qwen3.6-plus:free",
        sonnetModel: "qwen/qwen3.6-plus:free",
        haikuModel: "qwen/qwen3.6-plus:free",
      },
    }

    const copilotProfile: ProviderProfile = {
      id: "copilot",
      label: "Copilot Pro",
      baseUrl: "",
      apiKey: "",
      isPreset: true,
      updatedAt: "2026-04-07T00:00:00.000Z",
      modelSlots: {
        defaultModel: "claude-sonnet-4",
        bigModel: "claude-opus-4",
        sonnetModel: "claude-sonnet-4",
        haikuModel: "claude-haiku-4-5",
      },
    }

    const startupConfig: StartupConfig = {
      version: 1,
      providers: [openrouterProfile, copilotProfile],
      activeProviderId: "openrouter",
    }

    const updated = applyModelSlotDraft(startupConfig, openrouterProfile, {
      defaultModel: encodeRoutedModel("copilot", "claude-sonnet-4"),
      bigModel: encodeRoutedModel("copilot", "claude-opus-4"),
      sonnetModel: encodeRoutedModel("openrouter", "qwen/qwen3.6-plus:free"),
      haikuModel: encodeRoutedModel("openrouter", "qwen/qwen3.6-plus:free"),
    })

    expect(updated.activeProviderId).toBe("openrouter")

    const activeProfile = getProviderProfile(updated, "openrouter")
    expect(activeProfile?.modelSlots?.defaultModel).toBe(
      "cpapi-route:copilot::claude-sonnet-4",
    )
  })
})
