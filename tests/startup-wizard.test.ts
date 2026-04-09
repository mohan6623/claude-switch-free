import { describe, expect, test } from "bun:test"

import {
  buildProviderDisplayLabel,
  buildSearchStatusLabel,
  buildClaudeModelEnv,
  buildClaudeModelSlotEnv,
  filterModelsBySearch,
  getCopilotModelIds,
  getFeaturedModelCandidates,
  getProviderPresets,
  hasCompleteModelSlots,
  normalizeModelSlots,
  summarizeModelSlots,
  shouldReuseSavedModels,
} from "../src/lib/startup-wizard"

describe("startup wizard helpers", () => {
  test("includes known provider presets with base urls and key links", () => {
    const presets = getProviderPresets()

    const opencode = presets.find((p) => p.id === "opencode")
    const openrouter = presets.find((p) => p.id === "openrouter")
    const gemini = presets.find((p) => p.id === "gemini")

    expect(opencode?.baseUrl).toBe("https://opencode.ai/zen/v1")
    expect(opencode?.apiKeyUrl).toContain("opencode")
    expect(openrouter?.baseUrl).toBe("https://openrouter.ai/api/v1")
    expect(gemini?.baseUrl).toContain("googleapis.com")
    expect(presets.some((p) => p.id === "vertex-ai")).toBe(false)
  })

  test("normalizes partial slots from default model", () => {
    const slots = normalizeModelSlots({
      defaultModel: "qwen3.6-plus-free",
    })

    expect(slots.defaultModel).toBe("qwen3.6-plus-free")
    expect(slots.bigModel).toBe("qwen3.6-plus-free")
    expect(slots.sonnetModel).toBe("qwen3.6-plus-free")
    expect(slots.haikuModel).toBe("qwen3.6-plus-free")
    expect(hasCompleteModelSlots(slots)).toBe(true)
  })

  test("reuses saved models only when user chooses to keep existing", () => {
    const existing = normalizeModelSlots({
      defaultModel: "model-default",
      bigModel: "model-big",
      sonnetModel: "model-sonnet",
      haikuModel: "model-haiku",
    })

    expect(shouldReuseSavedModels(existing, true)).toBe(true)
    expect(shouldReuseSavedModels(existing, false)).toBe(false)
    expect(shouldReuseSavedModels(undefined, true)).toBe(false)
  })

  test("maps all slot selections to Claude env keys", () => {
    const slots = normalizeModelSlots({
      defaultModel: "model-default",
      bigModel: "model-big",
      sonnetModel: "model-sonnet",
      haikuModel: "model-haiku",
    })

    const env = buildClaudeModelEnv("http://localhost:4141", slots)

    expect(env.ANTHROPIC_BASE_URL).toBe("http://localhost:4141")
    expect(env.ANTHROPIC_MODEL).toBe("model-default")
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("model-big")
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("model-sonnet")
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("model-haiku")
    expect(env.ANTHROPIC_SMALL_FAST_MODEL).toBe("model-haiku")
  })

  test("builds slot-only Claude env patch without auth token or base url", () => {
    const slots = normalizeModelSlots({
      defaultModel: "model-default",
      bigModel: "model-big",
      sonnetModel: "model-sonnet",
      haikuModel: "model-haiku",
    })

    const env = buildClaudeModelSlotEnv(slots)

    expect(env).toEqual({
      ANTHROPIC_MODEL: "model-default",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "model-sonnet",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "model-big",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "model-haiku",
      ANTHROPIC_SMALL_FAST_MODEL: "model-haiku",
      DISABLE_NON_ESSENTIAL_MODEL_CALLS: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    })
    expect("ANTHROPIC_BASE_URL" in env).toBe(false)
    expect("ANTHROPIC_AUTH_TOKEN" in env).toBe(false)
  })

  test("returns featured models first for picker shortlist", () => {
    const models = [
      "openrouter/free",
      "qwen/qwen3.6-plus:free",
      "nvidia/nemotron-3-super-120b-a12b:free",
      "google/gemini-3-pro",
      "openai/gpt-5",
      "anthropic/claude-sonnet-4.5",
      "some/other-model",
    ]

    const featured = getFeaturedModelCandidates(models)

    expect(featured.length).toBeGreaterThan(0)
    expect(featured[0]).toBe("qwen/qwen3.6-plus:free")
    expect(featured).toContain("openrouter/free")
    expect(featured).toContain("openai/gpt-5")
  })

  test("summarizes model slots for concise startup output", () => {
    const summary = summarizeModelSlots({
      defaultModel: "model-default",
      bigModel: "model-big",
      sonnetModel: "model-sonnet",
      haikuModel: "model-haiku",
    })

    expect(summary).toContain("default=model-default")
    expect(summary).toContain("opus=model-big")
    expect(summary).toContain("sonnet=model-sonnet")
    expect(summary).toContain("haiku=model-haiku")
  })

  test("filters models by search text and keeps featured ranking", () => {
    const models = [
      "openrouter/free",
      "qwen/qwen3.6-plus:free",
      "qwen/qwen3.6-plus",
      "google/gemini-3-pro",
      "openai/gpt-5",
      "anthropic/claude-sonnet-4.5",
      "meta/llama-4",
    ]

    const filtered = filterModelsBySearch(models, "qwen")

    expect(filtered).toHaveLength(2)
    expect(filtered[0]).toBe("qwen/qwen3.6-plus:free")
    expect(filtered[1]).toBe("qwen/qwen3.6-plus")
  })

  test("returns all models when search text is empty", () => {
    const models = [
      "some/other-model",
      "openai/gpt-5",
      "qwen/qwen3.6-plus:free",
    ]

    const filtered = filterModelsBySearch(models, "")

    expect(filtered).toContain("some/other-model")
    expect(filtered[0]).toBe("qwen/qwen3.6-plus:free")
  })

  test("builds compact search status label", () => {
    expect(buildSearchStatusLabel("op", 9)).toBe("op (9 matches)")
    expect(buildSearchStatusLabel("", 1)).toBe("(1 match)")
  })

  test("builds concise provider display label", () => {
    expect(
      buildProviderDisplayLabel({
        label: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        isActive: true,
      }),
    ).toBe("OpenRouter [active] (openrouter.ai)")
  })

  test("extracts unique copilot model ids from cached models payload", () => {
    const ids = getCopilotModelIds({
      data: [
        { id: "claude-sonnet-4" },
        { id: "gpt-5" },
        { id: "claude-sonnet-4" },
      ],
    })

    expect(ids).toEqual(["claude-sonnet-4", "gpt-5"])
  })

  test("returns empty list when cached models payload is missing", () => {
    expect(getCopilotModelIds(undefined)).toEqual([])
    expect(getCopilotModelIds({ data: [] })).toEqual([])
  })
})
