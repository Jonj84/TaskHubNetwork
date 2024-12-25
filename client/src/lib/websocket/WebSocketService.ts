import { toast } from '@/hooks/use-toast';

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

type WebSocketOptions = {
  url: string;
  onMessage?: (data: any) => void;
  onStatusChange?: (status: WebSocketStatus) => void;
  reconnectAttempts?: number;
  initialBackoff?: number;
  maxBackoff?: number;
};

class WebSocketService {
  private ws: WebSocket | null = null;
  private status: WebSocketStatus = 'disconnected';
  private reconnectAttempt = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private options: WebSocketOptions;
  private isManualDisconnect = false;

  constructor(options: WebSocketOptions) {
    this.options = {
      reconnectAttempts: 5,
      initialBackoff: 1000,
      maxBackoff: 30000,
      ...options
    };
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] Already connected');
      return;
    }

    if (this.isManualDisconnect) {
      console.log('[WebSocket] Manual disconnect active, skipping reconnect');
      return;
    }

    this.updateStatus('connecting');

    try {
      // Determine protocol based on current page protocol
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}${this.options.url}`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[WebSocket] Connected successfully');
        this.reconnectAttempt = 0;
        this.updateStatus('connected');
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.options.onMessage?.(data);
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };

      this.ws.onclose = (event) => {
        console.log('[WebSocket] Connection closed', event.code, event.reason);
        this.updateStatus('disconnected');
        if (!this.isManualDisconnect) {
          this.attemptReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WebSocket] Connection error:', error);
        this.updateStatus('error');

        // Only show error toast on first error occurrence
        if (this.reconnectAttempt === 0) {
          toast({
            variant: 'destructive',
            title: 'Connection Error',
            description: 'WebSocket connection failed. Attempting to reconnect...'
          });
        }
      };

    } catch (error) {
      console.error('[WebSocket] Failed to create connection:', error);
      this.updateStatus('error');
      this.attemptReconnect();
    }
  }

  private updateStatus(newStatus: WebSocketStatus) {
    if (this.status === newStatus) return;

    this.status = newStatus;
    this.options.onStatusChange?.(newStatus);

    // Show toast notifications only for important status changes
    if (this.reconnectAttempt === 0) {
      switch (newStatus) {
        case 'connected':
          toast({
            title: 'Connected',
            description: 'Real-time updates are now active',
          });
          break;
      }
    }
  }

  private attemptReconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    if (this.reconnectAttempt >= (this.options.reconnectAttempts || 5)) {
      console.log('[WebSocket] Max reconnection attempts reached');
      toast({
        variant: 'destructive',
        title: 'Connection Failed',
        description: 'Could not establish a stable connection. Please try reconnecting manually.',
      });
      return;
    }

    const backoff = Math.min(
      (this.options.initialBackoff || 1000) * Math.pow(2, this.reconnectAttempt),
      this.options.maxBackoff || 30000
    );

    console.log(`[WebSocket] Attempting reconnect in ${backoff}ms (attempt ${this.reconnectAttempt + 1})`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempt++;
      this.connect();
    }, backoff);
  }

  disconnect() {
    this.isManualDisconnect = true;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.updateStatus('disconnected');
  }

  getStatus(): WebSocketStatus {
    return this.status;
  }

  // Manual reconnect for one-click recovery
  manualReconnect() {
    console.log('[WebSocket] Manual reconnection requested');
    this.isManualDisconnect = false;
    this.reconnectAttempt = 0;
    this.disconnect();
    this.connect();
  }
}

export const createWebSocketService = (options: WebSocketOptions) => {
  return new WebSocketService(options);
};