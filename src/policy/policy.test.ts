import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkCapability, loadPolicyConfig, PolicyConfig } from './policy.js';

let tmpDir: string;

function cfgPath(name = 'policy.json'): string {
  return path.join(tmpDir, name);
}

function writeConfig(config: unknown, name?: string): string {
  const p = cfgPath(name);
  fs.writeFileSync(p, JSON.stringify(config));
  return p;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadPolicyConfig', () => {
  it('returns default when file is missing', () => {
    const cfg = loadPolicyConfig(cfgPath());
    expect(cfg.capabilities).toEqual({});
    expect(cfg.unknown_sender.roles).toEqual(['member']);
  });

  it('parses valid JSON correctly', () => {
    const p = writeConfig({
      capabilities: {
        'scheduler.crossGroup': ['admin'],
        register_group: ['admin'],
        'rag.ask': '*',
      },
      unknown_sender: { roles: ['member'] },
    });
    const cfg = loadPolicyConfig(p);
    expect(cfg.capabilities['scheduler.crossGroup']).toEqual(['admin']);
    expect(cfg.capabilities['register_group']).toEqual(['admin']);
    expect(cfg.capabilities['rag.ask']).toBe('*');
    expect(cfg.unknown_sender.roles).toEqual(['member']);
  });

  it('returns default on invalid JSON (no throw)', () => {
    const p = cfgPath();
    fs.writeFileSync(p, '{ not valid json }}}');
    const cfg = loadPolicyConfig(p);
    expect(cfg.capabilities).toEqual({});
    expect(cfg.unknown_sender.roles).toEqual(['member']);
  });
});

describe('checkCapability', () => {
  const adminOnlyCfg: PolicyConfig = {
    capabilities: {
      'scheduler.crossGroup': ['admin'],
    },
    unknown_sender: { roles: ['member'] },
  };

  const publicCfg: PolicyConfig = {
    capabilities: {
      'rag.ask': '*',
    },
    unknown_sender: { roles: ['member'] },
  };

  it('admin is allowed for scheduler.crossGroup', () => {
    const result = checkCapability(
      'admin@example.com',
      'scheduler.crossGroup',
      ['admin'],
      adminOnlyCfg,
    );
    expect(result).toBe(true);
  });

  it('member is denied for scheduler.crossGroup', () => {
    const result = checkCapability(
      'user@example.com',
      'scheduler.crossGroup',
      ['member'],
      adminOnlyCfg,
    );
    expect(result).toBe(false);
  });

  it('unknown capability returns deny (deny-by-default)', () => {
    const result = checkCapability(
      'user@example.com',
      'nonexistent.cap',
      ['admin'],
      adminOnlyCfg,
    );
    expect(result).toBe(false);
  });

  it("'*' capability allows any role", () => {
    const result = checkCapability(
      'user@example.com',
      'rag.ask',
      ['member'],
      publicCfg,
    );
    expect(result).toBe(true);
  });

  it("'*' capability allows even with empty roles list (public capability)", () => {
    const result = checkCapability(undefined, 'rag.ask', [], publicCfg);
    expect(result).toBe(true);
  });

  it('multi-role user is allowed if any role matches', () => {
    const result = checkCapability(
      'user@example.com',
      'scheduler.crossGroup',
      ['member', 'admin'],
      adminOnlyCfg,
    );
    expect(result).toBe(true);
  });

  it('empty roles list is denied for restricted capability', () => {
    const result = checkCapability(
      undefined,
      'scheduler.crossGroup',
      [],
      adminOnlyCfg,
    );
    expect(result).toBe(false);
  });

  it('undefined canonical_id is treated as unknown sender (uses provided roles)', () => {
    const result = checkCapability(
      undefined,
      'scheduler.crossGroup',
      ['member'],
      adminOnlyCfg,
    );
    expect(result).toBe(false);
  });
});
