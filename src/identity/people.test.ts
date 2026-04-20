import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getDefaultIdentity,
  loadPeopleConfig,
  PeopleConfig,
  resolvePerson,
} from './people.js';

let tmpDir: string;

function cfgPath(name = 'people.json'): string {
  return path.join(tmpDir, name);
}

function writeConfig(config: unknown, name?: string): string {
  const p = cfgPath(name);
  fs.writeFileSync(p, JSON.stringify(config));
  return p;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'people-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadPeopleConfig', () => {
  it('returns default when file is missing', () => {
    const cfg = loadPeopleConfig(cfgPath());
    expect(cfg.default_role).toBe('member');
    expect(cfg.people).toEqual([]);
  });

  it('parses valid JSON correctly', () => {
    const p = writeConfig({
      default_role: 'member',
      people: [
        {
          canonical_id: 'alice@example.com',
          display_name: 'Alice',
          roles: ['admin'],
          channels: { slack: 'UALICE123', tg: '11111' },
        },
      ],
    });
    const cfg = loadPeopleConfig(p);
    expect(cfg.default_role).toBe('member');
    expect(cfg.people).toHaveLength(1);
    expect(cfg.people[0].canonical_id).toBe('alice@example.com');
    expect(cfg.people[0].display_name).toBe('Alice');
    expect(cfg.people[0].roles).toEqual(['admin']);
    expect(cfg.people[0].channels.slack).toBe('UALICE123');
  });

  it('returns default on invalid JSON (no throw)', () => {
    const p = cfgPath();
    fs.writeFileSync(p, '{ not valid json }}}');
    const cfg = loadPeopleConfig(p);
    expect(cfg.default_role).toBe('member');
    expect(cfg.people).toEqual([]);
  });
});

describe('resolvePerson', () => {
  const cfg: PeopleConfig = {
    default_role: 'member',
    people: [
      {
        canonical_id: 'andrey.o@almalabs.ai',
        display_name: 'Andrey Oleynik',
        roles: ['admin'],
        channels: { slack: 'U0AQGRFJGTZ', tg: '74835626' },
      },
    ],
  };

  it('finds person by slack ID', () => {
    const result = resolvePerson('slack', 'U0AQGRFJGTZ', cfg);
    expect(result).not.toBeNull();
    expect(result!.canonical_id).toBe('andrey.o@almalabs.ai');
    expect(result!.display_name).toBe('Andrey Oleynik');
    expect(result!.roles).toEqual(['admin']);
  });

  it('finds person by tg ID', () => {
    const result = resolvePerson('tg', '74835626', cfg);
    expect(result).not.toBeNull();
    expect(result!.canonical_id).toBe('andrey.o@almalabs.ai');
  });

  it('returns null for unknown rawId', () => {
    const result = resolvePerson('slack', 'UNKNOWN_ID', cfg);
    expect(result).toBeNull();
  });
});

describe('getDefaultIdentity', () => {
  it('returns correct default role from config', () => {
    const cfg: PeopleConfig = { default_role: 'guest', people: [] };
    const identity = getDefaultIdentity(cfg);
    expect(identity.canonical_id).toBe('unknown');
    expect(identity.display_name).toBe('Unknown');
    expect(identity.roles).toEqual(['guest']);
  });
});
