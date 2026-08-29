/**
 * Email mailer — rendering, transactional send, and templated delivery.
 *
 * Provides the core email primitives consumed by lib/email.ts barrel
 * and lib/email/index.ts re-export.
 */

import { submitQueuedEmail, type NotificationEmailCategory } from '@/lib/notifications'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface BountyNotificationVars {
  name: string
  headline: string
  bodyText: string
  actionUrl: string
  actionLabel: string
  footerNote: string
}

export interface WelcomeVars {
  name: string
  dashboardUrl: string
}

export type EmailTemplate = 'application-status' | 'bounty-update' | 'bounty-notification' | 'welcome'

export interface SendEmailOptions {
  to: string
  subject: string
  html: string
  category?: NotificationEmailCategory
}

// ── Rendering ──────────────────────────────────────────────────────────────────

export function renderEmail(template: EmailTemplate, vars: Record<string, string>): string {
  const headline = vars.headline ?? ''
  const bodyText = vars.bodyText ?? ''
  const actionUrl = vars.actionUrl ?? ''
  const actionLabel = vars.actionLabel ?? ''
  const footerNote = vars.footerNote ?? ''

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <h2>${headline}</h2>
      <p>${bodyText}</p>
      ${actionUrl ? `<p><a href="${actionUrl}" style="display:inline-block;padding:10px 20px;background:#6366f1;color:#fff;text-decoration:none;border-radius:6px;">${actionLabel}</a></p>` : ''}
      ${footerNote ? `<p style="color:#888;font-size:13px;margin-top:32px;">${footerNote}</p>` : ''}
    </body>
    </html>
  `
}

// ── Send ───────────────────────────────────────────────────────────────────────

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const appUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  await submitQueuedEmail({
    userId: null,
    to: options.to,
    subject: options.subject,
    template: 'transactional',
    category: options.category ?? 'transactional',
    variables: {
      name: '',
      headline: options.subject,
      bodyText: '',
      actionUrl: appUrl,
      actionLabel: '',
      footerNote: '',
    },
  })
}

export async function deliverTemplatedEmail(params: {
  to: string
  subject: string
  template: EmailTemplate
  variables: BountyNotificationVars
  category?: NotificationEmailCategory
  userId?: string | null
}): Promise<void> {
  await submitQueuedEmail({
    userId: params.userId ?? null,
    to: params.to,
    subject: params.subject,
    template: params.template,
    category: params.category ?? 'transactional',
    variables: params.variables,
  })
}

export async function deliverHtmlEmail(params: {
  to: string
  subject: string
  html: string
  category?: NotificationEmailCategory
}): Promise<void> {
  await submitQueuedEmail({
    userId: null,
    to: params.to,
    subject: params.subject,
    template: 'transactional',
    category: params.category ?? 'transactional',
    variables: {
      name: '',
      headline: params.subject,
      bodyText: params.html,
      actionUrl: '',
      actionLabel: '',
      footerNote: '',
    },
  })
}
