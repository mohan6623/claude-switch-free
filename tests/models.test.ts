import { describe, test, expect } from "bun:test"
import {
  detectProvider,
  isGptModel,
  isAnthropicModel,
} from "../src/lib/models"

describe("detectProvider", () => {
  test("returns 'anthropic' for claude models", () => {
    expect(detectProvider("claude-sonnet-4")).toBe("anthropic")
    expect(detectProvider("claude-opus-4")).toBe("anthropic")
    expect(detectProvider("claude-haiku-4-5")).toBe("anthropic")
    expect(detectProvider("claude-3-5-sonnet-20241022")).toBe("anthropic")
  })

  test("returns 'openai' for GPT models", () => {
    expect(detectProvider("gpt-4.1")).toBe("openai")
    expect(detectProvider("gpt-4o")).toBe("openai")
    expect(detectProvider("gpt-4")).toBe("openai")
    expect(detectProvider("gpt-3.5-turbo")).toBe("openai")
  })

  test("returns 'openai' for o-series models", () => {
    expect(detectProvider("o1")).toBe("openai")
    expect(detectProvider("o1-mini")).toBe("openai")
    expect(detectProvider("o3-mini")).toBe("openai")
    expect(detectProvider("o4-mini")).toBe("openai")
  })

  test("returns 'google' for Gemini models", () => {
    expect(detectProvider("gemini-2.0-flash")).toBe("google")
    expect(detectProvider("gemini-2.0-pro")).toBe("google")
  })
})

describe("isGptModel", () => {
  test("returns true for GPT models", () => {
    expect(isGptModel("gpt-4.1")).toBe(true)
    expect(isGptModel("gpt-4o")).toBe(true)
    expect(isGptModel("o3-mini")).toBe(true)
  })

  test("returns false for non-GPT models", () => {
    expect(isGptModel("claude-sonnet-4")).toBe(false)
    expect(isGptModel("gemini-2.0-flash")).toBe(false)
  })
})

describe("isAnthropicModel", () => {
  test("returns true for Anthropic models", () => {
    expect(isAnthropicModel("claude-sonnet-4")).toBe(true)
    expect(isAnthropicModel("claude-opus-4")).toBe(true)
  })

  test("returns false for non-Anthropic models", () => {
    expect(isAnthropicModel("gpt-4o")).toBe(false)
    expect(isAnthropicModel("gemini-2.0-flash")).toBe(false)
  })
})
