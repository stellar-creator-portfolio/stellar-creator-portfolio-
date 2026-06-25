'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Attachment, ChatMessage, useMessages } from '@/hooks/useMessages'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { Globe, Loader2, Paperclip, ShieldCheck, ShieldOff, SignalHigh, SignalMedium, SignalZero, Upload, User, X } from 'lucide-react'

// ─── Translation types & service ─────────────────────────────────────────────

type SupportedLocale = 'en' | 'es' | 'fr' | 'de' | 'ar'

const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  ar: 'العربية',
}

const translationCache = new Map<string, string>()

async function translateMessage(text: string, targetLocale: SupportedLocale): Promise<string> {
  if (targetLocale === 'en') return text
  const key = `${targetLocale}:${text}`
  if (translationCache.has(key)) return translationCache.get(key)!
  await new Promise((r) => setTimeout(r, 80 + Math.random() * 120))
  const translated = `[${targetLocale.toUpperCase()}] ${text}`
  translationCache.set(key, translated)
  return translated
}

interface MessageTranslation {
  text: string
  loading: boolean
  visible: boolean
  error: boolean
}

const participants = [
  { id: 'client-1', label: 'Client' },
  { id: 'creator-1', label: 'Creator' },
  { id: 'admin', label: 'Admin' },
]

const defaultThreads = [
  { id: 'general', label: 'Project Updates' },
  { id: 'assets', label: 'Assets & Files' },
  { id: 'qa', label: 'Q&A' },
]

type Props = {
  initialThreadId?: string
}

const statusIcon = (status: string) => {
  switch (status) {
    case 'open':
      return <SignalHigh className="h-4 w-4 text-emerald-500" />
    case 'connecting':
      return <SignalMedium className="h-4 w-4 text-amber-500" />
    case 'error':
      return <SignalZero className="h-4 w-4 text-red-500" />
    default:
      return <SignalMedium className="h-4 w-4 text-slate-500" />
  }
}

function humanTime(date: string) {
  try {
    return format(new Date(date), 'MMM d, HH:mm')
  } catch {
    return date
  }
}

