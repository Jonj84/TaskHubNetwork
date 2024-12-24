import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

interface ErrorEvent {
  id: string;
  message: string;
  timestamp: string;
  type: 'error' | 'warning';
  source: string;
  stack?: string;
}

interface ErrorStore {
  errors: ErrorEvent[];
  addError: (error: Omit<ErrorEvent, 'id' | 'timestamp'>) => void;
  clearError: (id: string) => void;
  clearAll: () => void;
}

export const useErrorStore = create<ErrorStore>((set) => ({
  errors: [],
  addError: (error) =>
    set((state) => ({
      errors: [
        {
          ...error,
          id: uuidv4(),
          timestamp: new Date().toISOString(),
        },
        ...state.errors,
      ].slice(0, 100), // Keep only last 100 errors
    })),
  clearError: (id) =>
    set((state) => ({
      errors: state.errors.filter((error) => error.id !== id),
    })),
  clearAll: () => set({ errors: [] }),
}));

// Custom hook for WebSocket connection
export function useErrorWebSocket() {
  const { toast } = useToast();

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;

    const connect = () => {
      try {
        // Determine protocol based on current page protocol
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/errors`;

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log('Error tracking WebSocket connected');
          reconnectAttempts = 0; // Reset reconnect attempts on successful connection
        };

        ws.onmessage = (event) => {
          try {
            const error = JSON.parse(event.data);
            useErrorStore.getState().addError(error);
          } catch (e) {
            console.error('Failed to parse error message:', e);
          }
        };

        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          // Only show toast on first error
          if (reconnectAttempts === 0) {
            toast({
              variant: 'destructive',
              title: 'Error Tracking Connection Failed',
              description: 'Will attempt to reconnect automatically',
            });
          }
        };

        ws.onclose = () => {
          console.log('WebSocket connection closed');
          // Attempt to reconnect if we haven't exceeded max attempts
          if (reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
            reconnectTimeout = setTimeout(connect, delay);
          }
        };
      } catch (error) {
        console.error('Failed to establish WebSocket connection:', error);
      }
    };

    connect();

    // Cleanup function
    return () => {
      if (ws) {
        ws.close();
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
    };
  }, []); // Empty dependency array means this effect runs once on mount
}