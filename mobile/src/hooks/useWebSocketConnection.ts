/**
 * useWebSocketConnection — React hook for WebSocket integration
 * Part of Issue #559
 *
 * Features:
 *  - React-friendly WebSocket hook
 *  - Automatic connection lifecycle management
 *  - State synchronization with React
 *  - Type-safe message handling
 *  - Cleanup on unmount
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  WebSocketService,
  ConnectionState,
  WebSocketMessage,
  MessageHandler,
} from '../services/WebSocketService';

interface UseWebSocketOptions {
  autoConnect?: boolean;
  onMessage?: MessageHandler;
  onError?: (error: Error) => void;
}

interface UseWebSocketReturn {
  connectionState: ConnectionState;
  isConnected: boolean;
  send: <T = unknown>(type: string, payload: T) => void;
  connect: () => void;
  disconnect: () => void;
  subscribe: <T = unknown>(type: string, handler: MessageHandler<T>) => () => void;
}

/**
 * Hook for managing WebSocket connection
 */
export function useWebSocketConnection(
  service: WebSocketService,
  options: UseWebSocketOptions = {}
): UseWebSocketReturn {
  const { autoConnect = true, onMessage, onError } = options;
  const [connectionState, setConnectionState] = useState<ConnectionState>(service.getState());
  const [isConnected, setIsConnected] = useState(service.isConnected());
  const unsubscribeRefs = useRef<Array<() => void>>([]);

  // Update connection state
  useEffect(() => {
    const unsubscribe = service.onStateChange((state) => {
      setConnectionState(state);
      setIsConnected(state === 'connected');
    });

    unsubscribeRefs.current.push(unsubscribe);

    return () => {
      unsubscribe();
    };
  }, [service]);

  // Handle global messages
  useEffect(() => {
    if (onMessage) {
      const unsubscribe = service.on('*', onMessage);
      unsubscribeRefs.current.push(unsubscribe);
      return () => {
        unsubscribe();
      };
    }
  }, [service, onMessage]);

  // Handle errors
  useEffect(() => {
    if (onError) {
      const unsubscribe = service.onError(onError);
      unsubscribeRefs.current.push(unsubscribe);
      return () => {
        unsubscribe();
      };
    }
  }, [service, onError]);

  // Auto-connect
  useEffect(() => {
    if (autoConnect) {
      service.connect();
    }

    return () => {
      // Cleanup all subscriptions
      unsubscribeRefs.current.forEach((unsub) => unsub());
      unsubscribeRefs.current = [];
    };
  }, [service, autoConnect]);

  const send = useCallback(
    <T = unknown>(type: string, payload: T) => {
      service.send(type, payload);
    },
    [service]
  );

  const connect = useCallback(() => {
    service.connect();
  }, [service]);

  const disconnect = useCallback(() => {
    service.disconnect();
  }, [service]);

  const subscribe = useCallback(
    <T = unknown>(type: string, handler: MessageHandler<T>) => {
      return service.on(type, handler);
    },
    [service]
  );

  return {
    connectionState,
    isConnected,
    send,
    connect,
    disconnect,
    subscribe,
  };
}

/**
 * Hook for subscribing to specific message types
 */
export function useWebSocketSubscription<T = unknown>(
  service: WebSocketService,
  messageType: string,
  handler: MessageHandler<T>
): void {
  useEffect(() => {
    const unsubscribe = service.on(messageType, handler);
    return () => {
      unsubscribe();
    };
  }, [service, messageType, handler]);
}

/**
 * Hook for sending messages with state tracking
 */
export function useWebSocketSender(
  service: WebSocketService
): {
  send: <T = unknown>(type: string, payload: T) => void;
  isSending: boolean;
} {
  const [isSending, setIsSending] = useState(false);

  const send = useCallback(
    <T = unknown>(type: string, payload: T) => {
      setIsSending(true);
      try {
        service.send(type, payload);
      } finally {
        // Reset after a short delay to show feedback
        setTimeout(() => setIsSending(false), 300);
      }
    },
    [service]
  );

  return { send, isSending };
}
