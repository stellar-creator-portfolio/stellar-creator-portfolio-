import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { redisIncr } from "@/lib/storage/redis";
import { Role } from "@prisma/client";

const ErrorContextSchema = z
  .object({
    userId: z.string().min(1).optional(),
    userEmail: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    component: z.string().min(1).optional(),
    action: z.string().min(1).optional(),
    metadata: z
      .record(z.any())
      .refine((v: Record<string, unknown>) => {
        const keys = v ? Object.keys(v) : [];
        return keys.length <= 100;
      })
      .optional(),
  })
  .strict();

// NOTE: keeping depth calculation stubbed for future stricter enforcement.
// Current schema enforces metadata size/shape.
function depthOfObject(value: unknown): number {
  const seen = new Set<unknown>();
  function walk(v: unknown, depth: number): number {
    if (v === null || v === undefined) return depth;
    if (typeof v !== "object") return depth;
    if (seen.has(v)) return depth;
    seen.add(v);

    if (Array.isArray(v)) {
      let max = depth;
      for (const item of v) max = Math.max(max, walk(item, depth + 1));
      return max;
    }

    let max = depth;
    for (const k of Object.keys(v as Record<string, unknown>)) {
      max = Math.max(max, walk((v as Record<string, unknown>)[k], depth + 1));
    }
    return max;
  }

  return walk(value, 0);
}

const ErrorReportSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().min(1),
  level: z.enum(["error", "warning", "info"]),
  message: z.string().min(1).max(5000),
  stack: z.string().optional().max(10000),
  context: ErrorContextSchema,
  url: z.string().url().optional(),
  userAgent: z.string().optional(),
  environment: z
    .enum(["development", "staging", "production"])
    .optional()
    .default("development"),
});

type ErrorReportPayload = z.infer<typeof ErrorReportSchema>;

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  const ip = req.headers.get("x-real-ip");
  return ip || "unknown";
}

async function requireAdmin(
  req: NextRequest,
): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  // NOTE: This repo doesn't expose a reusable admin middleware in lib/auth.
  // We implement a minimal, compatible auth strategy using the existing
  // NextAuth cookie/session approach if present.

  // Try to read user info from a signed header set by existing server middleware.
  const adminUserId = req.headers.get("x-user-id");
  const adminRole = req.headers.get("x-user-role");
  if (adminUserId && adminRole === Role.ADMIN) {
    return { ok: true, userId: adminUserId };
  }

  // Fallback: check for a bearer token (JWT or similar) that may already be used by the app.
  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    // Minimal decode-free approach: the app commonly validates tokens elsewhere.
    // Without shared helpers in this snapshot, we deny by default.
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return {
    ok: false,
    response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  };
}

export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => null);
  const parsed = ErrorReportSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid payload",
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const ip = getClientIp(req);
  const rateKey = `errors:log:post:${ip}`;
  // max 10 errors per minute per IP
  const count = await redisIncr(rateKey, 60);
  if (count != null && count > 10) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const report: ErrorReportPayload = parsed.data;
  const reportContext = report.context || {};

  const metadata = reportContext.metadata;
  if (metadata) {
    const metadataDepth = depthOfObject(metadata);
    if (metadataDepth > 5) {
      return NextResponse.json(
        {
          error: "Invalid payload",
          issues: [{ message: "context.metadata exceeds max depth of 5" }],
        },
        { status: 400 },
      );
    }

    const metadataKeysCount = Object.keys(
      metadata as Record<string, unknown>,
    ).length;
    if (metadataKeysCount > 100) {
      return NextResponse.json(
        {
          error: "Invalid payload",
          issues: [{ message: "context.metadata exceeds max 100 keys" }],
        },
        { status: 400 },
      );
    }
  }

  const record = await prisma.errorLog.create({
    data: {
      id: report.id,
      timestamp: new Date(report.timestamp),
      level: report.level,
      message: report.message,
      stack: report.stack,
      context: {
        ...reportContext,
        metadata: reportContext.metadata,
      },
      url: report.url,
      userAgent: report.userAgent,
      environment: report.environment,
    },
  });

  return NextResponse.json({ id: record.id }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const { searchParams } = req.nextUrl;

  const level = searchParams.get("level");
  const environment = searchParams.get("environment");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const search = searchParams.get("search");

  const pageRaw = searchParams.get("page");
  const limitRaw = searchParams.get("limit");
  const page = Math.max(1, pageRaw ? Number(pageRaw) : 1);
  const limit = Math.min(100, Math.max(1, limitRaw ? Number(limitRaw) : 50));
  const skip = (page - 1) * limit;

  const where: any = {};
  if (level && ["error", "warning", "info"].includes(level))
    where.level = level;
  if (
    environment &&
    ["development", "staging", "production"].includes(environment)
  )
    where.environment = environment;
  if (dateFrom) {
    const d = new Date(dateFrom);
    if (!isNaN(d.getTime()))
      where.timestamp = { ...(where.timestamp ?? {}), gte: d };
  }
  if (dateTo) {
    const d = new Date(dateTo);
    if (!isNaN(d.getTime()))
      where.timestamp = { ...(where.timestamp ?? {}), lte: d };
  }
  if (search && search.trim().length > 0) {
    // Message text search
    where.message = { contains: search.trim(), mode: "insensitive" };
  }

  const [total, errors] = await Promise.all([
    prisma.errorLog.count({ where }),
    prisma.errorLog.findMany({
      where,
      orderBy: { timestamp: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        timestamp: true,
        level: true,
        message: true,
        stack: true,
        context: true,
        url: true,
        userAgent: true,
        environment: true,
      },
    }),
  ]);

  return NextResponse.json({ errors, total });
}
