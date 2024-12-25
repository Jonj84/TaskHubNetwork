import { useState, useEffect, useCallback } from 'react';
import { type WebSocketStatus } from '@/lib/websocket/WebSocketService';
import { useToast } from '@/hooks/use-toast';

interface WebSocketConfig {
  url: string;
  onStatusChange?: (status: WebSocketStatus) => void;
  onMessage?: (data: any) => void;
  reconnectAttempts?: number;
  initialBackoff?: number;
  maxBackoff?: number;
}

interface WebSocketService {
  connect: () => void;
  disconnect: () => void;
  manualReconnect: () => void;
}

let ws: WebSocket | null = null;
let reconnectAttempt = 0;
let backoffDelay = 1000;
let reconnectTimeout: NodeJS.Timeout | null = null;
let lastMessageTime = 0;
let heartbeatInterval: NodeJS.Timeout | null = null;

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
      console.log('[WebSocket] Already connecting, skipping reconnect');
      return;
    }

    try {
      console.log('[WebSocket] Attempting connection to:', url);
      ws = new WebSocket(url);
      backoffDelay = initialBackoff;
      lastMessageTime = Date.now();
      onStatusChange('connecting');

      ws.onopen = () => {
        console.log('[WebSocket] Connected successfully');
        reconnectAttempt = 0;
        onStatusChange('connected');

        // Start heartbeat after successful connection
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }
        heartbeatInterval = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          lastMessageTime = Date.now();

          if (data.type !== 'pong') {
            console.log('[WebSocket] Received message:', data);
          }
          onMessage(data);
        } catch (error) {
          console.error('[WebSocket] Message parse error:', error);
        }
      };

      ws.onclose = (event) => {
        console.log('[WebSocket] Connection closed:', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
          timeSinceLastMessage: Date.now() - lastMessageTime
        });

        cleanup();
        onStatusChange('disconnected');

        // Only attempt reconnect if we haven't reached the limit
        if (reconnectAttempt < reconnectAttempts) {
          const delay = Math.min(backoffDelay * Math.pow(2, reconnectAttempt), maxBackoff);
          console.log('[WebSocket] Scheduling reconnect:', {
            attempt: reconnectAttempt + 1,
            delay: `${delay}ms`
          });

          reconnectTimeout = setTimeout(() => {
            reconnectAttempt++;
            connect();
          }, delay);
        } else {
          console.log('[WebSocket] Max reconnection attempts reached');
          onStatusChange('error');
        }
      };

      ws.onerror = (event) => {
        console.log('[WebSocket] Connection error:', {
          type: event.type,
          timestamp: new Date().toISOString(),
          timeSinceLastMessage: Date.now() - lastMessageTime
        });
        onStatusChange('error');
      };

    } catch (error) {
      console.error('[WebSocket] Setup error:', error);
      cleanup();
      onStatusChange('error');
    }
  };

  const cleanup = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
  };

  const disconnect = () => {
    cleanup();

    if (ws) {
      try {
        ws.onclose = null; // Prevent reconnect on manual disconnect
        ws.close(1000, 'User initiated disconnect');
      } catch (error) {
        console.error('[WebSocket] Disconnect error:', error);
      }
      ws = null;
    }
  };

  const manualReconnect = () => {
    console.log('[WebSocket] Manual reconnection initiated');
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
  const { toast } = useToast();

  const [service] = useState(() => 
    createWebSocketService({
      url,
      onStatusChange: (newStatus) => {
        console.log('[WebSocket] Status changed:', newStatus);
        setStatus(newStatus);

        if (newStatus === 'error') {
          toast({
            title: 'Connection Error',
            description: 'Lost connection to server. Attempting to reconnect...',
            variant: 'destructive'
          });
        }
      },
      onMessage: (data) => {
        if (data.type !== 'pong') {
          console.log('[WebSocket] Received message:', data);
        }

        if (data.type === 'error') {
          toast({
            title: 'Error',
            description: data.data.message,
            variant: 'destructive'
          });
        }
      },
      reconnectAttempts: 5,
      initialBackoff: 1000,
      maxBackoff: 30000
    })
  );

  useEffect(() => {
    console.log('[WebSocket] Initializing connection to:', url);
    service.connect();

    return () => {
      console.log('[WebSocket] Cleaning up connection');
      service.disconnect();
    };
  }, [service, url]);

  const reconnect = useCallback(() => {
    console.log('[WebSocket] Manual reconnection requested');
    service.manualReconnect();
  }, [service]);

  return {
    status,
    reconnect,
    isConnected: status === 'connected'
  };
}