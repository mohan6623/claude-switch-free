/**
 * Model detection utilities for identifying provider families.
 *
 * Used to apply provider-specific translation logic when converting
 * between Anthropic and OpenAI formats.
 */

export type ModelProvider = 'anthropic' | 'openai' | 'google' | 'unknown'

/**
 * Determines the provider family for a given model ID.
 */
export function detectProvider(modelId: string): ModelProvider {
  const id = modelId.toLowerCase()

  if (
    id.startsWith('claude-') ||
    id.startsWith('anthropic/')
  ) {
    return 'anthropic'
  }

  if (
    id.startsWith('gpt-') ||
    id.startsWith('o') && id.match(/^o\d/) ||   // o1, o3-mini, etc.
    id.startsWith('openai/')
  ) {
    return 'openai'
  }

  if (
    id.startsWith('gemini-') ||
    id.startsWith('google/')
    || id.startsWith('models/gemini')
  ) {
    return 'google'
  }

  return 'unknown'
}

/** Whether the model is from the GPT / OpenAI family. */
export function isGptModel(modelId: string): boolean {
  return detectProvider(modelId) === 'openai'
}

/** Whether the model is from the Anthropic / Claude family. */
export function isAnthropicModel(modelId: string): boolean {
  return detectProvider(modelId) === 'anthropic'
}
