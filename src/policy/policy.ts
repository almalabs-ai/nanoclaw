import fs from 'fs';
import os from 'os';
import path from 'path';

import type Database from 'better-sqlite3';

import { logger } from '../logger.js';

export interface RoleDefinition {
  description: string;
}

export interface PolicyConfig {
  capabilities: Record<string, string[] | '*'>; // capability → allowed roles (or '*' = all)
  unknown_sender: { roles: string[] };
}

export interface RolesConfig {
  roles: Record<string, RoleDefinition>;
}

export const POLICY_CONFIG_PATH = path.join(
  os.homedir(),
  '.config',
  'nanoclaw',
  'policy.json',
);

export const ROLES_CONFIG_PATH = path.join(
  os.homedir(),
  '.config',
  'nanoclaw',
  'roles.json',
);

const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  capabilities: {},
  unknown_sender: { roles: ['member'] },
};

const DEFAULT_ROLES_CONFIG: RolesConfig = {
  roles: {},
};

export function loadPolicyConfig(pathOverride?: string): PolicyConfig {
  const filePath = pathOverride ?? POLICY_CONFIG_PATH;

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      return DEFAULT_POLICY_CONFIG;
    logger.warn({ err, path: filePath }, 'policy: cannot read policy config');
    return DEFAULT_POLICY_CONFIG;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn({ path: filePath }, 'policy: invalid JSON in policy config');
    return DEFAULT_POLICY_CONFIG;
  }

  const obj = parsed as Record<string, unknown>;

  const capabilities: Record<string, string[] | '*'> = {};
  if (
    obj.capabilities &&
    typeof obj.capabilities === 'object' &&
    !Array.isArray(obj.capabilities)
  ) {
    for (const [key, value] of Object.entries(
      obj.capabilities as Record<string, unknown>,
    )) {
      if (value === '*') {
        capabilities[key] = '*';
      } else if (
        Array.isArray(value) &&
        value.every((r) => typeof r === 'string')
      ) {
        capabilities[key] = value as string[];
      } else {
        logger.warn(
          { key, value, path: filePath },
          'policy: skipping invalid capability entry',
        );
      }
    }
  }

  const unknownSenderRoles: string[] = ['member'];
  if (
    obj.unknown_sender &&
    typeof obj.unknown_sender === 'object' &&
    !Array.isArray(obj.unknown_sender)
  ) {
    const us = obj.unknown_sender as Record<string, unknown>;
    if (
      Array.isArray(us.roles) &&
      us.roles.every((r) => typeof r === 'string')
    ) {
      unknownSenderRoles.splice(0, unknownSenderRoles.length, ...us.roles);
    }
  }

  return { capabilities, unknown_sender: { roles: unknownSenderRoles } };
}

export function loadRolesConfig(pathOverride?: string): RolesConfig {
  const filePath = pathOverride ?? ROLES_CONFIG_PATH;

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      return DEFAULT_ROLES_CONFIG;
    logger.warn({ err, path: filePath }, 'policy: cannot read roles config');
    return DEFAULT_ROLES_CONFIG;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn({ path: filePath }, 'policy: invalid JSON in roles config');
    return DEFAULT_ROLES_CONFIG;
  }

  const obj = parsed as Record<string, unknown>;

  const roles: Record<string, RoleDefinition> = {};
  if (obj.roles && typeof obj.roles === 'object' && !Array.isArray(obj.roles)) {
    for (const [key, value] of Object.entries(
      obj.roles as Record<string, unknown>,
    )) {
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof (value as Record<string, unknown>).description === 'string'
      ) {
        roles[key] = {
          description: (value as Record<string, unknown>).description as string,
        };
      } else {
        logger.warn(
          { key, value, path: filePath },
          'policy: skipping invalid role entry',
        );
      }
    }
  }

  return { roles };
}

export function checkCapability(
  canonicalId: string | undefined,
  capability: string,
  roles: string[],
  cfg: PolicyConfig,
): boolean {
  const allowed = cfg.capabilities[capability];

  let decision: boolean;

  if (allowed === undefined) {
    // deny-by-default: capability not found in policy
    decision = false;
  } else if (allowed === '*') {
    // public capability — all roles allowed
    decision = true;
  } else {
    // array of allowed roles
    decision = roles.some((r) => (allowed as string[]).includes(r));
  }

  logger.debug(
    { canonical_id: canonicalId, capability, roles, decision },
    'policy: capability check',
  );

  return decision;
}

export function auditDecision(
  db: Database.Database,
  canonical_id: string | undefined,
  capability: string,
  decision: 'allow' | 'deny',
  context?: string,
): void {
  db.prepare(
    `INSERT INTO audit_log (ts, canonical_id, capability, decision, context)
     VALUES (datetime('now'), ?, ?, ?, ?)`,
  ).run(canonical_id ?? null, capability, decision, context ?? null);
}
