import { useState, useEffect, useCallback } from 'react';
import { createWebSocketService, type WebSocketStatus } from '@/lib/websocket/WebSocketService';

export function useWebSocket(url: string) {
  const [status, setStatus] = useState<WebSocketStatus>('disconnected');
  const [service] = useState(() => 
    createWebSocketService({
      url,
      onStatusChange: setStatus,
      onMessage: (data) => {
        console.log('[WebSocket] Received message:', data);
        // Handle incoming messages here
      }
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
    reconnect
  };
}