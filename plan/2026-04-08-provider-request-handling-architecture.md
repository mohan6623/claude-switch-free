# Provider Request Handling Architecture Plan

Status: Source of truth
Owner: Copilot
Date: 2026-04-08

## 1. Objective
Build a structured, policy-driven request handling system for the proxy that works across many providers (including auth-based providers), with explicit control over retries, fallback behavior, and upstream call amplification.

## 2. Selected Option
Adopt a policy-driven architecture inspired by LiteLLM and Portkey patterns:
- Per-provider policy mode: `strict`, `balanced`, `resilient`
- Hard request budget: cap total upstream calls per user request
- Retry-after aware retries when enabled
- Compatibility fallback separately controlled from transport retry

Why this option:
- Fits multi-provider and auth-based environments
- Prevents hidden request fan-out on free-tier providers
- Keeps backward compatibility via `balanced` default
- Is simple to operate from switch settings

## 3. Behavioral Contract
### 3.1 Modes
- `strict`
  - No automatic 429 retry
  - No compatibility fallback re-submit
  - Exactly 1 upstream provider call per incoming request
- `balanced` (default)
  - Bounded 429 retries
  - Compatibility fallback allowed
  - Total upstream call budget enforced
- `resilient`
  - Larger bounded retry budget
  - Compatibility fallback allowed
  - Total upstream call budget enforced

### 3.2 Non-negotiable safety rule
Every provider request path must enforce `maxTotalUpstreamCalls` for a single incoming request, regardless of retry/fallback path.

## 4. Scope
### 4.1 In scope
- Persist request handling mode per provider profile
- Expose mode in `copilot-api switch` add/update flows
- Thread mode into runtime provider config
- Enforce mode in openai-compatible completion loop
- Add regression tests for strict and non-strict behavior
- Update docs for start/switch behavior

### 4.2 Out of scope
- New web settings UI
- Major redesign of existing route surfaces
- Non-provider Copilot mode behavior changes

## 5. File-level Implementation Plan
### 5.1 Configuration and typing
1. Modify `src/lib/provider-config.ts`
- Add request handling mode type union.
- Extend `ProviderConfig` and `ResolveProviderOptions` with mode field.
- Parse mode from CLI/env for explicit startup paths.
- Ensure `resolveProviderConfigFromProfile` carries persisted mode.

2. Modify `src/lib/startup-config.ts`
- Add `requestHandlingMode` on `ProviderProfile`.
- In sanitize/load path, normalize missing/invalid values to `balanced`.
- Preserve backward compatibility with existing startup-config files.

### 5.2 Switch wizard integration
3. Modify `src/start.ts`
- Add mode prompt helper for add/update provider flows.
- Add mode update path in provider update menu.
- Include mode in profile persistence.
- Include mode in `buildSelectionFromProfile` and saved startup selection mapping.

4. Modify `src/start.ts` command args
- Add optional start override flag for mode (CLI + env pass-through).
- Add explicit configuration detection for this new override.

### 5.3 Runtime request handling engine
5. Modify `src/services/copilot/create-chat-completions.ts`
- Introduce internal policy preset resolver by mode.
- Replace fixed constants usage with policy values.
- Enforce hard `maxTotalUpstreamCalls` in the while-loop.
- Gate 429 retries by mode policy.
- Gate compatibility fallback re-submits by mode policy.
- Keep cooldown serialization and provider queue behavior.

### 5.4 Tests and docs
6. Modify `tests/create-chat-completions.test.ts`
- Add strict mode tests:
  - 429 fails after one call
  - non-multimodal error fails after one call
  - unsupported parameter error fails after one call
- Preserve existing balanced behavior tests.

7. Modify `tests/startup-config.test.ts`
- Assert persisted mode roundtrip.
- Assert sanitize defaults to `balanced` for legacy configs.

8. Modify `README.md`
- Document provider request handling modes and semantics.
- Document how strict mode maps to one upstream call.

## 6. Execution Order
1. Type/schema plumbing
2. Switch prompt + persistence wiring
3. Runtime policy enforcement
4. Tests
5. Docs
6. Full verification

## 7. Verification Plan
Run in `d:/Project/Resume2/copilot-api`:
1. `bun test tests/create-chat-completions.test.ts`
2. `bun test tests/startup-config.test.ts`
3. `bun test`
4. `bun run typecheck`

Manual behavior checks:
1. Set provider mode to `strict` via switch; force 429 and verify one upstream call.
2. Set provider mode to `balanced`; verify bounded retries and compatibility fallback still work.

## 8. Rollback/Safety
- Default mode is `balanced` for existing providers to avoid behavioral regression.
- Strict mode is opt-in per provider profile.
- Runtime call-budget cap prevents runaway loops even in resilient mode.

## 9. Success Criteria
- Provider profiles persist and load request handling mode correctly.
- Strict mode guarantees one upstream call per incoming request.
- Balanced/resilient modes remain bounded and observable.
- Tests and typecheck pass.
