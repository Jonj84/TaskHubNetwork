import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';

// WebSocket connection states
export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

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
  send: (message: any) => void;
}

function createWebSocketService(config: WebSocketConfig): WebSocketService {
  const {
    url,
    onStatusChange = () => {},
    onMessage = () => {},
    reconnectAttempts = 5,
    initialBackoff = 1000,
    maxBackoff = 30000
  } = config;

  let ws: WebSocket | null = null;
  let reconnectAttempt = 0;
  let backoffDelay = initialBackoff;
  let reconnectTimeout: NodeJS.Timeout | null = null;
  let heartbeatInterval: NodeJS.Timeout | null = null;
  let lastMessageTime = 0;

  const cleanup = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close(1000, 'Cleanup');
    }
  };

  const connect = () => {
    if (ws?.readyState === WebSocket.CONNECTING) {
      console.log('[WebSocket] Already connecting, skipping reconnect');
      return;
    }

    try {
      console.log('[WebSocket] Attempting connection to:', url);
      cleanup();

      ws = new WebSocket(url);
      lastMessageTime = Date.now();
      onStatusChange('connecting');

      ws.onopen = () => {
        console.log('[WebSocket] Connected successfully');
        reconnectAttempt = 0;
        backoffDelay = initialBackoff;
        onStatusChange('connected');

        // Start heartbeat
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
        }
        heartbeatInterval = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: 'ping' }));
            } catch (error) {
              console.error('[WebSocket] Heartbeat failed:', error);
            }
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

        // Only attempt reconnect if not a clean close and haven't reached limit
        if (!event.wasClean && reconnectAttempt < reconnectAttempts) {
          const delay = Math.min(backoffDelay * Math.pow(2, reconnectAttempt), maxBackoff);
          console.log('[WebSocket] Scheduling reconnect:', {
            attempt: reconnectAttempt + 1,
            delay: `${delay}ms`
          });

          reconnectTimeout = setTimeout(() => {
            reconnectAttempt++;
            connect();
          }, delay);
        } else if (reconnectAttempt >= reconnectAttempts) {
          console.log('[WebSocket] Max reconnection attempts reached');
          onStatusChange('error');
        }
      };

      ws.onerror = (event) => {
        console.error('[WebSocket] Connection error:', {
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

  const disconnect = () => {
    console.log('[WebSocket] Manual disconnect initiated');
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        ws.close(1000, 'User initiated disconnect');
      } catch (error) {
        console.error('[WebSocket] Disconnect error:', error);
      }
    }
    cleanup();
    ws = null;
  };

  const manualReconnect = () => {
    console.log('[WebSocket] Manual reconnection requested');
    disconnect();
    reconnectAttempt = 0;
    backoffDelay = initialBackoff;
    connect();
  };

  const send = (message: any) => {
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('[WebSocket] Send error:', error);
      }
    } else {
      console.warn('[WebSocket] Cannot send message, connection not open');
    }
  };

  return {
    connect,
    disconnect,
    manualReconnect,
    send
  };
}

export function useWebSocket() {
  const [status, setStatus] = useState<WebSocketStatus>('disconnected');
  const { toast } = useToast();

  // Ensure WebSocket URL is properly constructed
  const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/ws`;

  const [service] = useState(() => 
    createWebSocketService({
      url: wsUrl,
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
    console.log('[WebSocket] Initializing connection to:', wsUrl);
    service.connect();

    return () => {
      console.log('[WebSocket] Cleaning up connection');
      service.disconnect();
    };
  }, [service, wsUrl]);

  const reconnect = useCallback(() => {
    console.log('[WebSocket] Manual reconnection requested');
    service.manualReconnect();
  }, [service]);

  const send = useCallback((message: any) => {
    service.send(message);
  }, [service]);

  return {
    status,
    reconnect,
    send,
    isConnected: status === 'connected'
  };
}