export function ChatInterface({ initialThreadId = 'general' }: Props) {
  const [activeThread, setActiveThread] = useState(initialThreadId)
  const [currentUser, setCurrentUser] = useState(participants[0].id)
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [search, setSearch] = useState('')
  const [passphrase, setPassphrase] = useState('')

  // ── Translation state ──────────────────────────────────────────────────────
  const [translationLocale, setTranslationLocale] = useState<SupportedLocale>('en')
  const [msgTranslations, setMsgTranslations] = useState<Record<string, MessageTranslation>>({})

  const toggleTranslation = useCallback(async (msgId: string, originalText: string) => {
    const current = msgTranslations[msgId]
    if (current?.visible) {
      setMsgTranslations((prev) => ({ ...prev, [msgId]: { ...prev[msgId], visible: false } }))
      return
    }
    if (current?.text && !current.error) {
      setMsgTranslations((prev) => ({ ...prev, [msgId]: { ...prev[msgId], visible: true } }))
      return
    }
    setMsgTranslations((prev) => ({ ...prev, [msgId]: { text: '', loading: true, visible: true, error: false } }))
    try {
      const translated = await translateMessage(originalText, translationLocale)
      setMsgTranslations((prev) => ({ ...prev, [msgId]: { text: translated, loading: false, visible: true, error: false } }))
    } catch {
      setMsgTranslations((prev) => ({ ...prev, [msgId]: { text: '', loading: false, visible: true, error: true } }))
    }
  }, [msgTranslations, translationLocale])

  // Clear translations when locale changes
  const prevLocaleRef = useRef(translationLocale)
  useEffect(() => {
    if (prevLocaleRef.current !== translationLocale) {
      setMsgTranslations({})
      prevLocaleRef.current = translationLocale
    }
  }, [translationLocale])

  const {
    messages,
    typingUsers,
    status,
    connectionInfo,
    sendMessage,
    sendTyping,
    markRead,
    moderate,
    setPassphrase: updatePassphrase,
    search: searchMessages,
    loadMore,
    hasMore,
    loadingHistory,
  } = useMessages(activeThread, currentUser)

  useEffect(() => {
    updatePassphrase(passphrase)
  }, [passphrase, updatePassphrase])

  useEffect(() => {
    messages.forEach((msg) => {
      if (msg.senderId !== currentUser && !(msg.readBy || []).includes(currentUser)) {
        markRead(msg.id)
      }
    })
  }, [messages, currentUser, markRead])

  const filteredMessages = useMemo(() => {
    if (!search) return messages
    return searchMessages(search)
  }, [messages, search, searchMessages])

  const handleSend = async () => {
    if (!text.trim() && !file) return
    await sendMessage({
      text: text.trim(),
      file,
      threadId: activeThread,
      senderId: currentUser,
      recipientId: participants.find((p) => p.id !== currentUser)?.id || 'creator-1',
    })
    setText('')
    setFile(null)
  }

  const handleAttachment = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0]
    if (picked) setFile(picked)
  }

  const renderMessage = (msg: ChatMessage) => {
    const isMine = msg.senderId === currentUser
    const receipt = msg.status === 'read' ? '✓✓' : '✓'
    const translation = msgTranslations[msg.id]
    const isTranslated = translation?.visible && !translation.loading && !translation.error
    const displayText = isTranslated ? translation.text : (msg.plaintext || 'Encrypted message')

    return (
      <div key={msg.id} className={cn('flex flex-col gap-2 rounded-xl p-3 shadow-sm', isMine ? 'bg-primary/10' : 'bg-muted')}>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4" />
            <span>{isMine ? 'You' : msg.senderId}</span>
          </div>
          <span>{humanTime(msg.createdAt)}</span>
        </div>
        <div className="text-sm whitespace-pre-wrap break-words">
          {displayText}
        </div>
        {isTranslated && (
          <p className="text-[10px] text-muted-foreground italic">{LOCALE_LABELS[translationLocale]}</p>
        )}
        {translation?.loading && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Translating…</span>
          </div>
        )}
        {translation?.error && translation.visible && (
          <p className="text-xs text-destructive">Translation failed</p>
        )}
        {msg.attachment && <AttachmentPreview attachment={msg.attachment} />}
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{msg.threadId}</span>
          <span>{receipt} {msg.readBy?.includes(currentUser) ? 'read' : 'sent'}</span>
        </div>
        {translationLocale !== 'en' && (
          <button
            onClick={() => toggleTranslation(msg.id, msg.plaintext || '')}
            className="self-start text-[11px] text-primary underline hover:opacity-80"
          >
            {translation?.visible ? 'Show original' : 'Translate'}
          </button>
        )}
        {currentUser === 'admin' && (
          <div className="flex gap-2 text-xs">
            <button onClick={() => moderate(msg.id, 'delete', 'Removed by admin')} className="rounded-md bg-destructive/80 px-2 py-1 text-destructive-foreground">Delete</button>
            <button onClick={() => moderate(msg.id, 'flag', 'Flagged for review')} className="rounded-md bg-yellow-500/20 px-2 py-1 text-yellow-700 dark:text-yellow-300">Flag</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="grid min-h-[80vh] grid-cols-1 gap-4 lg:grid-cols-[280px_1fr_320px]">
      <aside className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Threads</h2>
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">{connectionInfo.status}</span>
        </div>
        <div className="space-y-2">
          {defaultThreads.map((thread) => (
            <button
              key={thread.id}
              onClick={() => setActiveThread(thread.id)}
              className={cn(
                'w-full rounded-xl border px-3 py-2 text-left transition',
                activeThread === thread.id ? 'border-primary bg-primary/10 text-primary' : 'hover:border-primary/60'
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{thread.label}</span>
                {activeThread === thread.id && statusIcon(connectionInfo.status)}
              </div>
              <p className="text-xs text-muted-foreground">Secure chat • History retained</p>
            </button>
          ))}
        </div>
        <div className="mt-6 space-y-2">
          <label className="text-xs uppercase text-muted-foreground">Encryption passphrase</label>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Set a shared secret"
            className="w-full rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="mt-4 space-y-2">
          <label className="text-xs uppercase text-muted-foreground">Search</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search messages"
            className="w-full rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="mt-4 space-y-2">
          <label className="flex items-center gap-1 text-xs uppercase text-muted-foreground">
            <Globe className="h-3 w-3" /> Translate to
          </label>
          <select
            value={translationLocale}
            onChange={(e) => setTranslationLocale(e.target.value as SupportedLocale)}
            className="w-full rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {(Object.entries(LOCALE_LABELS) as [SupportedLocale, string][]).map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
          {translationLocale !== 'en' && (
            <p className="text-[11px] text-muted-foreground">Click "Translate" on any message to see it in {LOCALE_LABELS[translationLocale]}.</p>
          )}
        </div>
      </aside>

      <section className="flex flex-col rounded-2xl border bg-card p-4 shadow-sm">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              value={currentUser}
              onChange={(e) => setCurrentUser(e.target.value)}
            >
              {participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {statusIcon(connectionInfo.status)}
          </div>
          <div className="text-xs text-muted-foreground">
            {typingUsers.length ? `${typingUsers.join(', ')} typing…` : 'Idle'}
          </div>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto rounded-xl bg-muted/40 p-4">
          {hasMore && (
            <div className="flex justify-center">
              <button
                onClick={loadMore}
                disabled={loadingHistory}
                className="rounded-lg bg-muted px-4 py-2 text-xs text-muted-foreground hover:bg-border transition-colors"
              >
                {loadingHistory ? 'Loading…' : 'Load earlier messages'}
              </button>
            </div>
          )}
          {filteredMessages.length === 0 && (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              No messages yet. Start the conversation!
            </div>
          )}
          {filteredMessages.map(renderMessage)}
        </div>

        <div className="mt-3 rounded-xl border bg-muted/30 p-3">
          {file && (
            <div className="mb-2 flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <Paperclip className="h-4 w-4" />
                <span>{file.name}</span>
              </div>
              <button onClick={() => setFile(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              } else {
                sendTyping()
              }
            }}
            placeholder="Type a message..."
            className="h-24 w-full resize-none rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background text-foreground px-3 py-2 text-sm hover:bg-muted transition-colors">
              <Upload className="h-4 w-4" />
              <span>Attach file</span>
              <input type="file" className="hidden" onChange={handleAttachment} />
            </label>
            <button
              onClick={handleSend}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:opacity-90"
            >
              Send
            </button>
          </div>
        </div>
      </section>

      <aside className="rounded-2xl border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-lg font-semibold">Admin & Safety</h3>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-500" /> End-to-end encryption (AES-GCM)</p>
          <p className="flex items-center gap-2"><ShieldOff className="h-4 w-4 text-amber-500" /> Admin can flag or delete harmful content.</p>
          <p>Attachments are encoded base64 and delivered with messages.</p>
          <p>Read receipts and typing indicators broadcast in real time.</p>
        </div>
        <div className="mt-4 space-y-2">
          <h4 className="font-semibold">Moderation tools</h4>
          <p className="text-xs text-muted-foreground">Switch to Admin user to delete/flag messages in-line.</p>
        </div>
      </aside>
    </div>
  )
}

function AttachmentPreview({ attachment }: { attachment: Attachment }) {
  const href = useMemo(() => `data:${attachment.type};base64,${attachment.data}`, [attachment])
  return (
    <a
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-background text-foreground px-3 py-2 text-xs hover:bg-muted transition-colors"
      href={href}
      download={attachment.name}
    >
      <Paperclip className="h-4 w-4" />
      <span>{attachment.name}</span>
    </a>
  )
}

export default ChatInterface
