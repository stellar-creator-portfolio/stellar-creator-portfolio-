/**
 * WebSocketService — Issue #559
 * "Integrate specific fluid interactive standard Websocket capabilities comprehensively"
 *
 * Features:
 *  - Robust WebSocket connection management
 *  - Automatic reconnection with exponential backoff
 *  - Connection state tracking
 *  - Message queuing for offline scenarios
 *  - Event-based message handling
 *  - Heartbeat/ping-pong for connection health
 *  - Type-safe message protocols
 *  - Error handling and recovery
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error';

export interface WebSocketMessage<T = unknown> {
  type: string;
  payload: T;
  timestamp: number;
  id?: string;
}

export interface WebSocketConfig {
  url: string;
  protocols?: string[];
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
  messageQueueSize?: number;
}

export type MessageHandler<T = unknown> = (message: WebSocketMessage<T>) => void;
export type StateChangeHandler = (state: ConnectionState) => void;
export type ErrorHandler = (error: Error) => void;

// ─── WebSocket Service ────────────────────────────────────────────────────────

export class WebSocketService {
  private ws: WebSocket | null = null;
  private config: Required<WebSocketConfig>;
  private connectionState: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private messageQueue: WebSocketMessage[] = [];
  private messageHandlers: Map<string, Set<MessageHandler>> = new Map();
  private stateChangeHandlers: Set<StateChangeHandler> = new Set();
  private errorHandlers: Set<ErrorHandler> = new Set();
  private lastHeartbeat: number = Date.now();

  constructor(config: WebSocketConfig) {
    this.config = {
      url: config.url,
      protocols: config.protocols ?? [],
      reconnectInterval: config.reconnectInterval ?? 3000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      heartbeatInterval: config.heartbeatInterval ?? 30000,
      messageQueueSize: config.messageQueueSize ?? 100,
    };
  }

  // ── Connection Management ─────────────────────────────────────────────────

  /**
   * Connect to WebSocket server
   */
  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      console.warn('[WebSocket] Already connected or connecting');
      return;
    }

    this.updateState('connecting');

    try {
      this.ws = new WebSocket(this.config.url, this.config.protocols);
      this.setupEventHandlers();
    } catch (error) {
      this.handleError(new Error(`Failed to create WebSocket: ${error}`));
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.clearTimers();
    
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.updateState('disconnected');
    this.reconnectAttempts = 0;
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionState === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  // ── Message Handling ──────────────────────────────────────────────────────

  /**
   * Send a message through WebSocket
   */
  send<T = unknown>(type: string, payload: T): void {
    const message: WebSocketMessage<T> = {
      type,
      payload,
      timestamp: Date.now(),
      id: this.generateMessageId(),
    };

    if (this.isConnected()) {
      this.sendMessage(message);
    } else {
      this.queueMessage(message);
    }
  }

  /**
   * Subscribe to messages of a specific type
   */
  on<T = unknown>(type: string, handler: MessageHandler<T>): () => void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    this.messageHandlers.get(type)!.add(handler as MessageHandler);

    // Return unsubscribe function
    return () => {
      const handlers = this.messageHandlers.get(type);
      if (handlers) {
        handlers.delete(handler as MessageHandler);
        if (handlers.size === 0) {
          this.messageHandlers.delete(type);
        }
      }
    };
  }

  /**
   * Subscribe to connection state changes
   */
  onStateChange(handler: StateChangeHandler): () => void {
    this.stateChangeHandlers.add(handler);
    return () => this.stateChangeHandlers.delete(handler);
  }

  /**
   * Subscribe to errors
   */
  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  // ── Private Methods ───────────────────────────────────────────────────────

  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log('[WebSocket] Connected');
      this.updateState('connected');
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.flushMessageQueue();
    };

    this.ws.onmessage = (event) => {
      this.lastHeartbeat = Date.now();
      
      try {
        const message = JSON.parse(event.data) as WebSocketMessage;
        this.handleMessage(message);
      } catch (error) {
        this.handleError(new Error(`Failed to parse message: ${error}`));
      }
    };

    this.ws.onerror = (event) => {
      console.error('[WebSocket] Error:', event);
      this.handleError(new Error('WebSocket error occurred'));
    };

    this.ws.onclose = (event) => {
      console.log('[WebSocket] Closed:', event.code, event.reason);
      this.clearTimers();

      if (event.code !== 1000) {
        // Abnormal closure, attempt reconnect
        this.scheduleReconnect();
      } else {
        this.updateState('disconnected');
      }
    };
  }

  private handleMessage(message: WebSocketMessage): void {
    // Handle heartbeat/pong messages
    if (message.type === 'pong') {
      return;
    }

    // Notify type-specific handlers
    const handlers = this.messageHandlers.get(message.type);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(message);
        } catch (error) {
          console.error(`[WebSocket] Handler error for type "${message.type}":`, error);
        }
      });
    }

    // Notify wildcard handlers
    const wildcardHandlers = this.messageHandlers.get('*');
    if (wildcardHandlers) {
      wildcardHandlers.forEach((handler) => {
        try {
          handler(message);
        } catch (error) {
          console.error('[WebSocket] Wildcard handler error:', error);
        }
      });
    }
  }

  private sendMessage(message: WebSocketMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.queueMessage(message);
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      this.handleError(new Error(`Failed to send message: ${error}`));
      this.queueMessage(message);
    }
  }

  private queueMessage(message: WebSocketMessage): void {
    if (this.messageQueue.length >= this.config.messageQueueSize) {
      this.messageQueue.shift(); // Remove oldest message
    }
    this.messageQueue.push(message);
  }

  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0 && this.isConnected()) {
      const message = this.messageQueue.shift();
      if (message) {
        this.sendMessage(message);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('[WebSocket] Max reconnect attempts reached');
      this.updateState('error');
      this.handleError(new Error('Max reconnection attempts exceeded'));
      return;
    }

    this.updateState('reconnecting');
    this.reconnectAttempts++;

    // Exponential backoff
    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1),
      30000 // Max 30 seconds
    );

    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected()) {
        // Check if we've received a message recently
        const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat;
        
        if (timeSinceLastHeartbeat > this.config.heartbeatInterval * 2) {
          // Connection seems dead, reconnect
          console.warn('[WebSocket] Heartbeat timeout, reconnecting');
          this.disconnect();
          this.connect();
        } else {
          // Send ping
          this.send('ping', {});
        }
      }
    }, this.config.heartbeatInterval);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private updateState(state: ConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state;
      this.stateChangeHandlers.forEach((handler) => {
        try {
          handler(state);
        } catch (error) {
          console.error('[WebSocket] State change handler error:', error);
        }
      });
    }
  }

  private handleError(error: Error): void {
    console.error('[WebSocket] Error:', error);
    this.errorHandlers.forEach((handler) => {
      try {
        handler(error);
      } catch (err) {
        console.error('[WebSocket] Error handler error:', err);
      }
    });
  }

  private generateMessageId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  /**
   * Clean up resources
   */
  destroy(): void {
    this.disconnect();
    this.messageHandlers.clear();
    this.stateChangeHandlers.clear();
    this.errorHandlers.clear();
    this.messageQueue = [];
  }
}

// ─── Singleton Instance ───────────────────────────────────────────────────────

let globalWebSocketService: WebSocketService | null = null;

/**
 * Get or create global WebSocket service instance
 */
export function getWebSocketService(config?: WebSocketConfig): WebSocketService {
  if (!globalWebSocketService && config) {
    globalWebSocketService = new WebSocketService(config);
  }

  if (!globalWebSocketService) {
    throw new Error('WebSocket service not initialized. Provide config on first call.');
  }

  return globalWebSocketService;
}

/**
 * Destroy global WebSocket service instance
 */
export function destroyWebSocketService(): void {
  if (globalWebSocketService) {
    globalWebSocketService.destroy();
    globalWebSocketService = null;
  }
}
