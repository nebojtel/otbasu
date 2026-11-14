import assert from 'node:assert/strict';
import test from 'node:test';

import { validateTurnstileToken } from '../api/admin/login.js';

test('Turnstile validation rejects missing tokens before calling Cloudflare', async () => {
  let called = false;
  const result = await validateTurnstileToken({
    token: '',
    secret: 'secret',
    fetchImpl: async () => {
      called = true;
      throw new Error('must not be called');
    }
  });

  assert.equal(result.success, false);
  assert.equal(called, false);
});

test('Turnstile validation accepts the production hostname and login action', async () => {
  const result = await validateTurnstileToken({
    token: 'valid-token',
    secret: 'secret',
    remoteIp: '203.0.113.10',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.remoteip, '203.0.113.10');
      assert.equal(body.response, 'valid-token');

      return {
        ok: true,
        async json() {
          return {
            success: true,
            hostname: 'otbasu.vercel.app',
            action: 'admin_login'
          };
        }
      };
    }
  });

  assert.equal(result.success, true);
});

test('Turnstile validation rejects tokens issued for another hostname or action', async () => {
  const result = await validateTurnstileToken({
    token: 'wrong-context-token',
    secret: 'secret',
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          success: true,
          hostname: 'example.com',
          action: 'contact_form'
        };
      }
    })
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, 'siteverify-rejected');
});
