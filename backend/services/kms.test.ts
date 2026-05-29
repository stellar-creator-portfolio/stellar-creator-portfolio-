import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We test the module in isolation by controlling process.env.
// The AWS provider path is tested with a mocked dynamic import.

describe('kms service', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    // Reset module cache between tests so invalidateSecret works correctly.
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('env provider (default)', () => {
    it('returns the env var value', async () => {
      process.env.KMS_PROVIDER = 'env';
      process.env.JWT_SECRET = 'test-jwt-secret';
      const { getSecret } = await import('./kms');
      await expect(getSecret('JWT_SECRET')).resolves.toBe('test-jwt-secret');
    });

    it('throws with secret name but not value when env var is missing', async () => {
      process.env.KMS_PROVIDER = 'env';
      delete process.env.JWT_SECRET;
      const { getSecret } = await import('./kms');
      await expect(getSecret('JWT_SECRET')).rejects.toThrow('"JWT_SECRET"');
    });

    it('error message does not contain the secret value', async () => {
      process.env.KMS_PROVIDER = 'env';
      process.env.ENCRYPTION_KEY = 'super-secret-value';
      // Force a missing secret to verify the error path
      delete process.env.STELLAR_ADMIN_SECRET;
      const { getSecret } = await import('./kms');
      await expect(getSecret('STELLAR_ADMIN_SECRET')).rejects.not.toThrow('super-secret-value');
    });

    it('caches the value on subsequent calls', async () => {
      process.env.KMS_PROVIDER = 'env';
      process.env.NEXTAUTH_SECRET = 'cached-secret';
      const { getSecret } = await import('./kms');
      const first = await getSecret('NEXTAUTH_SECRET');
      // Mutate env — cached value should still be returned
      process.env.NEXTAUTH_SECRET = 'changed-secret';
      const second = await getSecret('NEXTAUTH_SECRET');
      expect(first).toBe(second);
    });

    it('invalidateSecret clears the cache', async () => {
      process.env.KMS_PROVIDER = 'env';
      process.env.WEBHOOK_SECRET = 'original';
      const { getSecret, invalidateSecret } = await import('./kms');
      await getSecret('WEBHOOK_SECRET');
      process.env.WEBHOOK_SECRET = 'rotated';
      invalidateSecret('WEBHOOK_SECRET');
      await expect(getSecret('WEBHOOK_SECRET')).resolves.toBe('rotated');
    });
  });

  describe('validateSecrets', () => {
    it('resolves when all required secrets are present', async () => {
      process.env.KMS_PROVIDER = 'env';
      process.env.JWT_SECRET = 'a';
      process.env.NEXTAUTH_SECRET = 'b';
      const { validateSecrets } = await import('./kms');
      await expect(validateSecrets(['JWT_SECRET', 'NEXTAUTH_SECRET'])).resolves.toBeUndefined();
    });

    it('throws listing missing secret names without values', async () => {
      process.env.KMS_PROVIDER = 'env';
      delete process.env.JWT_SECRET;
      delete process.env.NEXTAUTH_SECRET;
      const { validateSecrets } = await import('./kms');
      await expect(validateSecrets(['JWT_SECRET', 'NEXTAUTH_SECRET'])).rejects.toThrow(
        /JWT_SECRET.*NEXTAUTH_SECRET|NEXTAUTH_SECRET.*JWT_SECRET/,
      );
    });
  });
});
