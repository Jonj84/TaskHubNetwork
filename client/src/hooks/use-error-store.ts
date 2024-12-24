import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { useEffect } from 'react';

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
  useEffect(() => {
    // Determine the WebSocket protocol based on the page protocol
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/errors`);

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
    };

    // Cleanup on unmount
    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, []); // Empty dependency array means this effect runs once on mount
}