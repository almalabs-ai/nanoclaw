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
