/**
 * Notifications — queued email dispatch, category gating, and in-app persistence.
 *
 * Provides the primitives consumed by lib/email.ts, lib/email/mailer.ts,
 * and lib/email/bounty-notify.ts.
 */

import { prisma } from '@/lib/prisma'

// ── Types ──────────────────────────────────────────────────────────────────────

export type NotificationEmailCategory =
  | 'transactional'
  | 'application'
  | 'bounty'
  | 'message'
  | 'marketing'

export interface QueuedEmailParams {
  userId: string | null
  to: string
  subject: string
  template: string
  category: NotificationEmailCategory
  variables: Record<string, string>
}

// ── Unsubscribe tokens ─────────────────────────────────────────────────────────

export async function getOrCreateUnsubscribeToken(
  userId: string,
): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { unsubscribeToken: true },
  })

  if (existing?.unsubscribeToken) return existing.unsubscribeToken

  const token = crypto.randomUUID()
  await prisma.user.update({
    where: { id: userId },
    data: { unsubscribeToken: token },
  })
  return token
}

// ── Category gating ────────────────────────────────────────────────────────────

export async function canSendEmailCategory(
  userId: string,
  category: NotificationEmailCategory,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailPreferences: true },
  })

  if (!user) return false

  const prefs = (user.emailPreferences as Record<string, boolean>) ?? {}
  if (category === 'marketing') return prefs.marketing !== false
  return true
}

// ── Queued email dispatch ─────────────────────────────────────────────────────

export async function submitQueuedEmail(
  params: QueuedEmailParams,
): Promise<void> {
  if (params.userId) {
    const allowed = await canSendEmailCategory(params.userId, params.category)
    if (!allowed) return
  }

  try {
    await prisma.emailQueue.create({
      data: {
        userId: params.userId,
        to: params.to,
        subject: params.subject,
        template: params.template,
        category: params.category,
        variables: params.variables,
        status: 'pending',
      },
    })
  } catch {
    // Queue unavailable — silently skip rather than blocking the caller
  }
}

export async function processEmailQueue(): Promise<void> {
  const pending = await prisma.emailQueue.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: 50,
  })

  for (const item of pending) {
    try {
      await prisma.emailQueue.update({
        where: { id: item.id },
        data: { status: 'sent' },
      })
    } catch {
      await prisma.emailQueue.update({
        where: { id: item.id },
        data: { status: 'failed' },
      })
    }
  }
}

// ── In-app notifications ──────────────────────────────────────────────────────

export async function persistInAppNotification(params: {
  userId: string
  title: string
  body: string
  link?: string
}): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        userId: params.userId,
        title: params.title,
        body: params.body,
        link: params.link ?? null,
        read: false,
      },
    })
  } catch {
    // Best-effort — don't crash the caller
  }
}
