import { createHash } from "node:crypto"

const SESSION_ID_HEADER_CANDIDATES = [
  "x-cpapi-session-id",
  "x-session-id",
  "x-claude-session-id",
  "anthropic-session-id",
]

const FALLBACK_FINGERPRINT_HEADER_CANDIDATES = [
  "authorization",
  "user-agent",
  "x-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
]

const FALLBACK_FINGERPRINT_PREFIX = "fp_"
const FALLBACK_FINGERPRINT_HEX_LENGTH = 24

export function resolveRequestSessionId(
  request: Request,
  payload?: unknown,
): string | undefined {
  const explicitSessionId = getSessionIdFromHeaders(request)
  if (explicitSessionId) {
    return explicitSessionId
  }

  const payloadSessionId = getSessionIdFromPayload(payload)
  if (payloadSessionId) {
    return payloadSessionId
  }

  return buildFallbackFingerprint(request)
}

function getSessionIdFromHeaders(request: Request): string | undefined {
  for (const headerName of SESSION_ID_HEADER_CANDIDATES) {
    const value = normalizeSessionId(request.headers.get(headerName))
    if (value) {
      return value
    }
  }

  return undefined
}

function getSessionIdFromPayload(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined
  }

  const user = normalizeSessionId(payload.user)
  if (user) {
    return user
  }

  const metadata = payload.metadata
  if (!isRecord(metadata)) {
    return undefined
  }

  return normalizeSessionId(metadata.user_id)
}

function buildFallbackFingerprint(request: Request): string | undefined {
  const parts: Array<string> = []

  for (const headerName of FALLBACK_FINGERPRINT_HEADER_CANDIDATES) {
    const value = request.headers.get(headerName)?.trim()
    if (value) {
      parts.push(`${headerName}:${value}`)
    }
  }

  if (parts.length === 0) {
    return undefined
  }

  const digest = createHash("sha256").update(parts.join("|"))
    .digest("hex")
  return `${FALLBACK_FINGERPRINT_PREFIX}${digest.slice(0, FALLBACK_FINGERPRINT_HEX_LENGTH)}`
}

function normalizeSessionId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input)
}
