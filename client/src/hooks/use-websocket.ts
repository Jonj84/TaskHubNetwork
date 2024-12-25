import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';

// WebSocket connection states
export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface WebSocketMessage {
  type: string;
  data?: any;
}

export function useWebSocket() {
  const [status, setStatus] = useState<WebSocketStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const pingIntervalRef = useRef<NodeJS.Timeout>();
  const { toast } = useToast();

  // Get the WebSocket URL from the current window location
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const wsUrl = `${protocol}//${host}/api/ws`;

  const cleanup = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = undefined;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }
    wsRef.current = null;
  }, []);

  const connect = useCallback(() => {
    cleanup();

    try {
      console.log('[WebSocket] Connecting to:', wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      setStatus('connecting');

      ws.onopen = () => {
        console.log('[WebSocket] Connected successfully');
        setStatus('connected');

        // Start heartbeat
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
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
          const message = JSON.parse(event.data) as WebSocketMessage;

          // Handle specific message types
          switch (message.type) {
            case 'error':
              toast({
                title: 'Error',
                description: message.data?.message || 'An error occurred',
                variant: 'destructive',
              });
              break;
            case 'balance_update':
              console.log('[WebSocket] Balance updated:', message.data);
              break;
            case 'pong':
              // Heartbeat response received
              break;
            default:
              console.log('[WebSocket] Message received:', message);
          }
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };

      ws.onclose = (event) => {
        console.log('[WebSocket] Connection closed:', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean
        });

        cleanup();
        setStatus('disconnected');

        // Attempt to reconnect after a delay
        if (!event.wasClean) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('[WebSocket] Attempting to reconnect...');
            connect();
          }, 5000);
        }
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] Connection error:', error);
        setStatus('error');

        toast({
          title: 'Connection Error',
          description: 'Lost connection to server. Attempting to reconnect...',
          variant: 'destructive',
        });
      };
    } catch (error) {
      console.error('[WebSocket] Setup error:', error);
      setStatus('error');
      cleanup();
    }
  }, [wsUrl, cleanup, toast]);

  const send = useCallback((message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(message));
      } catch (error) {
        console.error('[WebSocket] Failed to send message:', error);
        toast({
          title: 'Error',
          description: 'Failed to send message',
          variant: 'destructive',
        });
      }
    } else {
      console.warn('[WebSocket] Cannot send message - connection not open');
    }
  }, [toast]);

  const reconnect = useCallback(() => {
    console.log('[WebSocket] Manual reconnection initiated');
    connect();
  }, [connect]);

  // Set up connection on mount
  useEffect(() => {
    connect();
    return cleanup;
  }, [connect, cleanup]);

  return {
    status,
    send,
    reconnect,
    isConnected: status === 'connected'
  };
}