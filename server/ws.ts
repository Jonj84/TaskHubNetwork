import { WebSocket, WebSocketServer } from "ws";
import { type Server } from "http";
import { log } from "./vite";
import type { Request } from "express";
import { balanceTracker } from './services/balanceTracker';

// WebSocket connection states
export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface ClientConnection {
  ws: WebSocket;
  userId?: string;
  lastPing: number;
  isAlive: boolean;
  connectionAttempts: number;
}

class WebSocketManager {
  private wss: WebSocketServer;
  private connections: Map<string, ClientConnection> = new Map();
  private pingInterval: NodeJS.Timeout;
  private static readonly MAX_RECONNECT_ATTEMPTS = 5;
  private static readonly PING_INTERVAL = 30000; // 30 seconds

  constructor(server: Server) {
    this.wss = new WebSocketServer({ noServer: true });
    this.setupServer(server);
    // Initialize ping interval directly
    this.pingInterval = setInterval(() => this.checkConnections(), WebSocketManager.PING_INTERVAL);
    log('[WebSocket] Manager initialized');
  }

  private setupServer(server: Server) {
    server.on('upgrade', async (request: Request, socket, head) => {
      try {
        // Skip Vite HMR connections
        if (request.headers['sec-websocket-protocol'] === 'vite-hmr') {
          return;
        }

        // Only handle API websocket connections
        if (!request.url?.startsWith('/api/ws')) {
          socket.destroy();
          return;
        }

        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      } catch (error) {
        log(`[WebSocket] Upgrade error: ${error instanceof Error ? error.message : String(error)}`);
        socket.destroy();
      }
    });

    this.wss.on('connection', (ws: WebSocket, request: Request) => 
      this.handleConnection(ws, request));
  }

  private async handleConnection(ws: WebSocket, request: Request) {
    const connectionId = Math.random().toString(36).substring(2);
    const userId = (request as any).session?.userId;

    log(`[WebSocket] New connection: ${connectionId}${userId ? ` for user ${userId}` : ''}`);

    this.connections.set(connectionId, {
      ws,
      userId,
      lastPing: Date.now(),
      isAlive: true,
      connectionAttempts: 0
    });

    ws.on('pong', () => this.handlePong(connectionId));
    ws.on('message', (data) => this.handleMessage(connectionId, data));
    ws.on('close', () => this.handleClose(connectionId));
    ws.on('error', (error) => {
      log(`[WebSocket] Error for connection ${connectionId}: ${error.message}`);
    });

    // If authenticated, send initial balance
    if (userId) {
      this.sendInitialBalance(ws, userId).catch(error => {
        log(`[WebSocket] Failed to send initial balance: ${error.message}`);
      });
    }
  }

  private async sendInitialBalance(ws: WebSocket, userId: string) {
    try {
      const balance = await balanceTracker.getBalance(userId);
      this.sendMessage(ws, {
        type: 'balance_update',
        data: { balance }
      });
    } catch (error) {
      log(`[WebSocket] Balance fetch error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private sendMessage(ws: WebSocket, message: any) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        log(`[WebSocket] Send message error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private handlePong(connectionId: string) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.isAlive = true;
      connection.lastPing = Date.now();
    }
  }

  private handleMessage(connectionId: string, data: any) {
    try {
      const connection = this.connections.get(connectionId);
      if (!connection) return;

      const message = JSON.parse(data.toString());
      log(`[WebSocket] Received message: ${message.type} from ${connectionId}`);

      switch (message.type) {
        case 'subscribe_balance':
          if (connection.userId) {
            this.sendInitialBalance(connection.ws, connection.userId);
          }
          break;

        case 'ping':
          this.sendMessage(connection.ws, { type: 'pong' });
          break;
      }
    } catch (error) {
      log(`[WebSocket] Message handling error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private handleClose(connectionId: string) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      log(`[WebSocket] Connection closed: ${connectionId}`);
      this.connections.delete(connectionId);
    }
  }

  private checkConnections() {
    this.connections.forEach((connection, id) => {
      if (!connection.isAlive) {
        log(`[WebSocket] Connection ${id} not responding to ping`);
        this.handleClose(id);
        return;
      }

      connection.isAlive = false;
      try {
        connection.ws.ping();
      } catch (error) {
        log(`[WebSocket] Ping failed for ${id}: ${error instanceof Error ? error.message : String(error)}`);
        this.handleClose(id);
      }
    });
  }

  public broadcastToUser(userId: string, type: string, data: any) {
    this.connections.forEach(connection => {
      if (connection.userId === userId && connection.ws.readyState === WebSocket.OPEN) {
        try {
          this.sendMessage(connection.ws, { type, data });
        } catch (error) {
          log(`[WebSocket] Broadcast error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });
  }

  public cleanup() {
    clearInterval(this.pingInterval);
    this.connections.forEach((connection) => {
      try {
        connection.ws.close();
      } catch (error) {
        log(`[WebSocket] Cleanup error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    this.connections.clear();
  }
}

let wsManager: WebSocketManager | null = null;

export function setupWebSocket(server: Server) {
  if (!wsManager) {
    wsManager = new WebSocketManager(server);
  }
  return wsManager.wss;
}

export function broadcastToUser(userId: string, type: string, data: any) {
  wsManager?.broadcastToUser(userId, type, data);
}