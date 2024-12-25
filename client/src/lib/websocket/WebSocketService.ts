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
  private pingInterval: NodeJS.Timeout | null = null;
  private connectionLock = false;

  constructor(options: WebSocketOptions) {
    this.options = {
      reconnectAttempts: 5,
      initialBackoff: 1000,
      maxBackoff: 30000,
      ...options
    };
  }

  async connect() {
    // Prevent multiple simultaneous connection attempts
    if (this.connectionLock) {
      console.log('[WebSocket] Connection attempt already in progress');
      return;
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] Already connected');
      return;
    }

    if (this.isManualDisconnect) {
      console.log('[WebSocket] Manual disconnect active, skipping reconnect');
      return;
    }

    try {
      this.connectionLock = true;
      this.updateStatus('connecting');
      this.clearTimeouts();

      // Determine protocol based on current page protocol
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}${this.options.url}`;

      console.log('[WebSocket] Attempting connection to:', wsUrl);

      // Create new WebSocket instance
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

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
        this.setupPingInterval();
        this.reconnectAttempt = 0;
        this.updateStatus('connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'pong') {
            console.log('[WebSocket] Received pong');
            return;
          }
          this.options.onMessage?.(data);
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };

      ws.onclose = (event) => {
        clearTimeout(connectionTimeout);
        console.log('[WebSocket] Connection closed:', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
          timestamp: new Date().toISOString()
        });

        this.clearPingInterval();
        this.updateStatus('disconnected');

        // Don't attempt to reconnect if this was a manual disconnect
        // or if the connection was closed cleanly
        if (!this.isManualDisconnect && !event.wasClean) {
          this.attemptReconnect();
        }
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] Connection error:', {
          error,
          attempt: this.reconnectAttempt,
          timestamp: new Date().toISOString()
        });
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
      console.error('[WebSocket] Failed to create connection:', {
        error,
        attempt: this.reconnectAttempt,
        timestamp: new Date().toISOString()
      });
      this.updateStatus('error');
      this.attemptReconnect();
    } finally {
      this.connectionLock = false;
    }
  }

  private setupPingInterval() {
    this.clearPingInterval();
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
          console.log('[WebSocket] Ping sent');
        } catch (error) {
          console.error('[WebSocket] Failed to send ping:', error);
        }
      }
    }, 30000); // Send ping every 30 seconds
  }

  private clearPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
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

  private clearTimeouts() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private attemptReconnect() {
    this.clearTimeouts();

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
    this.clearTimeouts();
    this.clearPingInterval();

    if (this.ws) {
      this.ws.close(1000, 'Manual disconnect');
      this.ws = null;
    }

    this.updateStatus('disconnected');
  }

  getStatus(): WebSocketStatus {
    return this.status;
  }

  // Manual reconnect for one-click recovery
  async manualReconnect() {
    console.log('[WebSocket] Manual reconnection requested');
    this.isManualDisconnect = false;
    this.reconnectAttempt = 0;
    this.disconnect();
    await this.connect();
  }
}

export const createWebSocketService = (options: WebSocketOptions) => {
  return new WebSocketService(options);
};