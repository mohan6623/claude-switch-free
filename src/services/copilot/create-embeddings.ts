import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export const createEmbeddings = async (payload: EmbeddingRequest) => {
  if (state.provider.mode === "openai-compatible") {
    return await createOpenAICompatibleEmbeddings(payload)
  }

  if (!state.copilotToken) throw new Error("Copilot token not found")

  const response = await fetch(`${copilotBaseUrl(state)}/embeddings`, {
    method: "POST",
    headers: copilotHeaders(state),
    body: JSON.stringify(payload),
  })

  if (!response.ok) throw new HTTPError("Failed to create embeddings", response)

  return (await response.json()) as EmbeddingResponse
}

async function createOpenAICompatibleEmbeddings(payload: EmbeddingRequest) {
  const provider = state.provider

  if (!provider.baseUrl || !provider.apiKey) {
    throw new Error(
      "Provider mode is enabled but base URL or API key is missing",
    )
  }

  const response = await fetch(`${provider.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`,
      ...(provider.headers || {}),
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) throw new HTTPError("Failed to create embeddings", response)

  return (await response.json()) as EmbeddingResponse
}

export interface EmbeddingRequest {
  input: string | Array<string>
  model: string
}

export interface Embedding {
  object: string
  embedding: Array<number>
  index: number
}

export interface EmbeddingResponse {
  object: string
  data: Array<Embedding>
  model: string
  usage: {
    prompt_tokens: number
    total_tokens: number
  }
}
