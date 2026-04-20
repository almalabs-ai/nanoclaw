# NanoClaw Migration Guide

This file documents anchor patches applied to upstream files.
After each `/update-nanoclaw` merge, re-apply any patches listed here
if git auto-merge did not preserve them correctly.

## Identity Layer (skill/add-identity)

### src/types.ts — NewMessage identity fields

Added two optional fields to `NewMessage`:
- `canonical_id?: string` — resolved by identity layer
- `roles?: string[]` — resolved by identity layer

**Re-apply after upstream merge:** Add these two fields to `NewMessage` if they were dropped.

### src/channels/registry.ts — identity wrapper hook

Added `setIdentityWrapper(fn)` setter and applied wrapper in `registerChannel`.

**Re-apply after upstream merge:** Add the `IdentityWrapper` type, `_identityWrapper` variable, `setIdentityWrapper` function, and the wrapper check inside `registerChannel`.

### src/router.ts — identity attributes in message XML

Added `idAttr` and `rolesAttr` to the `<message>` tag in `formatMessages`.

**Re-apply after upstream merge:** Re-add the `idAttr`/`rolesAttr` lines and extend the template literal.

### src/container-runner.ts — NANOCLAW_CALLER_ID/ROLES env vars

Extended `ContainerInput` with `callerId?` and `callerRoles?`. Added env var injection in `buildContainerArgs`.

**Re-apply after upstream merge:** Add the two fields to `ContainerInput` and the injection code in `buildContainerArgs`.

## Policy Layer (skill/add-policy)

### src/ipc.ts — capability-based authorization

Added `callerId?`/`callerRoles?` to `processTaskIpc` data parameter. Added `callerCanDo(capability)` helper. Replaced `isMain` checks in `schedule_task`, `pause/resume/cancel/update_task`, `refresh_groups`, `register_group` with `callerCanDo(capability)` as an OR-gate. Added `checkCapability` and `loadPolicyConfig` imports, and module-level `_policyConfig`.

**Re-apply after upstream merge:** Add the `callerId`/`callerRoles` fields to the data type, add `let _policyConfig = loadPolicyConfig()` at module level, add the `callerCanDo` helper inside `processTaskIpc`, and replace each `isMain` check with the `callerCanDo` equivalent.

### src/index.ts — remote-control policy check

Added `checkCapability` and `loadPolicyConfig` imports. Added `const _policyConfig = loadPolicyConfig()` at module level. Replaced the `if (!group?.isMain)` guard in `handleRemoteControl` with a `hasRemoteControlAccess` OR-gate that checks `group.isMain` first, then falls back to `checkCapability(msg.canonical_id, 'system.remoteControl', msg.roles, _policyConfig)`.

**Re-apply after upstream merge:** Add the two imports, add `_policyConfig`, and replace the `if (!group?.isMain)` check in `handleRemoteControl` with the capability-checking block.
