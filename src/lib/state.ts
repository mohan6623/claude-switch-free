import type { ModelsResponse } from "~/services/copilot/get-models"
import type { ProviderConfig } from "~/lib/provider-config"

export interface CopilotRateLimitState {
  cooldownUntilMs: number
  responseBody: string
  responseHeaders: Record<string, string>
  sourceEndpoint: "chat/completions" | "responses"
}

export interface State {
  githubToken?: string
  copilotToken?: string
  provider: ProviderConfig
  copilotRateLimitState?: CopilotRateLimitState

  accountType: string
  models?: ModelsResponse
  vsCodeVersion?: string

  manualApprove: boolean
  rateLimitWait: boolean
  showToken: boolean

  // Rate limiting configuration
  rateLimitSeconds?: number
  lastRequestTimestamp?: number
}

export const state: State = {
  provider: {
    id: "copilot",
    mode: "copilot",
  },
  accountType: "individual",
  manualApprove: false,
  rateLimitWait: false,
  showToken: false,
}
