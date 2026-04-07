import { describe, expect, test } from "bun:test"

import {
  decodeRoutedModel,
  encodeRoutedModel,
  resolveRequestedModel,
  summarizeRoutedModel,
} from "../src/lib/slot-routing"

describe("slot routing model encoding", () => {
  test("encodes and decodes provider and model", () => {
    const encoded = encodeRoutedModel("openrouter", "qwen/qwen3.6-plus:free")
    const decoded = decodeRoutedModel(encoded)

    expect(decoded).toEqual({
      providerId: "openrouter",
      model: "qwen/qwen3.6-plus:free",
    })
  })

  test("returns raw model when no route encoding is present", () => {
    const resolved = resolveRequestedModel("claude-sonnet-4-5")

    expect(resolved.model).toBe("claude-sonnet-4-5")
    expect(resolved.providerId).toBeUndefined()
  })

  test("summarizes routed model for list display", () => {
    const encoded = encodeRoutedModel("copilot", "claude-sonnet-4.5")

    expect(summarizeRoutedModel(encoded)).toBe("claude-sonnet-4.5 @ copilot")
  })
})
