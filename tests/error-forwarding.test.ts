import { describe, expect, test } from "bun:test"
import { Hono } from "hono"

import { forwardError, HTTPError } from "../src/lib/error"

describe("forwardError", () => {
  test("forwards retry headers on upstream 429", async () => {
    const app = new Hono()

    app.get("/", async (c) => {
      const upstream = new Response(
        JSON.stringify({ status: 429, title: "Too Many Requests" }),
        {
          status: 429,
          headers: {
            "content-type": "application/problem+json",
            "retry-after": "2",
            "x-ratelimit-reset-requests": "1s",
          },
        },
      )

      return await forwardError(c, new HTTPError("rate limited", upstream))
    })

    const response = await app.request("/")

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("2")
    expect(response.headers.get("x-ratelimit-reset-requests")).toBe("1s")

    const payload = (await response.json()) as {
      error?: { message?: string }
    }
    expect(payload.error?.message).toContain("Too Many Requests")
  })
})
