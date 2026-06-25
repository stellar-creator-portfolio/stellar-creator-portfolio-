'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RealtimeWebSocket, WSStatus } from '@/lib/websocket/index'
import { toast } from 'sonner'

export type Attachment = {
  name: string
  type: string
  size: number
  data: string // base64
}

export type ChatMessage = {
  id: string
  threadId: string
  senderId: string
  recipientId: string
  createdAt: string
  ciphertext: string
  iv: string
  plaintext?: string
  attachment?: Attachment | null
  status?: 'sent' | 'delivered' | 'read'
  readBy?: string[]
}

type SendMessageInput = {
  text: string
  file?: File | null
  threadId: string
  senderId: string
  recipientId: string
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const base64FromArrayBuffer = (buffer: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))

const arrayBufferFromBase64 = (base64: string) =>
  Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer

async function deriveKey(passphrase: string, threadId: string) {
  const salt = textEncoder.encode(`stellar-${threadId}`)
  const baseKey = await crypto.subtle.importKey('raw', textEncoder.encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function encryptText(plaintext: string, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertextBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, textEncoder.encode(plaintext))
  return { ciphertext: base64FromArrayBuffer(ciphertextBuffer), iv: base64FromArrayBuffer(iv) }
}

async function decryptText(ciphertext: string, iv: string, key: CryptoKey) {
  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(arrayBufferFromBase64(iv)) },
    key,
    arrayBufferFromBase64(ciphertext)
  )
  return textDecoder.decode(plaintextBuffer)
}

export const messageCrypto = { deriveKey, encryptText, decryptText }

function getWsUrl(threadId: string): string {
  if (typeof window === 'undefined') return ''
  const base = process.env.NEXT_PUBLIC_MSG_WS_URL || `ws://${window.location.hostname}:3002`
  const token = getToken()
  return `${base}?threadId=${encodeURIComponent(threadId)}${token ? `&token=${encodeURIComponent(token)}` : ''}`
}

function getApiBase(): string {
  return '/api/messages'
}

