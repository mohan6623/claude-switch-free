import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import consola from "consola"

export class HTTPError extends Error {
  response: Response

  constructor(message: string, response: Response) {
    super(message)
    this.response = response
  }
}

export async function forwardError(c: Context, error: unknown) {
  consola.error("Error occurred:", error)

  if (error instanceof HTTPError) {
    const errorText = await error.response.text()
    let errorJson: unknown
    try {
      errorJson = JSON.parse(errorText)
    } catch {
      errorJson = errorText
    }
    consola.error("HTTP error:", errorJson)

    const responseHeaders =
      error.response.status === 429 ?
        pickRateLimitHeaders(error.response)
      : undefined

    return c.json(
      {
        error: {
          message: errorText,
          type: "error",
        },
      },
      error.response.status as ContentfulStatusCode,
      responseHeaders,
    )
  }

  return c.json(
    {
      error: {
        message: (error as Error).message,
        type: "error",
      },
    },
    500,
  )
}

function pickRateLimitHeaders(response: Response): Record<string, string> {
  const headerNames = [
    "retry-after",
    "ratelimit-reset",
    "x-ratelimit-reset",
    "x-ratelimit-reset-requests",
    "x-ratelimit-reset-tokens",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-remaining-tokens",
    "x-ratelimit-limit-requests",
    "x-ratelimit-limit-tokens",
  ]

  const selected: Record<string, string> = {}
  for (const headerName of headerNames) {
    const value = response.headers.get(headerName)
    if (value) {
      selected[headerName] = value
    }
  }

  return selected
}
