import type { Server } from "http";
import type { Request } from "express";
import { log } from "./vite";
import { balanceTracker } from './services/balanceTracker';
import { WebSocketServer, WebSocket } from 'ws';

// WebSocket connection states
export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface ClientConnection {
  ws: WebSocket;
  userId?: string;
  lastPing: number;
  isAlive: boolean;
  connectionAttempts: number;
  sessionId: string;
}

interface WebSocketMessage {
  type: string;
  data?: any;
}

let wsServer: WebSocketServer | null = null;
let wsManager: WebSocketManager | null = null;

class WebSocketManager {
  private connections: Map<string, ClientConnection> = new Map();
  private pingInterval: NodeJS.Timeout;
  private static readonly PING_INTERVAL = 30000; // 30 seconds
  private static readonly WS_PATH = '/api/ws';

  constructor(server: Server) {
    try {
      log('[WebSocket] Initializing WebSocket server');

      wsServer = new WebSocketServer({ 
        noServer: true,
        clientTracking: true,
        perMessageDeflate: false
      });

      this.setupServer(server);
      this.pingInterval = setInterval(() => this.checkConnections(), WebSocketManager.PING_INTERVAL);
      log('[WebSocket] Manager initialized successfully');
    } catch (error) {
      log(`[WebSocket] Initialization error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private setupServer(server: Server) {
    server.on('upgrade', (request: Request, socket: any, head: Buffer) => {
      try {
        // Skip Vite HMR connections
        const protocol = request.headers['sec-websocket-protocol'];
        if (protocol && protocol.includes('vite-hmr')) {
          return;
        }

        const url = new URL(request.url || '', `http://${request.headers.host}`);
        if (url.pathname !== WebSocketManager.WS_PATH) {
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          socket.destroy();
          return;
        }

        if (!wsServer) {
          throw new Error('WebSocket server not initialized');
        }

        log(`[WebSocket] Upgrade request for ${url.pathname}`);

        // Get user ID from session if available
        const userId = (request as any).session?.passport?.user?.id;

        wsServer.handleUpgrade(request, socket, head, (ws) => {
          this.handleConnection(ws, userId);
        });
      } catch (error) {
        log(`[WebSocket] Upgrade error: ${error instanceof Error ? error.message : String(error)}`);
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
      }
    });
  }

  private handleConnection(ws: WebSocket, userId?: string) {
    const sessionId = Math.random().toString(36).substring(2);
    log(`[WebSocket] New connection: ${sessionId}${userId ? ` for user ${userId}` : ''}`);

    // Clean up existing connections for this user
    if (userId) {
      for (const [oldSessionId, connection] of this.connections.entries()) {
        if (connection.userId === userId) {
          connection.ws.close(1000, 'New connection established');
          this.connections.delete(oldSessionId);
        }
      }
    }

    const connection: ClientConnection = {
      ws,
      userId,
      lastPing: Date.now(),
      isAlive: true,
      connectionAttempts: 0,
      sessionId
    };

    this.connections.set(sessionId, connection);

    // Send initial connection confirmation
    this.sendMessage(ws, {
      type: 'connection_established',
      data: { 
        sessionId,
        timestamp: Date.now(),
        userId
      }
    });

    // Set up WebSocket event handlers
    ws.on('pong', () => {
      const conn = this.connections.get(sessionId);
      if (conn) {
        conn.isAlive = true;
        conn.lastPing = Date.now();
      }
    });

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'ping') {
          this.sendMessage(ws, { type: 'pong' });
        }
      } catch (error) {
        log(`[WebSocket] Message parsing error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    ws.on('close', () => {
      this.handleClose(sessionId);
    });

    ws.on('error', (error) => {
      log(`[WebSocket] Connection error for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
      this.handleClose(sessionId);
    });
  }

  private handleClose(sessionId: string) {
    const connection = this.connections.get(sessionId);
    if (connection) {
      log(`[WebSocket] Connection closed: ${sessionId}`);
      this.connections.delete(sessionId);
    }
  }

  private checkConnections() {
    this.connections.forEach((connection, sessionId) => {
      if (!connection.isAlive) {
        connection.ws.terminate();
        this.handleClose(sessionId);
        return;
      }
      connection.isAlive = false;
      try {
        connection.ws.ping();
      } catch (error) {
        this.handleClose(sessionId);
      }
    });
  }

  private sendMessage(ws: WebSocket, message: WebSocketMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        log(`[WebSocket] Send message error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  public broadcastToUser(userId: string, type: string, data: any) {
    this.connections.forEach(connection => {
      if (connection.userId === userId && connection.ws.readyState === WebSocket.OPEN) {
        this.sendMessage(connection.ws, { type, data });
      }
    });
  }

  public cleanup() {
    clearInterval(this.pingInterval);
    this.connections.forEach(connection => {
      try {
        connection.ws.close(1000, 'Server shutdown');
      } catch (error) {
        log(`[WebSocket] Cleanup error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    this.connections.clear();
  }
}

export function setupWebSocket(server: Server) {
  if (wsManager) {
    wsManager.cleanup();
  }
  wsManager = new WebSocketManager(server);
  return wsServer;
}

export function broadcastToUser(userId: string, type: string, data: any) {
  if (!wsManager) {
    log('[WebSocket] Cannot broadcast: WebSocket manager not initialized');
    return;
  }
  wsManager.broadcastToUser(userId, type, data);
}