function getToken(): string | null {
  try {
    return localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token') || null
  } catch {
    return null
  }
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function useMessages(threadId: string, currentUserId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const [status, setStatus] = useState<WSStatus>('connecting')
  const [passphrase, setPassphrase] = useState('')
  const [cryptoKey, setCryptoKey] = useState<CryptoKey | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const socketRef = useRef<RealtimeWebSocket | null>(null)
  const pendingRead = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!passphrase) {
      setCryptoKey(null)
      return
    }
    deriveKey(passphrase, threadId)
      .then(setCryptoKey)
      .catch(() => setCryptoKey(null))
  }, [passphrase, threadId])

  const decryptMessages = useCallback(async (items: ChatMessage[]) => {
    if (!cryptoKey) {
      return items.map((msg) => ({ ...msg, plaintext: 'Encrypted message. Enter passphrase to decrypt.' }))
    }

    const decrypted = await Promise.all(
      items.map(async (msg) => {
        try {
          const plaintext = await decryptText(msg.ciphertext, msg.iv, cryptoKey)
          return { ...msg, plaintext }
        } catch (err) {
          console.warn('Failed to decrypt', err)
          return { ...msg, plaintext: 'Unable to decrypt with current passphrase' }
        }
      })
    )
    return decrypted
  }, [cryptoKey])

  // Initial history load via REST
  useEffect(() => {
    if (!threadId) return

    const loadHistory = async () => {
      setLoadingHistory(true)
      try {
        const params = new URLSearchParams({ threadId, limit: '200' })
        const res = await fetch(`${getApiBase()}?${params}`, { headers: authHeaders() })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const decrypted = await decryptMessages(data.messages || [])
        setMessages(decrypted)
        setNextCursor(data.nextCursor || null)
        setHasMore(data.hasMore || false)
      } catch (err) {
        console.error('Failed to load message history', err)
      } finally {
        setLoadingHistory(false)
      }
    }

    loadHistory()
  }, [threadId, decryptMessages])

  // Cursor-based pagination
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingHistory || !threadId) return

    setLoadingHistory(true)
    try {
      const params = new URLSearchParams({ threadId, cursor: nextCursor, limit: '50' })
      const res = await fetch(`${getApiBase()}?${params}`, { headers: authHeaders() })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const decrypted = await decryptMessages(data.messages || [])
      setMessages((prev) => [...prev, ...decrypted])
      setNextCursor(data.nextCursor || null)
      setHasMore(data.hasMore || false)
    } catch (err) {
      console.error('Failed to load more messages', err)
    } finally {
      setLoadingHistory(false)
    }
  }, [nextCursor, loadingHistory, threadId, decryptMessages])

  // WebSocket connection for real-time
  useEffect(() => {
    if (typeof window === 'undefined') return
    const wsUrl = getWsUrl(threadId)
    const socket = new RealtimeWebSocket(wsUrl, { onStatusChange: setStatus })
    socketRef.current = socket

    const unsubscribe = socket.subscribe(async (event) => {
      const payload = JSON.parse(event.data)
      if (payload.type === 'history') {
        const decrypted = await decryptMessages(payload.data)
        setMessages(decrypted)
      } else if (payload.type === 'message') {
        const decrypted = await decryptMessages([payload.data])
        setMessages((prev) => [...prev, ...decrypted])
        if (payload.data.senderId !== currentUserId) {
          toast.success('New message received')
        }
      } else if (payload.type === 'typing') {
        setTypingUsers((prev) => {
          if (payload.userId === currentUserId) return prev
          const next = new Set(prev)
          next.add(payload.userId)
          setTimeout(() => setTypingUsers((list) => list.filter((id) => id !== payload.userId)), 2000)
          return Array.from(next)
        })
      } else if (payload.type === 'read-receipt') {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === payload.messageId
              ? { ...msg, status: 'read', readBy: Array.from(new Set([...(msg.readBy || []), payload.userId])) }
              : msg
          )
        )
      } else if (payload.type === 'moderated') {
        toast.warning(`Message ${payload.action} by admin`)
        if (payload.action === 'delete') {
          setMessages((prev) => prev.filter((m) => m.id !== payload.messageId))
        }
      }
    })

    return () => {
      unsubscribe()
      socket.close()
    }
  }, [threadId, currentUserId, decryptMessages])

  const sendMessage = async ({ text, file, threadId: tId, senderId, recipientId }: SendMessageInput) => {
    const key = cryptoKey || (await deriveKey(passphrase || senderId, threadId))
    const encrypted = await encryptText(text, key)
    let attachment: Attachment | null = null

    if (file) {
      const buffer = await file.arrayBuffer()
      attachment = {
        name: file.name,
        type: file.type,
        size: file.size,
        data: base64FromArrayBuffer(buffer),
      }
    }

    const payload = {
      id: crypto.randomUUID(),
      threadId: tId,
      senderId,
      recipientId,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      attachment,
      metadata: { plainText: text.slice(0, 200) },
    }

    const optimistic: ChatMessage = {
      id: payload.id,
      threadId: tId,
      senderId,
      recipientId,
      ciphertext: payload.ciphertext,
      iv: payload.iv,
      createdAt: new Date().toISOString(),
      plaintext: text,
      attachment,
      status: 'sent',
      readBy: [senderId],
    }
    setMessages((prev) => [...prev, optimistic])

    // Send via REST API
    try {
      const res = await fetch(getApiBase(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        toast.error(errBody.error || 'Failed to send message')
        setMessages((prev) => prev.filter((m) => m.id !== payload.id))
      }
    } catch (err) {
      console.error('Failed to send message', err)
      toast.error('Failed to send message')
      setMessages((prev) => prev.filter((m) => m.id !== payload.id))
    }
  }

  const sendTyping = () => {
    socketRef.current?.send({ type: 'typing', userId: currentUserId, threadId })
  }

  const markRead = (messageId: string) => {
    if (pendingRead.current.has(messageId)) return
    pendingRead.current.add(messageId)
    socketRef.current?.send({ type: 'read-receipt', messageId, userId: currentUserId })
  }

  const moderate = async (messageId: string, action: 'delete' | 'flag', reason?: string) => {
    try {
      const res = await fetch(getApiBase(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action: 'moderate', messageId, moderateAction: action, reason }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        toast.error(errBody.error || 'Moderation failed')
      }
    } catch (err) {
      console.error('Moderation failed', err)
      toast.error('Moderation request failed')
    }
  }

  const search = (q: string) => {
    const query = q.toLowerCase()
    return messages.filter((msg) => msg.plaintext?.toLowerCase().includes(query))
  }

  const connectionInfo = useMemo(
    () => ({ isConnected: status === 'open', status }),
    [status]
  )

  return {
    messages,
    typingUsers,
    status,
    connectionInfo,
    setPassphrase,
    sendMessage,
    sendTyping,
    markRead,
    moderate,
    search,
    loadMore,
    hasMore,
    loadingHistory,
  }
}
