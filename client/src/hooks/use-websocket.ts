import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';

type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface WebSocketMessage {
  type: string;
  data?: any;
}

export function useWebSocket() {
  const [status, setStatus] = useState<WebSocketStatus>('disconnected');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptRef = useRef(0);
  const { toast } = useToast();

  const getWebSocketUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/api/ws`;

    console.log('[WebSocket] Constructing URL:', {
      protocol,
      host,
      url
    });

    return url;
  }, []);

  const connect = useCallback(() => {
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        console.log('[WebSocket] Already connected');
        return;
      }

      // Clean up existing connection
      if (wsRef.current) {
        wsRef.current.close(1000, 'Reconnecting');
        wsRef.current = null;
      }

      const wsUrl = getWebSocketUrl();
      console.log('[WebSocket] Connecting to:', wsUrl);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      setStatus('connecting');

      // Connection timeout
      const connectionTimeout = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          console.log('[WebSocket] Connection timeout');
          ws.close();
        }
      }, 10000);

      ws.onopen = () => {
        clearTimeout(connectionTimeout);
        console.log('[WebSocket] Connected');
        setStatus('connected');
        reconnectAttemptRef.current = 0;

        // Initial ping
        ws.send(JSON.stringify({ type: 'ping' }));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;

          switch (message.type) {
            case 'connection_established':
              setSessionId(message.data.sessionId);
              console.log('[WebSocket] Session established:', message.data);
              break;
            case 'pong':
              console.log('[WebSocket] Received pong');
              break;
            case 'balance_update':
              console.log('[WebSocket] Balance update:', message.data);
              break;
            case 'error':
              console.error('[WebSocket] Server error:', message.data);
              toast({
                variant: 'destructive',
                title: 'Connection Error',
                description: message.data.message || 'An error occurred'
              });
              break;
            default:
              console.log('[WebSocket] Received message:', message);
          }
        } catch (error) {
          console.error('[WebSocket] Message parsing error:', error);
        }
      };

      ws.onclose = (event) => {
        clearTimeout(connectionTimeout);
        console.log('[WebSocket] Connection closed:', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean
        });

        setStatus('disconnected');
        wsRef.current = null;

        if (!event.wasClean && reconnectAttemptRef.current < 5) {
          const backoff = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 30000);
          console.log(`[WebSocket] Reconnecting in ${backoff}ms (attempt ${reconnectAttemptRef.current + 1})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptRef.current++;
            connect();
          }, backoff);
        }
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        setStatus('error');
      };

    } catch (error) {
      console.error('[WebSocket] Setup error:', error);
      setStatus('error');
    }
  }, [getWebSocketUrl, toast]);

  // Connect on mount
  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounted');
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  // Keepalive ping
  useEffect(() => {
    if (status !== 'connected') return;

    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    return () => clearInterval(pingInterval);
  }, [status]);

  return {
    status,
    sessionId,
    send: useCallback((message: WebSocketMessage) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.warn('[WebSocket] Cannot send - not connected');
        return;
      }

      try {
        wsRef.current.send(JSON.stringify(message));
      } catch (error) {
        console.error('[WebSocket] Send error:', error);
        toast({
          variant: 'destructive',
          title: 'Send Error',
          description: 'Failed to send message'
        });
      }
    }, [toast]),
    isConnected: status === 'connected',
    connect
  };
}