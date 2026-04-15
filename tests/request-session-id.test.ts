import { describe, expect, test } from "bun:test"

import { resolveRequestSessionId } from "../src/lib/session-id"

describe("resolveRequestSessionId", () => {
  test("uses explicit session header before payload hints", () => {
    const request = new Request("https://proxy.local/v1/messages", {
      headers: {
        "x-cpapi-session-id": "  session-header-1  ",
      },
    })

    const id = resolveRequestSessionId(request, {
      user: "payload-user-1",
      metadata: {
        user_id: "metadata-user-1",
      },
    })

    expect(id).toBe("session-header-1")
  })

  test("uses payload user when no session header is present", () => {
    const request = new Request("https://proxy.local/v1/chat/completions")

    const id = resolveRequestSessionId(request, {
      user: "payload-user-1",
    })

    expect(id).toBe("payload-user-1")
  })

  test("uses payload metadata.user_id when no explicit user is present", () => {
    const request = new Request("https://proxy.local/v1/messages")

    const id = resolveRequestSessionId(request, {
      metadata: {
        user_id: "anthropic-user-7",
      },
    })

    expect(id).toBe("anthropic-user-7")
  })

  test("falls back to deterministic request fingerprint when needed", () => {
    const requestOne = new Request("https://proxy.local/v1/chat/completions", {
      headers: {
        authorization: "Bearer abc123",
        "user-agent": "claude-code/1.0.0",
      },
    })

    const requestTwo = new Request("https://proxy.local/v1/chat/completions", {
      headers: {
        authorization: "Bearer abc123",
        "user-agent": "claude-code/1.0.0",
      },
    })

    const firstId = resolveRequestSessionId(requestOne)
    const secondId = resolveRequestSessionId(requestTwo)

    expect(firstId).toBeDefined()
    expect(secondId).toBeDefined()
    expect(firstId).toBe(secondId)
    expect(firstId?.startsWith("fp_")).toBe(true)
  })

  test("returns undefined when no session signals are available", () => {
    const request = new Request("https://proxy.local/v1/messages")

    const id = resolveRequestSessionId(request)

    expect(id).toBeUndefined()
  })
})
