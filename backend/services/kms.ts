/**
 * Key Management Service abstraction.
 *
 * In production (KMS_PROVIDER=aws) secrets are fetched from AWS Secrets Manager
 * using the KMS CMK for envelope encryption.  In all other environments the
 * values fall back to environment variables so local development and CI require
 * no AWS credentials.
 *
 * Rules enforced here:
 *  - Secret values are NEVER included in thrown errors or log output.
 *  - Errors expose only the secret *name*, not its value.
 *  - A module-level cache avoids redundant API calls within a single process.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SecretName =
  | 'STELLAR_ADMIN_SECRET'
  | 'JWT_SECRET'
  | 'ENCRYPTION_KEY'
  | 'STRIPE_SECRET_KEY'
  | 'STRIPE_WEBHOOK_SECRET'
  | 'NEXTAUTH_SECRET'
  | 'WEBHOOK_SECRET';

export interface KmsProvider {
  getSecret(name: SecretName): Promise<string>;
}

// ---------------------------------------------------------------------------
// AWS Secrets Manager provider
// ---------------------------------------------------------------------------

/**
 * Lazily-imported AWS SDK so the module can be loaded in environments where
 * the SDK is not installed (the import only runs when KMS_PROVIDER=aws).
 */
async function awsGetSecret(name: SecretName): Promise<string> {
  // Dynamic import keeps the AWS SDK out of the bundle for non-AWS deployments.
  const { SecretsManagerClient, GetSecretValueCommand } = await import(
    '@aws-sdk/client-secrets-manager'
  );

  const prefix = process.env.KMS_SECRET_PREFIX ?? 'stellar/prod';
  const secretId = `${prefix}/${name}`;
  const region = process.env.AWS_REGION ?? 'us-east-1';

  const client = new SecretsManagerClient({ region });

  let response;
  try {
    response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  } catch (err) {
    // Surface the secret *name* and AWS error code only — never the value.
    const code = (err as { name?: string }).name ?? 'UnknownError';
    throw new Error(`KMS: failed to retrieve secret "${name}" (AWS error: ${code})`);
  }

  const value = response.SecretString;
  if (!value) {
    throw new Error(`KMS: secret "${name}" exists but has no string value`);
  }

  return value;
}

// ---------------------------------------------------------------------------
// Environment-variable fallback provider (local / CI)
// ---------------------------------------------------------------------------

function envGetSecret(name: SecretName): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`KMS: secret "${name}" is not set in environment variables`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// In-process cache
// ---------------------------------------------------------------------------

const cache = new Map<SecretName, string>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieve a managed secret by name.
 *
 * Uses AWS Secrets Manager when `KMS_PROVIDER=aws`, otherwise reads from
 * environment variables.  Results are cached for the lifetime of the process.
 */
export async function getSecret(name: SecretName): Promise<string> {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  const provider = process.env.KMS_PROVIDER ?? 'env';
  const value = provider === 'aws' ? await awsGetSecret(name) : envGetSecret(name);

  cache.set(name, value);
  return value;
}

/**
 * Rotate a secret: clear the cache entry so the next call fetches a fresh
 * value.  Call this after triggering a rotation in Secrets Manager.
 */
export function invalidateSecret(name: SecretName): void {
  cache.delete(name);
}

/**
 * Validate that all required secrets are resolvable at startup.
 * Throws an aggregated error listing *names* of missing secrets only.
 */
export async function validateSecrets(required: SecretName[]): Promise<void> {
  const missing: string[] = [];

  await Promise.all(
    required.map(async (name) => {
      try {
        await getSecret(name);
      } catch {
        missing.push(name);
      }
    }),
  );

  if (missing.length > 0) {
    throw new Error(`KMS: the following required secrets could not be resolved: ${missing.join(', ')}`);
  }
}
