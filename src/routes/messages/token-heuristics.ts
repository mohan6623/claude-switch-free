export type TokenHeuristicFamily = "claude" | "grok" | "other"

export function getTokenHeuristicFamily(modelId: string): TokenHeuristicFamily {
  const value = modelId.trim().toLowerCase()

  if (value.startsWith("claude")) {
    return "claude"
  }

  if (value.startsWith("grok")) {
    return "grok"
  }

  return "other"
}

export function applyAnthropicTokenHeuristics(input: {
  inputTokens: number
  outputTokens: number
  modelId: string
  hasTools: boolean
  mcpToolExists: boolean
}): number {
  const family = getTokenHeuristicFamily(input.modelId)

  let adjustedInput = input.inputTokens
  if (input.hasTools && !input.mcpToolExists) {
    if (family === "claude") {
      adjustedInput = adjustedInput + 346
    } else if (family === "grok") {
      adjustedInput = adjustedInput + 480
    }
  }

  let total = adjustedInput + input.outputTokens
  if (family === "claude") {
    total = Math.round(total * 1.15)
  } else if (family === "grok") {
    total = Math.round(total * 1.03)
  }

  return total
}
