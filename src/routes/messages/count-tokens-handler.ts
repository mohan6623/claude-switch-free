import type { Context } from "hono"

import consola from "consola"

import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"

import { type AnthropicMessagesPayload } from "./anthropic-types"
import { translateToOpenAI } from "./non-stream-translation"
import { applyAnthropicTokenHeuristics } from "./token-heuristics"

/**
 * Handles token counting for Anthropic messages
 */
export async function handleCountTokens(c: Context) {
  try {
    const anthropicBeta = c.req.header("anthropic-beta")

    const anthropicPayload = await c.req.json<AnthropicMessagesPayload>()

    const translated = translateToOpenAI(anthropicPayload)
    const openAIPayload = translated.payload

    const selectedModel = state.models?.data.find(
      (model) => model.id === openAIPayload.model,
    )

    if (!selectedModel) {
      consola.warn("Model not found, returning default token count")
      return c.json({
        input_tokens: 1,
      })
    }

    const tokenCount = await getTokenCount(openAIPayload, selectedModel)

    let mcpToolExist = false
    if (anthropicBeta?.startsWith("claude-code")) {
      mcpToolExist = Boolean(
        anthropicPayload.tools?.some((tool) => tool.name.startsWith("mcp__")),
      )
    }

    const finalTokenCount = applyAnthropicTokenHeuristics({
      inputTokens: tokenCount.input,
      outputTokens: tokenCount.output,
      modelId: openAIPayload.model,
      hasTools: Boolean(anthropicPayload.tools?.length),
      mcpToolExists: mcpToolExist,
    })

    consola.info("Token count:", finalTokenCount)

    return c.json({
      input_tokens: finalTokenCount,
    })
  } catch (error) {
    consola.error("Error counting tokens:", error)
    return c.json({
      input_tokens: 1,
    })
  }
}
