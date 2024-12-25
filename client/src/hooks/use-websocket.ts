import { useState, useEffect, useCallback } from 'react';
import { type WebSocketStatus } from '@/lib/websocket/WebSocketService';

interface WebSocketService {
  connect: () => void;
  disconnect: () => void;
  manualReconnect: () => void;
}

interface WebSocketConfig {
  url: string;
  onStatusChange?: (status: WebSocketStatus) => void;
  onMessage?: (data: any) => void;
  reconnectAttempts?: number;
  initialBackoff?: number;
  maxBackoff?: number;
}

let ws: WebSocket | null = null;
let reconnectAttempt = 0;
let backoffDelay = 1000;
let reconnectTimeout: NodeJS.Timeout | null = null;

function createWebSocketService(config: WebSocketConfig): WebSocketService {
  const {
    url,
    onStatusChange = () => {},
    onMessage = () => {},
    reconnectAttempts = 5,
    initialBackoff = 1000,
    maxBackoff = 30000
  } = config;

  const connect = () => {
    if (ws?.readyState === WebSocket.CONNECTING) {
      return; // Don't create multiple connections
    }

    try {
      ws = new WebSocket(url);
      backoffDelay = initialBackoff;

      ws.onopen = () => {
        console.log('[WebSocket] Connected successfully');
        reconnectAttempt = 0;
        onStatusChange('connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          onMessage(data);
        } catch (error) {
          // Silently log parse errors
          console.error('[WebSocket] Message parse error:', error);
        }
      };

      ws.onclose = () => {
        // Only log first disconnection
        if (ws?.readyState !== WebSocket.CONNECTING) {
          console.log('[WebSocket] Connection closed');
        }
        onStatusChange('disconnected');

        // Only attempt reconnect if we haven't reached the limit
        if (reconnectAttempt < reconnectAttempts) {
          const delay = Math.min(backoffDelay * Math.pow(2, reconnectAttempt), maxBackoff);
          reconnectTimeout = setTimeout(() => {
            reconnectAttempt++;
            connect();
          }, delay);
        }
      };

      ws.onerror = () => {
        // Just log that an error occurred, don't show details
        if (ws?.readyState !== WebSocket.CONNECTING) {
          console.log('[WebSocket] Connection error occurred');
        }
      };

    } catch (error) {
      // Log connection errors but don't propagate
      console.error('[WebSocket] Setup error:', error);
    }
  };

  const disconnect = () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }

    if (ws) {
      ws.onclose = null; // Prevent reconnect on manual disconnect
      try {
        ws.close();
      } catch (error) {
        // Ignore close errors
      }
      ws = null;
    }
  };

  const manualReconnect = () => {
    disconnect();
    reconnectAttempt = 0;
    backoffDelay = initialBackoff;
    connect();
  };

  return {
    connect,
    disconnect,
    manualReconnect
  };
}

export function useWebSocket(url: string) {
  const [status, setStatus] = useState<WebSocketStatus>('disconnected');
  const [service] = useState(() => 
    createWebSocketService({
      url,
      onStatusChange: (newStatus) => {
        setStatus(newStatus);
      },
      onMessage: (data) => {
        // Only log non-ping messages
        if (data.type !== 'pong') {
          console.log('[WebSocket] Received message:', data);
        }
      },
      reconnectAttempts: 5,
      initialBackoff: 1000,
      maxBackoff: 30000
    })
  );

  useEffect(() => {
    // Connect when the component mounts
    service.connect();

    // Cleanup on unmount
    return () => {
      service.disconnect();
    };
  }, [service]);

  const reconnect = useCallback(() => {
    service.manualReconnect();
  }, [service]);

  return {
    status,
    reconnect,
    isConnected: status === 'connected'
  };
}