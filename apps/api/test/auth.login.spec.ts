import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { scryptSync, randomBytes } from 'node:crypto';
import { AuthController } from '../src/auth/auth.controller.js';
import { AuthRateLimitService } from '../src/auth/auth-rate-limit.service.js';

const authRateLimits = { assertAllowed: async () => undefined };
const emailService = {
  isConfigured: () => false,
  sendVerification: async () => undefined,
  sendPasswordReset: async () => undefined,
};

const securitySettings = {
  failedLoginLockoutEnabled: false,
  deviceRestrictionsEnabled: false,
  maxFailedLoginAttempts: 5,
  lockoutDurationMinutes: 15,
  sessionLifetimeMinutes: 60,
};

function loginPrisma(user: ReturnType<typeof makeUser>, onSessionCreate: () => void = () => {}) {
  return {
    user: { findUnique: async () => user },
    globalSecuritySettings: {
      upsert: async () => securitySettings,
      findUnique: async () => securitySettings,
    },
    subscriptionPlan: { findUnique: async () => null },
    $transaction: async (operation: (transaction: unknown) => Promise<unknown>) => operation({
      $queryRaw: async () => [],
      session: { count: async () => 0, create: async () => { onSessionCreate(); } },
    }),
  };
}

function makeHash(password: string) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function makeUser(email: string, password: string, orgId = 'org-active') {
  return {
    id: `user-${email}`,
    email,
    name: email.split('@')[0],
    status: 'ACTIVE',
    emailVerifiedAt: new Date(),
    passwordHash: makeHash(password),
    memberships: [{ organization: { id: orgId, name: 'Demo Workspace' }, role: 'OWNER', status: 'ACTIVE', createdAt: new Date() }],
  };
}

const accounts = [
  { email: 'maya@studionorth.co', password: 'password123' },
  { email: 'admin@myrcrm.local', password: 'MyrAdmin123!' },
  { email: 'pending@myrcrm.local', password: 'PendingDemo123!' },
  { email: 'expired@myrcrm.local', password: 'ExpiredDemo123!' },
];

describe('AuthController login', () => {
  for (const account of accounts) {
    it(`logs in ${account.email}`, async () => {
      const user = makeUser(account.email, account.password);
      let sessionCreated = false;
      const prisma = loginPrisma(user, () => { sessionCreated = true; });
      const controller = new AuthController(prisma as never, emailService as never);
      let cookieOptions: { httpOnly: boolean } | undefined;
      const httpResponse = { cookie: (_name: string, _value: string, options: { httpOnly: boolean }) => { cookieOptions = options; } };
      const result = await controller.login({ email: account.email, password: account.password }, { headers: {} } as never, httpResponse as never);
      assert.equal(result.user.email, account.email);
      assert.equal(typeof result.expiresAt, 'string');
      assert.equal(cookieOptions?.httpOnly, true);
      assert.ok(sessionCreated);
    });
  }

  it('rejects invalid credentials', async () => {
    const user = makeUser('maya@studionorth.co', 'password123');
    const prisma = loginPrisma(user);
    const controller = new AuthController(prisma as never, emailService as never);
    const httpResponse = { cookie: () => {} };
    await assert.rejects(
      () => controller.login({ email: 'maya@studionorth.co', password: 'wrong' }, { headers: {} } as never, httpResponse as never),
      UnauthorizedException,
    );
  });
});
