# Routing and Switch Remediation Design

## Goal
Fix the verified functional defects in routed model translation, switch-mode persistence, and token counting while adding regression coverage so these failures cannot reappear.

## Scope
- In scope:
  - GPT routed multimodal translation keeps image content.
  - Change-model-mappings does not unexpectedly switch active provider.
  - Token count heuristics use effective translated model context for routed requests.
  - Switch-mode save paths consistently apply Claude settings sync semantics.
  - Add missing tests around handler routing and switch persistence behavior.
- Out of scope:
  - Broad architectural rewrite of startup UI flow.
  - Repo-wide lint cleanup unrelated to touched files.

## Constraints
- Keep existing public CLI behavior unless fixing a verified bug.
- Use TDD for each defect fix: failing test first, then minimal implementation.
- Keep changes small and composable to reduce regression risk.

## Approaches

### Approach A: Minimal In-Place Patches
Patch each bug directly inside existing files without extracting helpers.

Pros:
- Fastest raw implementation.
- Small diff in number of files.

Cons:
- Hard to test deeply for switch and token logic embedded in command handlers.
- Keeps business rules coupled to prompt orchestration.

### Approach B: Targeted Helper Extraction (Recommended)
Extract only bug-prone decision logic into tiny pure helpers, add focused tests, and wire handlers/commands to these helpers.

Pros:
- Enables deterministic TDD for previously hard-to-test paths.
- Keeps runtime behavior stable while improving maintainability.
- Limits refactor blast radius.

Cons:
- Slightly more files touched than direct patching.

### Approach C: Full Startup/Switch Modularization
Split start/switch orchestration into multiple services and rewrite major flow boundaries.

Pros:
- Long-term architecture quality.

Cons:
- High risk, high effort, and not required to resolve current defects.
- Increases chance of behavior regressions.

## Recommended Design
Use Approach B.

### 1) Translation correctness
- Adjust non-stream translation content filtering so GPT-mode removes only thinking blocks while preserving text and image blocks.
- Add regression test with routed GPT model and image block to confirm image_url survives translation.

### 2) Switch draft persistence correctness
- Ensure model-mapping edits mutate the active profile only and do not implicitly change activeProviderId.
- Move draft-to-config update logic into a small pure helper so we can test this behavior directly.

### 3) Token counting correctness for routed models
- Apply tool surcharge and multiplier logic based on effective translated model identity (or resolved model family), not raw routed string prefix.
- Add focused tests for routed Claude and routed Grok examples.

### 4) Save and sync consistency
- Centralize switch-mode persistence semantics so all save paths either intentionally sync Claude settings or intentionally skip with clear reason.
- Use one persistence utility and consume it from Continue/Add/Update/Switch and explicit Save paths.

### 5) Coverage expansion
- Add handler-level routing test that verifies provider override from routed model reaches createChatCompletions.
- Add targeted tests for new helpers.

## Test Strategy
- Per bug:
  1. Add failing test proving current defect.
  2. Implement minimal code to pass.
  3. Re-run targeted test file.
- Integration confidence:
  - Run full test suite after all fixes.
  - Run typecheck and build.
  - Run lint on touched files (and full lint if baseline allows).

## Execution Order
1. Environment gate: Bun executable accessible in shell.
2. Translation bug + tests.
3. Switch active-provider drift bug + tests.
4. Token-count routed-model bug + tests.
5. Switch save/sync consistency + tests.
6. Handler/provider override integration coverage.
7. Full verification gates.

## Risks and Mitigations
- Risk: Switch flow regressions due start.ts complexity.
  - Mitigation: isolate logic in pure helpers and add narrow tests.
- Risk: Existing lint baseline noise hides new issues.
  - Mitigation: enforce clean lint on touched files and report global baseline separately.
- Risk: Bun environment mismatch in current shell.
  - Mitigation: include explicit setup/validation step before execution.

## Success Criteria
- All listed defects have reproducing tests that fail before and pass after fixes.
- No active provider drift when changing model mappings.
- Routed GPT image content reaches OpenAI payload as image_url parts.
- Routed model token heuristics apply correctly.
- Verification commands produce passing evidence for tests, typecheck, and build.
