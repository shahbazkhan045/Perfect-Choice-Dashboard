import { cookies } from 'next/headers';
import { timingSafeEqual } from 'node:crypto';
import type { Role } from './types';

export const TOKEN_COOKIE = 'pcd_access';

/** Role -> the env var holding that role's secret link token. */
const TOKEN_ENV: Record<Role, string> = {
  JUSTLIFE_ADMIN: 'TOKEN_JUSTLIFE_ADMIN',
  PC_ADMIN: 'TOKEN_PC_ADMIN',
  VIEWER: 'TOKEN_VIEWER',
};

const ROLE_ORDER: Role[] = ['JUSTLIFE_ADMIN', 'PC_ADMIN', 'VIEWER'];

/**
 * Compares without leaking length or content through response timing.
 * A short-circuit `===` on a secret is a real (if slow) oracle.
 */
function safeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Maps a raw token to a role, or null if it matches nothing. */
export function roleForToken(token: string | undefined | null): Role | null {
  if (!token) return null;
  for (const role of ROLE_ORDER) {
    const expected = process.env[TOKEN_ENV[role]];
    // An unset token env var must never match, including against "".
    if (!expected) continue;
    if (safeEquals(token, expected)) return role;
  }
  return null;
}

export function tokenForRole(role: Role): string {
  return process.env[TOKEN_ENV[role]] || '';
}

/** Resolves the current viewer's role from the httpOnly cookie. */
export async function currentRole(): Promise<Role | null> {
  const jar = await cookies();
  return roleForToken(jar.get(TOKEN_COOKIE)?.value);
}

export function canEdit(role: Role | null): boolean {
  return role === 'JUSTLIFE_ADMIN' || role === 'PC_ADMIN';
}

export function canRemind(role: Role | null): boolean {
  return role === 'JUSTLIFE_ADMIN';
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

/** Guard for API routes. Throws AuthError, which the routes turn into JSON. */
export async function requireRole(options: { edit?: boolean; remind?: boolean } = {}): Promise<Role> {
  const role = await currentRole();
  if (!role) {
    throw new AuthError('Your access link is not valid or has expired. Please request a new one.', 401);
  }
  if (options.edit && !canEdit(role)) {
    throw new AuthError('Your link is view-only, so changes cannot be saved.', 403);
  }
  if (options.remind && !canRemind(role)) {
    throw new AuthError('Only the Justlife admin link can send reminders.', 403);
  }
  return role;
}

/**
 * Builds the "Updated By" string. Nobody logs in — the partner team reaches the
 * dashboard through a secret link — so we take the name they typed once and
 * stamp it with the role their link grants, which cannot be forged client-side.
 */
export function describeActor(role: Role, name: unknown): string {
  const typed = String(name ?? '')
    .replace(/[\r\n\t]/g, ' ')
    .trim()
    .slice(0, 60);

  if (role === 'PC_ADMIN') return typed ? `${typed} (Perfect Choice)` : 'Perfect Choice team';
  if (role === 'JUSTLIFE_ADMIN') return typed ? `${typed} (Justlife)` : 'Justlife admin';
  return typed || 'Unknown';
}

/** True when every role has a configured token — surfaced in setup diagnostics. */
export function tokensConfigured(): boolean {
  return ROLE_ORDER.every((r) => Boolean(process.env[TOKEN_ENV[r]]));
}
