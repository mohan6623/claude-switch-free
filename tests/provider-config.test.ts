import { describe, expect, test } from "bun:test"

import {
  resolveProviderConfig,
  resolveProviderConfigFromProfile,
} from "../src/lib/provider-config"

describe("provider config resolution", () => {
  test("resolves saved preset profiles as OpenAI-compatible providers", () => {
    const provider = resolveProviderConfigFromProfile(
      {
        id: "cloudflare",
        baseUrl: "https://api.cloudflare.com/client/v4/accounts/test/ai/v1",
        apiKey: "cf-test",
        isPreset: true,
      },
      {
        defaultModel: "@cf/meta/llama-3.1-8b-instruct",
        smallModel: "@cf/meta/llama-3.1-8b-instruct",
      },
    )

    expect(provider).toMatchObject({
      id: "cloudflare",
      mode: "openai-compatible",
      baseUrl: "https://api.cloudflare.com/client/v4/accounts/test/ai/v1",
      apiKey: "cf-test",
      preferredModel: "@cf/meta/llama-3.1-8b-instruct",
      preferredSmallModel: "@cf/meta/llama-3.1-8b-instruct",
    })
  })

  test("resolves unknown provider ids when explicit OpenAI-compatible connection details are present", () => {
    const provider = resolveProviderConfig({
      provider: "future-provider",
      providerBaseUrl: "https://api.future.example/v1",
      providerApiKey: "future-test",
      providerModel: "future-model",
    })

    expect(provider).toMatchObject({
      id: "future-provider",
      mode: "openai-compatible",
      baseUrl: "https://api.future.example/v1",
      apiKey: "future-test",
      preferredModel: "future-model",
    })
  })
})
