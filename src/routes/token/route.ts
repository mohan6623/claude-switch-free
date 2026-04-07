import { Hono } from "hono"

import { state } from "~/lib/state"

export const tokenRoute = new Hono()

tokenRoute.get("/", (c) => {
  try {
    if (state.provider.mode !== "copilot") {
      return c.json({
        token: null,
        provider: state.provider.id,
        providerMode: state.provider.mode,
        hasProviderApiKey: Boolean(state.provider.apiKey),
      })
    }

    return c.json({
      token: state.copilotToken,
      provider: state.provider.id,
      providerMode: state.provider.mode,
    })
  } catch (error) {
    console.error("Error fetching token:", error)
    return c.json({ error: "Failed to fetch token", token: null }, 500)
  }
})
