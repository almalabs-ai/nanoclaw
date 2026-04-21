# SDLC Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the infrastructure code and docs that the `/build-it` SDLC pipeline will depend on: a health socket endpoint, deploy scripts, doc-freshness enforcement, doc scaffolding, and anchor-doc updates.

**Architecture:** A new `src/health.ts` module exposes a Unix domain socket that responds with live process status JSON; `scripts/docs-scan.ts` provides a pure-function tree-vs-docs auditor; `src/docs-freshness.test.ts` runs those checks in CI (vitest). Three small shell/TypeScript scripts (`remote-deploy.sh`, `smoke-send.ts`, `docs-scan.ts`) are drop-in tools the SDLC skills will invoke. All code is added in isolated modules so nothing breaks if the env var opt-ins are absent.

**Tech Stack:** TypeScript (NodeNext), `node:net` UDS server, `node:fs`/`node:path`/`node:child_process` (zero new npm deps), vitest, bash.

---

## File Map

| Action | Path | Purpose |
|---|---|---|
| Create | `src/health.ts` | UDS health server; started from `src/index.ts` |
| Create | `src/health.test.ts` | vitest coverage for health server |
| Modify | `src/config.ts` | Export `HEALTH_SOCKET_PATH` constant |
| Modify | `src/index.ts` | Wire health server startup + graceful stop |
| Create | `scripts/docs-scan.ts` | Tree-vs-docs auditor (pure fn, zero network) |
| Create | `src/docs-freshness.test.ts` | vitest assertions that block stale-docs PRs |
| Create | `scripts/remote-deploy.sh` | Droplet-side upgrade script (bash) |
| Create | `scripts/smoke-send.ts` | Post-deploy health probe via SSH |
| Create | `.github/workflows/lint.yml` | CI lint job (eslint + prettier-check) |
| Create | `docs/superpowers/decisions/.gitkeep` | ADR directory scaffold |
| Create | `docs/superpowers/reviews/.gitkeep` | Review artifact directory scaffold |
| Create | `docs/superpowers/INDEX.md` | Append-only mission index |
| Create | `docs/DEPLOY-LOG.md` | Append-only deploy history |
| Modify | `CLAUDE.md` | Add `/build-it`, `/catch-up`, SDLC skills to skill table; pointer to INDEX.md |
| Modify | `CONTRIBUTING.md` | Short "How changes flow through /build-it" section |

---

## Task 1: Doc Scaffold

**Files:**
- Create: `docs/superpowers/decisions/.gitkeep`
- Create: `docs/superpowers/reviews/.gitkeep`
- Create: `docs/superpowers/INDEX.md`
- Create: `docs/DEPLOY-LOG.md`

- [ ] **Step 1: Create the decisions and reviews directories**

```bash
mkdir -p docs/superpowers/decisions docs/superpowers/reviews
touch docs/superpowers/decisions/.gitkeep docs/superpowers/reviews/.gitkeep
```

- [ ] **Step 2: Create INDEX.md**

Write `docs/superpowers/INDEX.md` with this exact content:

```markdown
# Mission Index

One line per `/build-it` mission, append-only, newest first.
Format: `DATE | LINEAR | TYPE | SLUG | spec plan review pr tag deploy`

## Index

<!-- missions go here — newest first -->
```

- [ ] **Step 3: Create DEPLOY-LOG.md**

Write `docs/DEPLOY-LOG.md` with this exact content:

```markdown
# Deploy Log

One line per production deploy, append-only, newest first.
Written by `nanoclaw-deploy-droplet` skill (phase [9]).
Format: `ISO-TS | TAG | FROM-TAG | STATUS | HOST`

## Log

<!-- deploys go here — newest first -->
```

- [ ] **Step 4: Verify the directories exist**

```bash
ls docs/superpowers/decisions docs/superpowers/reviews
ls docs/superpowers/INDEX.md docs/DEPLOY-LOG.md
```

Expected: four paths print with no errors.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/decisions/.gitkeep docs/superpowers/reviews/.gitkeep \
        docs/superpowers/INDEX.md docs/DEPLOY-LOG.md
git commit -m "docs: scaffold superpowers decisions/reviews dirs and index files"
```

---

## Task 2: `HEALTH_SOCKET_PATH` config constant

**Files:**
- Modify: `src/config.ts` (append one export)
- Create: `src/health.test.ts` (first test, just the config check)

- [ ] **Step 1: Write the failing test first**

Create `src/health.test.ts` with only this content:

```typescript
// src/health.test.ts
import { describe, it, expect } from 'vitest';
import { HEALTH_SOCKET_PATH } from './config.js';

