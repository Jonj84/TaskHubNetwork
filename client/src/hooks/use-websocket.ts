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
    try {
      // Use the current window location to construct the WebSocket URL
      const currentLocation = window.location;
      const wsProtocol = currentLocation.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${currentLocation.host}/api/ws`;

      console.log('[WebSocket] URL construction:', {
        protocol: wsProtocol,
        host: currentLocation.host,
        fullUrl: wsUrl
      });

      return wsUrl;
    } catch (error) {
      console.error('[WebSocket] URL construction error:', error);
      throw new Error('Failed to construct WebSocket URL');
    }
  }, []);

  const connect = useCallback(() => {
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        console.log('[WebSocket] Already connected');
        return;
      }

      // Clean up any existing connection
      if (wsRef.current) {
        console.log('[WebSocket] Cleaning up existing connection');
        wsRef.current.close(1000);
        wsRef.current = null;
      }

      const wsUrl = getWebSocketUrl();
      console.log('[WebSocket] Attempting connection:', {
        url: wsUrl,
        attempt: reconnectAttemptRef.current + 1
      });

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      setStatus('connecting');

      // Set up connection timeout
      const connectionTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.log('[WebSocket] Connection timeout');
          ws.close();
        }
      }, 10000);

      ws.onopen = () => {
        clearTimeout(connectionTimeout);
        console.log('[WebSocket] Connected successfully');
        setStatus('connected');
        reconnectAttemptRef.current = 0;

        // Send initial ping
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;

          if (message.type !== 'pong') {
            console.log('[WebSocket] Received message:', message.type);
          }

          switch (message.type) {
            case 'connection_established':
              console.log('[WebSocket] Connection confirmed:', message.data);
              setSessionId(message.data.sessionId);
              break;
            case 'balance_update':
              console.log('[WebSocket] Balance update:', message.data);
              break;
            case 'error':
              console.error('[WebSocket] Server error:', message.data);
              toast({
                variant: 'destructive',
                title: 'Connection Error',
                description: message.data?.message || 'Connection error occurred'
              });
              break;
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
          wasClean: event.wasClean,
          attempt: reconnectAttemptRef.current
        });

        setStatus('disconnected');
        wsRef.current = null;

        // Only attempt reconnection if it wasn't a clean close
        // and we haven't exceeded max attempts
        if (!event.wasClean && reconnectAttemptRef.current < 5) {
          const backoffTime = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 30000);
          console.log(`[WebSocket] Scheduling reconnection in ${backoffTime}ms`);

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptRef.current++;
            connect();
          }, backoffTime);
        } else if (reconnectAttemptRef.current >= 5) {
          console.log('[WebSocket] Max reconnection attempts reached');
          toast({
            variant: 'destructive',
            title: 'Connection Failed',
            description: 'Could not establish a stable connection. Please try again later.'
          });
        }
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] Connection error:', error);
        setStatus('error');
      };

    } catch (error) {
      console.error('[WebSocket] Setup error:', error);
      setStatus('error');

      // Schedule reconnection attempt
      if (reconnectAttemptRef.current < 5) {
        const backoffTime = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 30000);
        console.log(`[WebSocket] Scheduling reconnection in ${backoffTime}ms`);

        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptRef.current++;
          connect();
        }, backoffTime);
      }
    }
  }, [getWebSocketUrl, toast]);

  // Start connection on mount
  useEffect(() => {
    connect();

    // Cleanup on unmount
    return () => {
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounted');
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  // Send periodic ping to keep connection alive
  useEffect(() => {
    if (status !== 'connected') return;

    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type: 'ping' }));
        } catch (error) {
          console.error('[WebSocket] Failed to send ping:', error);
        }
      }
    }, 30000);

    return () => clearInterval(pingInterval);
  }, [status]);

  return {
    status,
    sessionId,
    send: useCallback((message: WebSocketMessage) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.warn('[WebSocket] Cannot send - connection not ready');
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
    connect // Expose connect for manual reconnection
  };
}