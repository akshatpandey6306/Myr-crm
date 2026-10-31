import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { scryptSync, randomBytes } from 'node:crypto';
import { AuthController } from '../src/auth/auth.controller.js';

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
      const prisma = {
        user: { findUnique: async () => user },
        session: { create: async () => { sessionCreated = true; return {}; } },
      };
      const controller = new AuthController(prisma as never);
      const httpResponse = { setHeader: () => {} };
      const result = await controller.login({ email: account.email, password: account.password }, httpResponse as never);
      assert.equal(result.user.email, account.email);
      assert.equal(typeof result.token, 'string');
      assert.ok(sessionCreated);
    });
  }

  it('rejects invalid credentials', async () => {
    const user = makeUser('maya@studionorth.co', 'password123');
    const prisma = { user: { findUnique: async () => user }, session: { create: async () => ({}) } };
    const controller = new AuthController(prisma as never);
    const httpResponse = { setHeader: () => {} };
    await assert.rejects(
      () => controller.login({ email: 'maya@studionorth.co', password: 'wrong' }, httpResponse as never),
      UnauthorizedException,
    );
  });
});
