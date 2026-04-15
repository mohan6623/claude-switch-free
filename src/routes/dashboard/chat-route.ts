import { Hono } from "hono"

import { forwardError } from "~/lib/error"
import { handleCompletion } from "~/routes/chat-completions/handler"

export const dashboardChatRoutes = new Hono()

dashboardChatRoutes.post("/chat/completions", async (c) => {
  try {
    return await handleCompletion(c)
  } catch (error) {
    return await forwardError(c, error)
  }
})
