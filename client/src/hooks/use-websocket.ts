import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';

type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface WebSocketMessage {
  type: string;
  data?: any;
}

export function useWebSocket() {
  const [status, setStatus] = useState<WebSocketStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const { toast } = useToast();

  const getWebSocketUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/ws`;
    console.log('[WebSocket] URL:', wsUrl);
    return wsUrl;
  }, []);

  const connect = useCallback(() => {
    try {
      // Clean up any existing connection
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      const wsUrl = getWebSocketUrl();
      console.log('[WebSocket] Connecting to:', wsUrl);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      setStatus('connecting');

      ws.onopen = () => {
        console.log('[WebSocket] Connected');
        setStatus('connected');
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          console.log('[WebSocket] Message:', message.type);

          switch (message.type) {
            case 'connection_established':
              console.log('[WebSocket] Connection confirmed');
              break;
            case 'error':
              console.error('[WebSocket] Error:', message.data);
              toast({
                variant: 'destructive',
                title: 'Connection Error',
                description: message.data?.message || 'Connection error occurred'
              });
              break;
          }
        } catch (error) {
          console.error('[WebSocket] Message parse error:', error);
        }
      };

      ws.onclose = () => {
        console.log('[WebSocket] Disconnected');
        setStatus('disconnected');
        wsRef.current = null;

        // Attempt reconnection
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('[WebSocket] Attempting reconnect...');
          connect();
        }, 5000);
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        setStatus('error');
      };

    } catch (error) {
      console.error('[WebSocket] Setup error:', error);
      setStatus('error');

      // Schedule reconnection
      reconnectTimeoutRef.current = setTimeout(() => {
        console.log('[WebSocket] Attempting reconnect after error...');
        connect();
      }, 5000);
    }
  }, [getWebSocketUrl, toast]);

  const send = useCallback((message: WebSocketMessage) => {
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
  }, [toast]);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  return {
    status,
    send,
    isConnected: status === 'connected'
  };
}