describe('HEALTH_SOCKET_PATH config', () => {
  it('is a string (empty when env var unset)', () => {
    expect(typeof HEALTH_SOCKET_PATH).toBe('string');
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL (export not found)**

```bash
npx vitest run src/health.test.ts
```

Expected: fails with `does not provide an export named 'HEALTH_SOCKET_PATH'`.

- [ ] **Step 3: Add the export to `src/config.ts`**

Append this line after the last `export const` at the bottom of `src/config.ts`:

```typescript
export const HEALTH_SOCKET_PATH = process.env.HEALTH_SOCKET_PATH || '';
```

- [ ] **Step 4: Run the test — expect PASS**

```bash
npx vitest run src/health.test.ts
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/health.test.ts
git commit -m "feat(config): add HEALTH_SOCKET_PATH export"
```

---

## Task 3: `src/health.ts` — Unix domain socket server

**Files:**
- Create: `src/health.ts`
- Modify: `src/health.test.ts` (add the real tests)

- [ ] **Step 1: Replace `src/health.test.ts` with the full test file**

```typescript
// src/health.test.ts
import { afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { HEALTH_SOCKET_PATH } from './config.js';
import { startHealthServer } from './health.js';

const tmpSock = path.join(os.tmpdir(), `nanoclaw-health-test-${process.pid}.sock`);

afterEach(() => {
  fs.rmSync(tmpSock, { force: true });
});

function readSocket(socketPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath, () => {
      let buf = '';
      client.on('data', (d) => { buf += d.toString(); });
      client.on('end', () => resolve(buf));
      client.on('error', reject);
    });
    client.on('error', reject);
  });
}

describe('HEALTH_SOCKET_PATH config', () => {
  it('is a string (empty when env var unset)', () => {
    expect(typeof HEALTH_SOCKET_PATH).toBe('string');
  });
});

describe('startHealthServer', () => {
  it('responds with JSON containing status ok', async () => {
    const srv = startHealthServer(tmpSock, () => ({
      channelsConnected: ['telegram'],
      dbOk: true,
      registeredGroupsCount: 2,
    }));

    const raw = await readSocket(tmpSock);
    await srv.stop();

    const status = JSON.parse(raw.trim()) as Record<string, unknown>;
    expect(status.status).toBe('ok');
    expect(status.channelsConnected).toEqual(['telegram']);
    expect(status.dbOk).toBe(true);
    expect(status.registeredGroupsCount).toBe(2);
    expect(typeof status.version).toBe('string');
    expect(typeof status.uptimeMs).toBe('number');
    expect(status.uptimeMs as number).toBeGreaterThanOrEqual(0);
  });

  it('handles concurrent connections independently', async () => {
    const srv = startHealthServer(tmpSock, () => ({
      channelsConnected: [],
      dbOk: true,
      registeredGroupsCount: 0,
    }));

    const [a, b] = await Promise.all([readSocket(tmpSock), readSocket(tmpSock)]);
    await srv.stop();

    expect((JSON.parse(a.trim()) as Record<string, unknown>).status).toBe('ok');
    expect((JSON.parse(b.trim()) as Record<string, unknown>).status).toBe('ok');
  });

  it('stop() cleans up the socket file', async () => {
    const srv = startHealthServer(tmpSock, () => ({
      channelsConnected: [],
      dbOk: false,
      registeredGroupsCount: 0,
    }));
    await srv.stop();
    expect(fs.existsSync(tmpSock)).toBe(false);
  });

  it('recovers from a stale socket file left by a previous crash', async () => {
    fs.writeFileSync(tmpSock, '');
    const srv = startHealthServer(tmpSock, () => ({
      channelsConnected: [],
      dbOk: true,
      registeredGroupsCount: 0,
    }));
    const raw = await readSocket(tmpSock);
    await srv.stop();
    expect((JSON.parse(raw.trim()) as Record<string, unknown>).status).toBe('ok');
  });
});
```

- [ ] **Step 2: Run the tests — expect FAIL (no health.ts yet)**

```bash
npx vitest run src/health.test.ts
```

Expected: FAIL — `Cannot find module './health.js'`.

- [ ] **Step 3: Implement `src/health.ts`**

```typescript
// src/health.ts
import fs from 'node:fs';
import net from 'node:net';

export interface HealthStatus {
  status: 'ok';
  version: string;
  uptimeMs: number;
  channelsConnected: string[];
  dbOk: boolean;
  registeredGroupsCount: number;
}

export interface HealthGetters {
  channelsConnected: string[];
  dbOk: boolean;
  registeredGroupsCount: number;
}

export interface HealthServer {
  stop(): Promise<void>;
}

export function startHealthServer(
  socketPath: string,
  getStatus: () => HealthGetters,
): HealthServer {
  const startTime = Date.now();

  // Read package.json version once at startup; ../package.json resolves from
  // dist/health.js (compiled) and from src/health.ts (tsx dev) equally.
  let version = 'unknown';
  try {
    const pkgUrl = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(fs.readFileSync(pkgUrl, 'utf8')) as { version: string };
    version = pkg.version;
  } catch { /* non-fatal — version stays 'unknown' */ }

  // Remove stale socket file so bind succeeds after an unclean shutdown
  try { fs.unlinkSync(socketPath); } catch { /* doesn't exist — fine */ }

  const server = net.createServer((socket) => {
    const payload: HealthStatus = {
      status: 'ok',
      version,
      uptimeMs: Date.now() - startTime,
      ...getStatus(),
    };
    socket.end(JSON.stringify(payload) + '\n');
  });

  server.listen(socketPath);

  return {
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          try { fs.unlinkSync(socketPath); } catch { /* already gone */ }
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
```

- [ ] **Step 4: Run the tests — expect PASS**

```bash
npx vitest run src/health.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/health.ts src/health.test.ts
git commit -m "feat(health): Unix domain socket health server"
```

---

## Task 4: Wire health server into `src/index.ts`

**Files:**
- Modify: `src/index.ts`

The health server is entirely opt-in — if `HEALTH_SOCKET_PATH` is empty and `NANOCLAW_HEALTH` is also absent, nothing starts. Existing behaviour is unchanged.

- [ ] **Step 1: Add imports to `src/index.ts`**

At the top of `src/index.ts`, add the health import after the `import path from 'path'` line:

```typescript
import { startHealthServer, type HealthServer } from './health.js';
```

In the destructured import from `'./config.js'`, add `HEALTH_SOCKET_PATH` and `DATA_DIR`:

```typescript
import {
  ASSISTANT_NAME,
  DATA_DIR,
  DEFAULT_TRIGGER,
  getTriggerPattern,
  GROUPS_DIR,
  HEALTH_SOCKET_PATH,
  IDLE_TIMEOUT,
  MAX_MESSAGES_PER_PROMPT,
  ONECLI_URL,
  POLL_INTERVAL,
  TIMEZONE,
} from './config.js';
```

- [ ] **Step 2: Add the `healthServer` variable near the top of `main()`**

Find where `const channels: Channel[] = [];` is declared inside `main()`. Add directly after it:

```typescript
let healthServer: HealthServer | null = null;
```

- [ ] **Step 3: Start the health server after `startSessionCleanup()`**

Find the line `startSessionCleanup();` (around line 771). Add directly after it:

```typescript
const healthSocketPath =
  HEALTH_SOCKET_PATH ||
  (process.env.NANOCLAW_HEALTH ? path.join(DATA_DIR, 'health.sock') : '');
if (healthSocketPath) {
  healthServer = startHealthServer(healthSocketPath, () => ({
    channelsConnected: channels
      .filter((ch) => ch.isConnected())
      .map((ch) => ch.name),
    dbOk: true,
    registeredGroupsCount: Object.keys(registeredGroups).length,
  }));
  logger.info({ socketPath: healthSocketPath }, 'Health server started');
}
```

- [ ] **Step 4: Stop the health server in the shutdown handler**

Find:

```typescript
const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await queue.shutdown(10000);
    for (const ch of channels) await ch.disconnect();
    process.exit(0);
  };
```

Change it to:

```typescript
const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await queue.shutdown(10000);
    for (const ch of channels) await ch.disconnect();
    if (healthServer) await healthServer.stop().catch(() => {});
    process.exit(0);
  };
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 6: Run the full test suite**

```bash
npm test
```

Expected: all existing tests pass plus the new health tests.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "feat(index): start health socket server when HEALTH_SOCKET_PATH or NANOCLAW_HEALTH is set"
```

---

## Task 5: `scripts/docs-scan.ts` — tree-vs-docs auditor

**Files:**
- Create: `scripts/docs-scan.ts`

Uses `spawnSync` (not `exec`) so there is no shell-injection surface — the git command is hard-coded array args.

- [ ] **Step 1: Create `scripts/docs-scan.ts`**

```typescript
// scripts/docs-scan.ts
// Tree-vs-docs auditor. Run: npx tsx scripts/docs-scan.ts
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export interface ScanResult {
  pass: boolean;
  failures: string[];
}

export function scanDocs(repoRoot: string): ScanResult {
  const failures: string[] = [];

  // --- Check 1: Every .claude/skills/*/SKILL.md 'name' appears in CLAUDE.md ---
  const claudeMdPath = path.join(repoRoot, 'CLAUDE.md');
  const claudeMd = fs.existsSync(claudeMdPath)
    ? fs.readFileSync(claudeMdPath, 'utf8')
    : '';
  const skillsDir = path.join(repoRoot, '.claude', 'skills');
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMd = path.join(skillsDir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;
      const content = fs.readFileSync(skillMd, 'utf8');
      const nameMatch = content.match(/^name:\s*(.+)$/m);
      if (!nameMatch) continue;
      const name = nameMatch[1].trim();
      if (!claudeMd.includes(`/${name}`)) {
        failures.push(
          `Skill '${name}' (.claude/skills/${entry.name}) not listed in CLAUDE.md skill table`,
        );
      }
    }
  }

  // --- Check 2: Every non-test src/channels/*.ts has an active import in index.ts ---
  const channelsDir = path.join(repoRoot, 'src', 'channels');
  const barrelPath = path.join(channelsDir, 'index.ts');
  if (fs.existsSync(channelsDir) && fs.existsSync(barrelPath)) {
    const barrel = fs.readFileSync(barrelPath, 'utf8');
    // Keep only lines that are not full-line comments
    const activeLines = barrel
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');
    for (const entry of fs.readdirSync(channelsDir)) {
      if (
        !entry.endsWith('.ts') ||
        entry.endsWith('.test.ts') ||
        entry === 'index.ts' ||
        entry === 'registry.ts'
      )
        continue;
      const importSnippet = `./${entry.replace(/\.ts$/, '.js')}`;
      if (!activeLines.includes(importSnippet)) {
        failures.push(
          `Channel '${entry}' has no active (uncommented) import in src/channels/index.ts`,
        );
      }
    }
  }

  // --- Check 3: Every container/skills/*/ is mentioned in CLAUDE.md ---
  const containerSkillsDir = path.join(repoRoot, 'container', 'skills');
  if (fs.existsSync(containerSkillsDir)) {
    for (const entry of fs.readdirSync(containerSkillsDir, {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      if (!claudeMd.includes(entry.name)) {
        failures.push(
          `Container skill '${entry.name}' (container/skills/${entry.name}) not mentioned in CLAUDE.md`,
        );
      }
    }
  }

  // --- Check 4: Every v* git tag has a matching entry in CHANGELOG.md ---
  const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
  if (fs.existsSync(changelogPath)) {
    // spawnSync with array args: no shell involved, no injection surface
    const result = spawnSync('git', ['tag', '--list', 'v*'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.status === 0 && result.stdout) {
      const tags = result.stdout
        .split('\n')
        .map((t) => t.trim())
        .filter(Boolean);
      const changelog = fs.readFileSync(changelogPath, 'utf8');
      for (const tag of tags) {
        // Tags: "v1.2.36"; CHANGELOG headings: "## [1.2.36]"
        const version = tag.startsWith('v') ? tag.slice(1) : tag;
        if (!changelog.includes(`[${version}]`)) {
          failures.push(
            `Git tag '${tag}' has no matching entry in CHANGELOG.md`,
          );
        }
      }
    }
  }

  // --- Check 5: docs/superpowers/{specs,plans}/*.md YAML headers have valid cross-refs ---
  for (const subdir of ['specs', 'plans'] as const) {
    const dir = path.join(repoRoot, 'docs', 'superpowers', subdir);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.md') || file.startsWith('.')) continue;
      const content = fs.readFileSync(path.join(dir, file), 'utf8');
      const headerMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!headerMatch) continue;
      const header = headerMatch[1];
      for (const field of ['spec', 'plan'] as const) {
        const fieldMatch = header.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
        if (!fieldMatch || fieldMatch[1].trim() === 'null') continue;
        const refRelPath = fieldMatch[1].trim();
        const refAbsPath = path.join(repoRoot, refRelPath);
        if (!fs.existsSync(refAbsPath)) {
          failures.push(
            `${subdir}/${file}: '${field}' references missing file '${refRelPath}'`,
          );
        }
      }
    }
  }

  // --- Check 6: docs/superpowers/INDEX.md markdown links resolve ---
  const indexMdPath = path.join(repoRoot, 'docs', 'superpowers', 'INDEX.md');
  if (fs.existsSync(indexMdPath)) {
    const lines = fs.readFileSync(indexMdPath, 'utf8').split('\n');
    for (const line of lines) {
      const linkMatches = [...line.matchAll(/\(([^)]+\.md)\)/g)];
      for (const m of linkMatches) {
        const refPath = path.join(
          repoRoot,
          'docs',
          'superpowers',
          m[1] as string,
        );
        if (!fs.existsSync(refPath)) {
          failures.push(`INDEX.md references non-existent file: ${m[1]}`);
        }
      }
    }
  }

  return { pass: failures.length === 0, failures };
}

// Allow running directly: npx tsx scripts/docs-scan.ts
if (
  process.argv[1] &&
  new URL(import.meta.url).pathname ===
    new URL(`file://${process.argv[1]}`).pathname
) {
  const result = scanDocs(process.cwd());
  if (result.pass) {
    console.log('All doc-freshness checks passed');
  } else {
    console.error('Doc-freshness failures:');
    for (const f of result.failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}
```

- [ ] **Step 2: Run the scanner to confirm it executes without crashing**

```bash
npx tsx scripts/docs-scan.ts
```

Expected: prints results (pass or a list of failures). If it prints failures about skills not in CLAUDE.md or container skills — that is fine for now, we'll fix them in Task 10. The script must not crash or throw.

- [ ] **Step 3: Commit**

```bash
git add scripts/docs-scan.ts
git commit -m "feat(scripts): add docs-scan tree-vs-docs auditor"
```

---

## Task 6: `src/docs-freshness.test.ts` — CI freshness gate

**Files:**
- Create: `src/docs-freshness.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/docs-freshness.test.ts
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import { scanDocs } from '../scripts/docs-scan.js';

const repoRoot = path.resolve(process.cwd());
const scan = scanDocs(repoRoot);

describe('docs freshness', () => {
  it('all skills in .claude/skills/ are listed in CLAUDE.md', () => {
    const failures = scan.failures.filter((f) => f.startsWith("Skill '"));
    expect(failures, failures.join('\n')).toHaveLength(0);
  });

  it('all src/channels/*.ts have an active import in src/channels/index.ts', () => {
    const failures = scan.failures.filter((f) => f.startsWith("Channel '"));
    expect(failures, failures.join('\n')).toHaveLength(0);
  });

  it('all container/skills/* are mentioned in CLAUDE.md', () => {
    const failures = scan.failures.filter((f) =>
      f.startsWith("Container skill '"),
    );
    expect(failures, failures.join('\n')).toHaveLength(0);
  });

  it('all v* git tags have an entry in CHANGELOG.md', () => {
    const failures = scan.failures.filter((f) => f.startsWith("Git tag '"));
    expect(failures, failures.join('\n')).toHaveLength(0);
  });

  it('all spec and plan YAML headers have valid cross-reference paths', () => {
    const failures = scan.failures.filter(
      (f) => f.includes("'spec'") || f.includes("'plan'"),
    );
    expect(failures, failures.join('\n')).toHaveLength(0);
  });

  it('INDEX.md links all resolve to existing files', () => {
    const failures = scan.failures.filter((f) =>
      f.startsWith('INDEX.md references'),
    );
    expect(failures, failures.join('\n')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests — note which ones fail**

```bash
npx vitest run src/docs-freshness.test.ts
```

Some tests will fail now (skills not in CLAUDE.md, container skills). Record which fail. We will fix them in Task 10.

- [ ] **Step 3: Commit the failing tests — this is TDD: red before green**

```bash
git add src/docs-freshness.test.ts
git commit -m "test(docs-freshness): CI gate for skill table, channel barrel, container skills, tags, cross-refs, INDEX links"
```

---

## Task 7: `scripts/remote-deploy.sh` — droplet-side upgrade script

**Files:**
- Create: `scripts/remote-deploy.sh`

Runs on the droplet, invoked via SSH. Idempotent: running it twice with the same tag is safe.

- [ ] **Step 1: Create the script**

```bash
#!/usr/bin/env bash
# remote-deploy.sh — run on the NanoClaw droplet to upgrade to a version tag
# Usage: bash remote-deploy.sh <version-tag>   e.g. bash remote-deploy.sh v1.4.2
set -euo pipefail

VERSION="${1:?Usage: remote-deploy.sh <version-tag>  (e.g. v1.4.2)}"
NANOCLAW_DIR="${NANOCLAW_DIR:-/root/nanoclaw}"

echo "[remote-deploy] Upgrading to $VERSION in $NANOCLAW_DIR"
cd "$NANOCLAW_DIR"

git fetch --tags --quiet
git checkout "$VERSION" --quiet
echo "[remote-deploy] Checked out $VERSION"

npm ci --prefer-offline --silent
npm run build --silent
echo "[remote-deploy] Build complete"

# Full prune to avoid stale COPY cache (see CLAUDE.md Container Build Cache note)
docker builder prune -af --filter type=exec.cachemount 2>/dev/null || true
./container/build.sh
echo "[remote-deploy] Container image rebuilt"

if systemctl is-active --quiet nanoclaw 2>/dev/null; then
  systemctl restart nanoclaw
  echo "[remote-deploy] systemctl restart nanoclaw"
elif systemctl --user is-active --quiet nanoclaw 2>/dev/null; then
  systemctl --user restart nanoclaw
  echo "[remote-deploy] systemctl --user restart nanoclaw"
else
  echo "[remote-deploy] WARNING: nanoclaw service not running — start it manually" >&2
  exit 1
fi

echo "[remote-deploy] Deploy of $VERSION complete"
```

- [ ] **Step 2: Make executable and syntax-check**

```bash
chmod +x scripts/remote-deploy.sh
bash -n scripts/remote-deploy.sh
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/remote-deploy.sh
git commit -m "feat(scripts): add remote-deploy.sh for droplet-side upgrades"
```

---

## Task 8: `scripts/smoke-send.ts` — post-deploy health probe

**Files:**
- Create: `scripts/smoke-send.ts`

Probes the droplet over SSH. Uses `spawnSync` with array args throughout — no shell involved.

- [ ] **Step 1: Create `scripts/smoke-send.ts`**

```typescript
// scripts/smoke-send.ts
// Post-deploy health probe. Run: npx tsx scripts/smoke-send.ts [--host <ip>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

interface DeployConfig {
  dropletIp: string;
  dropletUser?: string;
  nanoclaw_dir?: string;
}

function loadDeployConfig(): DeployConfig | null {
  const cfgPath = path.join(os.homedir(), '.config', 'nanoclaw', 'deploy.json');
  if (!fs.existsSync(cfgPath)) return null;
  return JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as DeployConfig;
}

function sshRun(
  user: string,
  host: string,
  cmd: string,
): { ok: boolean; out: string } {
  const result = spawnSync(
    'ssh',
    [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=10',
      `${user}@${host}`,
      cmd,
    ],
    { encoding: 'utf8', timeout: 30_000 },
  );
  return {
    ok: result.status === 0,
    out: ((result.stdout ?? '') + (result.stderr ?? '')).trim(),
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const hostIdx = args.indexOf('--host');
  const explicitHost = hostIdx >= 0 ? args[hostIdx + 1] : undefined;

  const cfg = loadDeployConfig();
  const host = explicitHost ?? cfg?.dropletIp;
  if (!host) {
    console.error(
      '[smoke-send] No host. Pass --host <ip> or set "dropletIp" in ~/.config/nanoclaw/deploy.json',
    );
    process.exit(1);
  }

  const user = cfg?.dropletUser ?? 'root';
  const dir = cfg?.nanoclaw_dir ?? '/root/nanoclaw';
  console.log(`[smoke-send] Probing ${user}@${host}...`);

  // Probe 1: service is active
  const svc = sshRun(
    user,
    host,
    'systemctl is-active nanoclaw 2>/dev/null || systemctl --user is-active nanoclaw 2>/dev/null || echo inactive',
  );
  if (!svc.out.includes('active')) {
    console.error(
      `[smoke-send] FAIL: nanoclaw service not active (got: ${svc.out})`,
    );
    process.exit(2);
  }
  console.log('[smoke-send] Service is active');

  // Probe 2: health socket responds (optional — only if NANOCLAW_HEALTH was set)
  const hProbe = sshRun(
    user,
    host,
    `printf '' | nc -U ${dir}/data/health.sock 2>/dev/null || echo NO_SOCKET`,
  );
  if (hProbe.out.includes('NO_SOCKET') || !hProbe.out.includes('"status"')) {
    console.log(
      '[smoke-send] SKIP: health socket not responding (set NANOCLAW_HEALTH=1 on the droplet to enable)',
    );
  } else {
    try {
      const status = JSON.parse(hProbe.out.trim()) as {
        version: string;
        channelsConnected: string[];
      };
      console.log(
        `[smoke-send] Health socket OK — version: ${status.version}, channels: ${JSON.stringify(status.channelsConnected)}`,
      );
    } catch {
      console.warn('[smoke-send] Health socket returned non-JSON:', hProbe.out);
    }
  }

  // Probe 3: container runtime
  const cProbe = sshRun(
    user,
    host,
    'docker run --rm hello-world 2>&1 | head -1',
  );
  if (!cProbe.ok || !cProbe.out.toLowerCase().includes('hello')) {
    console.warn(
      '[smoke-send] WARN: docker hello-world did not respond — container runtime may be degraded',
    );
  } else {
    console.log('[smoke-send] Container runtime healthy');
  }

  // Probe 4: recent error scan
  const logProbe = sshRun(
    user,
    host,
    `tail -50 ${dir}/logs/nanoclaw.log 2>/dev/null | grep -c '"level":50' || echo 0`,
  );
  const errorCount = parseInt(logProbe.out.trim() || '0', 10);
  if (errorCount > 0) {
    console.warn(`[smoke-send] WARN: ${errorCount} ERROR-level lines in last 50 log entries`);
  } else {
    console.log('[smoke-send] No recent ERROR log entries');
  }

  console.log('[smoke-send] All critical probes passed.');
}

main();
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke-send.ts
git commit -m "feat(scripts): add smoke-send.ts post-deploy health probe"
```

---

## Task 9: `.github/workflows/lint.yml`

**Files:**
- Create: `.github/workflows/lint.yml`

- [ ] **Step 1: Verify lint script is in package.json**

```bash
node -e "const p = JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log(p.scripts.lint)"
```

Expected: prints something like `eslint src/`.

- [ ] **Step 2: Create the workflow**

```yaml
# .github/workflows/lint.yml
name: Lint

on:
  pull_request:
    branches: [main]

jobs:
  lint:
    name: ESLint + Prettier
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm

      - run: npm ci

      - name: Prettier check
        run: npm run format:check

      - name: ESLint
        run: npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/lint.yml
git commit -m "ci: add lint workflow (eslint + prettier on PRs)"
```

---

## Task 10: Anchor doc updates — turn the freshness tests green

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CONTRIBUTING.md`

This task makes the `docs-freshness.test.ts` tests pass.

- [ ] **Step 1: Run the freshness scan to see exact failures**

```bash
npx tsx scripts/docs-scan.ts
```

Note every line that starts with `Skill '` or `Container skill '`.

- [ ] **Step 2: Add missing skills to the `CLAUDE.md` skill table**

In `CLAUDE.md`, add these rows to the existing skill table after the last current row:

```markdown
| `/build-it` | Drive a change end-to-end: intake → brainstorm → plan → implement → test → review → PR → release → deploy → verify |
| `/catch-up` | Cold-start helper: given a Linear ID or slug, reconstruct current phase, last artifact, and next action |
| `nanoclaw-docs-sync` | Audit CLAUDE.md/README/CONTRIBUTING against the tree; write ADR; update INDEX.md; commit doc fixes |
| `nanoclaw-release` | Bump semver, append CHANGELOG entry, tag, push — phase [8] of `/build-it` |
| `nanoclaw-deploy-droplet` | SSH-deploy a version tag to the DO droplet, rebuild container, restart, probe health |
| `nanoclaw-postdeploy-verify` | Run smoke-send.ts probes after deploy; auto-rollback on failure |
| `nanoclaw-channel-smoke-matrix` | Run channel unit tests and optional container smoke for each impacted channel |
```

- [ ] **Step 3: Add the mission-log pointer and health.ts to `CLAUDE.md`**

After the "Quick Context" paragraph and before "## Key Files", add:

```markdown
**Mission log:** See [`docs/superpowers/INDEX.md`](docs/superpowers/INDEX.md) for the append-only record of all `/build-it` missions.
```

Add `src/health.ts` to the Key Files table:

```markdown
| `src/health.ts` | Optional Unix domain socket health endpoint (opt-in via `HEALTH_SOCKET_PATH` or `NANOCLAW_HEALTH=1`) |
```

- [ ] **Step 4: Add the `/build-it` section to `CONTRIBUTING.md`**

Add at the end of `CONTRIBUTING.md`:

```markdown
## How Changes Flow Through `/build-it`

The NanoClaw agentic SDLC is invoked with `/build-it "<intent>"` or `/build-it <linear-url>`. Claude Code drives all phases:

1. **Intake** — classify change type, ingest or create Linear ticket
2. **Brainstorm** — `superpowers:brainstorming` → spec in `docs/superpowers/specs/`
3. **Plan** — `superpowers:writing-plans` → plan in `docs/superpowers/plans/`
4. **Worktree** — `superpowers:using-git-worktrees` with `ALM-<id>-<slug>` branch naming
5. **Implement** — `superpowers:subagent-driven-development` + `superpowers:test-driven-development`
6. **Self-verify** — `superpowers:verification-before-completion` + channel smoke matrix
7. **Review** — `superpowers:requesting-code-review` → `code-reviewer` agent
8. **Finish branch** — `superpowers:finishing-a-development-branch` → PR
9. **Docs sync** — `nanoclaw-docs-sync` updates anchor docs, writes ADR, appends INDEX.md
10. **Release** — `nanoclaw-release` bumps version, tags
11. **Deploy** — `nanoclaw-deploy-droplet` SSHes to DO droplet
12. **Post-deploy verify** — `nanoclaw-postdeploy-verify` runs health probes

**CI gate:** `src/docs-freshness.test.ts` asserts that the skill table in CLAUDE.md, channel barrel imports, container skill references, and git tags stay in sync with the tree. A PR with doc drift fails CI.

Full design: [`docs/superpowers/plans/2026-04-21-build-it-sdlc-infrastructure.md`](docs/superpowers/plans/2026-04-21-build-it-sdlc-infrastructure.md)
```

- [ ] **Step 5: Run the freshness tests — expect ALL green**

```bash
npx vitest run src/docs-freshness.test.ts
```

Expected: 6 tests pass. If any still fail, read the failure message and fix the missing reference in the anchor doc.

- [ ] **Step 6: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md CONTRIBUTING.md
git commit -m "docs: update CLAUDE.md and CONTRIBUTING.md for /build-it SDLC"
```

---

## Task 11: Final verification pass

- [ ] **Step 1: Full quality check**

```bash
npm run format:check && npm run typecheck && npm run lint && npm test
```

Expected: all four exit 0.

- [ ] **Step 2: Docs scanner clean**

```bash
npx tsx scripts/docs-scan.ts
```

Expected: "All doc-freshness checks passed".

- [ ] **Step 3: Health server manual smoke (dev mode)**

```bash
NANOCLAW_HEALTH=1 npm run dev &
DEV_PID=$!
sleep 4
printf '' | nc -U data/health.sock
kill $DEV_PID 2>/dev/null; wait $DEV_PID 2>/dev/null; true
```

Expected: JSON response like `{"status":"ok","version":"...","uptimeMs":...}`.

- [ ] **Step 4: Verify remote-deploy.sh**

```bash
bash -n scripts/remote-deploy.sh
```

Expected: exits 0 (syntax-clean).

---

## Self-Review

**Spec coverage:**
- ✅ Health socket endpoint — Tasks 2-4
- ✅ `scripts/docs-scan.ts` — Task 5
- ✅ `src/docs-freshness.test.ts` CI gate — Task 6
- ✅ `scripts/remote-deploy.sh` — Task 7
- ✅ `scripts/smoke-send.ts` — Task 8
- ✅ CI lint workflow — Task 9
- ✅ Doc scaffold (`decisions/`, `reviews/`, `INDEX.md`, `DEPLOY-LOG.md`) — Task 1
- ✅ Anchor doc updates (`CLAUDE.md`, `CONTRIBUTING.md`) — Task 10
- ✅ `.gitignore` `.worktrees/` — already present; no change needed

**Not in this plan (Plan B — SDLC Skills):**
All `.claude/skills/build-it/`, `catch-up/`, `nanoclaw-*` SKILL.md files are instruction-only and will be created using `superpowers:writing-skills` in Plan B.

**Type consistency:**
- `startHealthServer(socketPath, getStatus)` — consistent in Tasks 3 and 4
- `HealthServer.stop(): Promise<void>` — consistent in Tasks 3 and 4
- `ScanResult { pass: boolean, failures: string[] }` — consistent in Tasks 5 and 6
- `DeployConfig { dropletIp, dropletUser?, nanoclaw_dir? }` — used only in Task 8
