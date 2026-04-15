import { Hono } from "hono"

import { forwardError } from "~/lib/error"

interface DashboardConversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: Array<unknown>
}

const conversations = new Map<string, DashboardConversation>()

function createConversationId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export const dashboardConversationsRoutes = new Hono()

dashboardConversationsRoutes.get("/conversations", async (c) => {
  try {
    return c.json({
      conversations: [...conversations.values()].map((item) => ({
        id: item.id,
        title: item.title,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    })
  } catch (error) {
    return await forwardError(c, error)
  }
})

dashboardConversationsRoutes.post("/conversations", async (c) => {
  try {
    const body = await c.req.json<{ title?: string }>()
    const title = body.title?.trim() || "New chat"
    const now = new Date().toISOString()
    const conversation: DashboardConversation = {
      id: createConversationId(),
      title,
      createdAt: now,
      updatedAt: now,
      messages: [],
    }

    conversations.set(conversation.id, conversation)

    return c.json(conversation, 201)
  } catch (error) {
    return await forwardError(c, error)
  }
})

dashboardConversationsRoutes.get("/conversations/:id/messages", async (c) => {
  try {
    const id = c.req.param("id")
    const conversation = conversations.get(id)

    if (!conversation) {
      return c.json(
        {
          error: {
            message: "Conversation not found",
            type: "error",
          },
        },
        404,
      )
    }

    return c.json({
      conversationId: conversation.id,
      messages: conversation.messages,
    })
  } catch (error) {
    return await forwardError(c, error)
  }
})

dashboardConversationsRoutes.patch("/conversations/:id", async (c) => {
  try {
    const id = c.req.param("id")
    const conversation = conversations.get(id)

    if (!conversation) {
      return c.json(
        {
          error: {
            message: "Conversation not found",
            type: "error",
          },
        },
        404,
      )
    }

    const body = await c.req.json<{ title?: string }>()
    const title = body.title?.trim()

    if (!title) {
      return c.json(
        {
          error: {
            message: "title is required",
            type: "error",
          },
        },
        400,
      )
    }

    const updated: DashboardConversation = {
      ...conversation,
      title,
      updatedAt: new Date().toISOString(),
    }

    conversations.set(id, updated)

    return c.json(updated)
  } catch (error) {
    return await forwardError(c, error)
  }
})

dashboardConversationsRoutes.delete("/conversations/:id", async (c) => {
  try {
    const id = c.req.param("id")
    const existed = conversations.delete(id)

    if (!existed) {
      return c.json(
        {
          error: {
            message: "Conversation not found",
            type: "error",
          },
        },
        404,
      )
    }

    return c.json({ ok: true })
  } catch (error) {
    return await forwardError(c, error)
  }
})
