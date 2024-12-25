import { useState, useEffect, useCallback } from 'react';
import { createWebSocketService, type WebSocketStatus } from '@/lib/websocket/WebSocketService';

export function useWebSocket(url: string) {
  const [status, setStatus] = useState<WebSocketStatus>('disconnected');
  const [service] = useState(() => 
    createWebSocketService({
      url,
      onStatusChange: (newStatus) => {
        console.log('[WebSocket] Status changed:', newStatus);
        setStatus(newStatus);
      },
      onMessage: (data) => {
        console.log('[WebSocket] Received message:', data);
        // Handle incoming messages here
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