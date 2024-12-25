import { WebSocket, WebSocketServer } from "ws";
import { type Server } from "http";
import { log } from "./vite";
import type { Request } from "express";
import { balanceTracker } from './services/balanceTracker';
import { parse } from 'cookie';
import type { Session } from 'express-session';

// WebSocket connection states
export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface ClientConnection {
  ws: WebSocket;
  userId?: string;
  lastPing: number;
  isAlive: boolean;
  connectionAttempts: number;
  sessionId?: string;
}

declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
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
    this.setupPingInterval();

    log('[WebSocket] Manager initialized');
  }

  private setupServer(server: Server) {
    server.on('upgrade', async (request: Request, socket, head) => {
      try {
        // Skip Vite HMR connections
        if (request.headers['sec-websocket-protocol'] === 'vite-hmr') {
          log('[WebSocket] Skipping Vite HMR connection');
          return;
        }

        // Only handle API websocket connections
        if (!request.url?.match(/^\/(api\/)?ws/)) {
          socket.destroy();
          return;
        }

        // Get session from cookie
        const cookieHeader = request.headers.cookie;
        if (!cookieHeader) {
          log('[WebSocket] No cookie found');
          socket.destroy();
          return;
        }

        const cookies = parse(cookieHeader);
        const sessionId = cookies['connect.sid'];
        if (!sessionId) {
          log('[WebSocket] No session ID found');
          socket.destroy();
          return;
        }

        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request, sessionId);
        });
      } catch (error) {
        log(`[WebSocket] Upgrade error: ${error instanceof Error ? error.message : String(error)}`);
        socket.destroy();
      }
    });

    this.wss.on('connection', (ws: WebSocket, request: Request, sessionId: string) => 
      this.handleConnection(ws, request, sessionId));
  }

  private async handleConnection(ws: WebSocket, request: Request, sessionId: string) {
    const connectionId = Math.random().toString(36).substring(2);
    const userId = (request as any).session?.userId;

    log(`[WebSocket] New connection: ${connectionId}${userId ? ` for user ${userId}` : ''}`);

    this.connections.set(connectionId, {
      ws,
      userId,
      sessionId,
      lastPing: Date.now(),
      isAlive: true,
      connectionAttempts: 0
    });

    ws.on('pong', () => this.handlePong(connectionId));
    ws.on('message', (data) => this.handleMessage(connectionId, data));
    ws.on('close', () => this.handleClose(connectionId));
    ws.on('error', (error) => this.handleError(connectionId, error));

    // Send initial connection success message
    this.sendMessage(ws, {
      type: 'connected',
      data: { message: 'Connected successfully' }
    });

    // If authenticated, send initial balance
    if (userId) {
      await this.sendInitialBalance(ws, userId);
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
      log(`[WebSocket] Failed to send initial balance: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private sendMessage(ws: WebSocket, message: any) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    } catch (error) {
      log(`[WebSocket] Send message error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private handlePong(connectionId: string) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.isAlive = true;
      connection.lastPing = Date.now();
    }
  }

  private async handleMessage(connectionId: string, data: any) {
    try {
      const connection = this.connections.get(connectionId);
      if (!connection) return;

      const message = JSON.parse(data.toString());
      log(`[WebSocket] Received message: ${message.type} from ${connectionId}`);

      switch (message.type) {
        case 'subscribe_balance':
          if (connection.userId) {
            await this.sendInitialBalance(connection.ws, connection.userId);
          }
          break;

        case 'ping':
          this.sendMessage(connection.ws, { type: 'pong' });
          break;

        default:
          log(`[WebSocket] Unknown message type: ${message.type}`);
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

  private handleError(connectionId: string, error: Error) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      log(`[WebSocket] Connection error for ${connectionId}: ${error.message}`);
      connection.connectionAttempts++;

      if (connection.connectionAttempts >= WebSocketManager.MAX_RECONNECT_ATTEMPTS) {
        log(`[WebSocket] Max reconnection attempts reached for ${connectionId}`);
        this.connections.delete(connectionId);
      }
    }
  }

  private setupPingInterval() {
    this.pingInterval = setInterval(() => {
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
          this.handleError(id, error as Error);
        }
      });
    }, WebSocketManager.PING_INTERVAL);
  }

  public broadcastToUser(userId: string, type: string, data: any) {
    let sent = false;
    this.connections.forEach(connection => {
      if (connection.userId === userId && connection.ws.readyState === WebSocket.OPEN) {
        try {
          this.sendMessage(connection.ws, { type, data });
          sent = true;
        } catch (error) {
          log(`[WebSocket] Broadcast error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });
    if (!sent) {
      log(`[WebSocket] No active connections found for user ${userId}`);
    }
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

export function setupWebSocket(server: Server): WebSocketServer {
  if (!wsManager) {
    wsManager = new WebSocketManager(server);
  }
  return wsManager.wss;
}

export function broadcastToUser(userId: string, type: string, data: any) {
  wsManager?.broadcastToUser(userId, type, data);
}