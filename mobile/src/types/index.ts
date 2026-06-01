// ─── Canvas / Collaboration ───────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
  pressure?: number;
}

export interface VectorPath {
  id: string;
  userId: string;
  color: string;
  strokeWidth: number;
  points: Point[];
  closed: boolean;
  timestamp: number;
}

export interface CanvasState {
  paths: Record<string, VectorPath>;
  activePath: string | null;
  collaborators: Record<string, CollaboratorCursor>;
}

export interface CollaboratorCursor {
  userId: string;
  displayName: string;
  color: string;
  point: Point;
  lastSeen: number;
}

// ─── Messaging / Encryption ───────────────────────────────────────────────────

export interface KeyBundle {
  identityKey: Uint8Array;
  signedPreKey: { keyId: number; publicKey: Uint8Array; signature: Uint8Array };
  oneTimePreKeys: Array<{ keyId: number; publicKey: Uint8Array }>;
}

export interface EncryptedMessage {
  id: string;
  senderId: string;
  recipientId: string;
  ciphertext: Uint8Array;
  messageType: 1 | 3; // 1 = PreKeyWhisperMessage, 3 = WhisperMessage
  timestamp: number;
}

export interface DecryptedMessage {
  id: string;
  senderId: string;
  body: string;
  timestamp: number;
}

export interface SessionRecord {
  remoteUserId: string;
  sessionData: string; // base64 serialised session
  createdAt: number;
  lastUsed: number;
}

// ─── Upscaling ────────────────────────────────────────────────────────────────

export interface UpscaleOptions {
  scaleFactor: 2 | 4;
  tileSize: number;   // pixels — controls peak memory
  overlap: number;    // tile overlap to avoid seams
}

export interface UpscaleResult {
  uri: string;
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
  processingMs: number;
  peakMemoryMb: number;
}

// ─── Media trimming ───────────────────────────────────────────────────────────

export interface TrimRange {
  startMs: number;
  endMs: number;
}

export interface TrimOptions {
  inputUri: string;
  range: TrimRange;
  outputFormat: 'mp4' | 'mov';
  hardwareEncoding: boolean;
  videoBitrate?: number;  // kbps
  audioBitrate?: number;  // kbps
}

export interface TrimResult {
  outputUri: string;
  durationMs: number;
  fileSizeBytes: number;
  processingMs: number;
}

export interface VideoFrame {
  index: number;
  timestampMs: number;
  uri: string; // thumbnail URI
}
