import { describe, it, expect } from 'vitest';

describe('server-only protection', () => {
  it('should throw error when importing server-only module', async () => {
    // Attempting to dynamically import a module that uses 'server-only'
    // In a real client environment (browser), this should throw.
    // In Vitest (Node environment), this might not throw unless
    // specifically configured to mock the environment as 'client'.
    await expect(import('../lib/db/server')).rejects.toThrow();
  });
});
