import { z } from 'zod'
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface S3UploadResult {
  key: string
  bucket: string
  region: string
  url: string
}

export interface S3ListResult {
  key: string
  size: number
  lastModified: Date | undefined
  signedUrl: string
}

export interface S3DownloadUrlResult {
  url: string
  expiresAt: Date
}

export interface HealthCheckResult {
  ok: boolean
  bucket: string
  region: string
}

// ── Errors ─────────────────────────────────────────────────────────────────────

export class S3ConnectionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'S3ConnectionError'
  }
}

export class S3UploadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'S3UploadError'
  }
}

export class S3NotFoundError extends Error {
  constructor(key: string) {
    super(`Object not found: ${key}`)
    this.name = 'S3NotFoundError'
  }
}

// ── Env validation ─────────────────────────────────────────────────────────────

const envSchema = z.object({
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_REGION: z.string().min(1).default('us-east-1'),
})

let _env: z.infer<typeof envSchema> | null = null

function getEnv() {
  if (!_env) {
    _env = envSchema.parse(process.env)
  }
  return _env
}

// ── MIME map ───────────────────────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.webm': 'video/webm',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.md': 'text/markdown',
}

function detectMimeType(key: string): string {
  const ext = key.slice(key.lastIndexOf('.')).toLowerCase()
  return MIME_MAP[ext] ?? 'application/octet-stream'
}

// ── Lazy S3 client singleton ───────────────────────────────────────────────────

let _client: S3Client | null = null

function getClient(): S3Client {
  if (_client) return _client

  try {
    const env = getEnv()
    _client = new S3Client({
      region: env.S3_REGION,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    })
    return _client
  } catch (err) {
    throw new S3ConnectionError('Failed to initialise S3 client', err)
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

const DEFAULT_TTL_SECONDS = 15 * 60 // 15 minutes

export async function uploadObject(params: {
  key: string
  body: Buffer | Uint8Array | ReadableStream
  contentType?: string
  cacheControl?: string
}): Promise<S3UploadResult> {
  const env = getEnv()
  const client = getClient()
  const contentType = params.contentType ?? detectMimeType(params.key)

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: params.key,
        Body: params.body,
        ContentType: contentType,
        CacheControl: params.cacheControl,
      }),
    )

    const ttl = Number(process.env.SIGNED_URL_TTL_SECONDS) || DEFAULT_TTL_SECONDS
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: params.key }),
      { expiresIn: ttl },
    )

    return { key: params.key, bucket: env.S3_BUCKET, region: env.S3_REGION, url }
  } catch (err) {
    throw new S3UploadError(`Failed to upload object: ${params.key}`, err)
  }
}

export async function listFiles(
  prefix: string,
  maxKeys: number = 100,
): Promise<S3ListResult[]> {
  const env = getEnv()
  const client = getClient()

  try {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: env.S3_BUCKET,
        Prefix: prefix,
        MaxKeys: maxKeys,
      }),
    )

    const items = res.Contents ?? []

    const results: S3ListResult[] = await Promise.all(
      items.map(async (item) => {
        const key = item.Key ?? ''
        const ttl = Number(process.env.SIGNED_URL_TTL_SECONDS) || DEFAULT_TTL_SECONDS
        const signedUrl = await getSignedUrl(
          client,
          new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
          { expiresIn: ttl },
        )

        return {
          key,
          size: item.Size ?? 0,
          lastModified: item.LastModified,
          signedUrl,
        }
      }),
    )

    return results
  } catch (err) {
    throw new S3ConnectionError('Failed to list objects', err)
  }
}

export async function getDownloadUrl(
  key: string,
  ttlSeconds?: number,
): Promise<string> {
  const env = getEnv()
  const client = getClient()
  const ttl = ttlSeconds ?? (Number(process.env.SIGNED_URL_TTL_SECONDS) || DEFAULT_TTL_SECONDS)

  try {
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
      { expiresIn: ttl },
    )
    return url
  } catch (err) {
    throw new S3NotFoundError(key)
  }
}

export async function healthCheck(): Promise<HealthCheckResult> {
  const env = getEnv()
  const client = getClient()

  try {
    await client.send(
      new HeadBucketCommand({ Bucket: env.S3_BUCKET }),
    )
    return { ok: true, bucket: env.S3_BUCKET, region: env.S3_REGION }
  } catch {
    return { ok: false, bucket: env.S3_BUCKET, region: env.S3_REGION }
  }
}
