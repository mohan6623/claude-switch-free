import { describe, expect, test } from "bun:test"

import {
  applyAnthropicTokenHeuristics,
  getTokenHeuristicFamily,
} from "../src/routes/messages/token-heuristics"

describe("token heuristics", () => {
  test("detects model family from effective model id", () => {
    expect(getTokenHeuristicFamily("claude-sonnet-4")).toBe("claude")
    expect(getTokenHeuristicFamily("grok-4-fast")).toBe("grok")
    expect(getTokenHeuristicFamily("qwen/qwen3.6-plus:free")).toBe("other")
  })

  test("applies claude surcharge and multiplier when tools are present", () => {
    const total = applyAnthropicTokenHeuristics({
      inputTokens: 100,
      outputTokens: 20,
      modelId: "claude-sonnet-4",
      hasTools: true,
      mcpToolExists: false,
    })

    expect(total).toBe(536)
  })

  test("applies grok surcharge and multiplier when tools are present", () => {
    const total = applyAnthropicTokenHeuristics({
      inputTokens: 100,
      outputTokens: 20,
      modelId: "grok-4-fast",
      hasTools: true,
      mcpToolExists: false,
    })

    expect(total).toBe(618)
  })

  test("skips surcharge when mcp tool exists", () => {
    const total = applyAnthropicTokenHeuristics({
      inputTokens: 100,
      outputTokens: 20,
      modelId: "claude-sonnet-4",
      hasTools: true,
      mcpToolExists: true,
    })

    expect(total).toBe(138)
  })
})
