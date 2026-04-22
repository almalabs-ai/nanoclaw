import path from 'path';

import { describe, expect, it } from 'vitest';

import {
  isValidGroupFolder,
  resolveGroupFolderPath,
  resolveGroupIpcPath,
  slugifyGroupSubject,
} from './group-folder.js';

describe('group folder validation', () => {
  it('accepts normal group folder names', () => {
    expect(isValidGroupFolder('main')).toBe(true);
    expect(isValidGroupFolder('family-chat')).toBe(true);
    expect(isValidGroupFolder('Team_42')).toBe(true);
  });

  it('rejects traversal and reserved names', () => {
    expect(isValidGroupFolder('../../etc')).toBe(false);
    expect(isValidGroupFolder('/tmp')).toBe(false);
    expect(isValidGroupFolder('global')).toBe(false);
    expect(isValidGroupFolder('')).toBe(false);
  });

  it('resolves safe paths under groups directory', () => {
    const resolved = resolveGroupFolderPath('family-chat');
    expect(resolved.endsWith(`${path.sep}groups${path.sep}family-chat`)).toBe(
      true,
    );
  });

  it('resolves safe paths under data ipc directory', () => {
    const resolved = resolveGroupIpcPath('family-chat');
    expect(
      resolved.endsWith(`${path.sep}data${path.sep}ipc${path.sep}family-chat`),
    ).toBe(true);
  });

  it('throws for unsafe folder names', () => {
    expect(() => resolveGroupFolderPath('../../etc')).toThrow();
    expect(() => resolveGroupIpcPath('/tmp')).toThrow();
  });
});

describe('slugifyGroupSubject', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugifyGroupSubject('Team Building')).toBe('team-building');
  });

  it('strips special characters', () => {
    expect(slugifyGroupSubject('Hello! World #1')).toBe('hello-world-1');
  });

  it('collapses consecutive hyphens', () => {
    expect(slugifyGroupSubject('A  B   C')).toBe('a-b-c');
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugifyGroupSubject('--project--')).toBe('project');
  });

  it('truncates to 40 characters', () => {
    const long = 'a'.repeat(60);
    expect(slugifyGroupSubject(long).length).toBeLessThanOrEqual(40);
  });

  it('produces a valid group folder name', () => {
    const result = slugifyGroupSubject('My Cool Group 🎉');
    expect(isValidGroupFolder(result)).toBe(true);
  });

  it('falls back to wa-group for all-special-char input', () => {
    expect(slugifyGroupSubject('!!! 🎉 ???')).toBe('wa-group');
  });

  it('deduplicates when existing folders provided', () => {
    const existing = new Set(['team-building']);
    expect(slugifyGroupSubject('Team Building', existing)).toBe(
      'team-building-2',
    );
  });

  it('increments suffix until unique', () => {
    const existing = new Set(['team-building', 'team-building-2']);
    expect(slugifyGroupSubject('Team Building', existing)).toBe(
      'team-building-3',
    );
  });

  it('handles empty subject with fallback', () => {
    expect(slugifyGroupSubject('')).toBe('wa-group');
  });
});
