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
}

class WebSocketManager {
  private wss: WebSocketServer;
  private connections: Map<string, ClientConnection> = new Map();
  private pingInterval: NodeJS.Timeout;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ noServer: true });
    this.setupServer(server);
    this.setupPingInterval();
  }

  private setupServer(server: Server) {
    server.on('upgrade', (request, socket, head) => {
      if (!request.url?.startsWith('/api/') || 
          request.headers['sec-websocket-protocol'] === 'vite-hmr') {
        return;
      }

      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });

    this.wss.on('connection', this.handleConnection.bind(this));
  }

  private handleConnection(ws: WebSocket, request: Request) {
    const connectionId = Math.random().toString(36).substring(2);
    const userId = (request as any).session?.userId;

    this.connections.set(connectionId, {
      ws,
      userId,
      lastPing: Date.now(),
      isAlive: true
    });

    log(`[WebSocket] New connection: ${connectionId}`);

    ws.on('pong', () => this.handlePong(connectionId));
    ws.on('message', (data) => this.handleMessage(connectionId, data));
    ws.on('close', () => this.handleClose(connectionId));
    ws.on('error', (error) => this.handleError(connectionId, error));

    // Send initial connection success message
    ws.send(JSON.stringify({ 
      type: 'connected',
      data: { message: 'Connected successfully' }
    }));
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

      switch (message.type) {
        case 'subscribe_balance':
          if (connection.userId) {
            const balance = await balanceTracker.getBalance(connection.userId);
            connection.ws.send(JSON.stringify({
              type: 'balance_update',
              data: { balance }
            }));
          }
          break;

        case 'ping':
          connection.ws.send(JSON.stringify({ type: 'pong' }));
          break;
      }
    } catch (error) {
      log(`[WebSocket] Message handling error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private handleClose(connectionId: string) {
    this.connections.delete(connectionId);
    log(`[WebSocket] Connection closed: ${connectionId}`);
  }

  private handleError(connectionId: string, error: Error) {
    log(`[WebSocket] Connection error: ${connectionId} - ${error.message}`);
    this.connections.delete(connectionId);
  }

  private setupPingInterval() {
    this.pingInterval = setInterval(() => {
      this.connections.forEach((connection, id) => {
        if (!connection.isAlive) {
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
    }, 30000);
  }

  public broadcastToUser(userId: string, type: string, data: any) {
    this.connections.forEach(connection => {
      if (connection.userId === userId && connection.ws.readyState === WebSocket.OPEN) {
        try {
          connection.ws.send(JSON.stringify({ type, data }));
        } catch (error) {
          log(`[WebSocket] Broadcast error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });
  }

  public cleanup() {
    clearInterval(this.pingInterval);
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