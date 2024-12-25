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
        perMessageDeflate: false // Disable compression for better stability
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
    server.on('upgrade', async (request: Request, socket: any, head: Buffer) => {
      try {
        // Skip Vite HMR connections without destroying the socket
        if (request.headers['sec-websocket-protocol']?.includes('vite-hmr')) {
          return;
        }

        // Ensure proper URL construction
        const host = request.headers.host || request.hostname || '0.0.0.0';
        const protocol = request.socket.encrypted ? 'wss' : 'ws';
        const fullUrl = `${protocol}://${host}${request.url}`;

        let urlPath: string;
        try {
          urlPath = new URL(fullUrl).pathname;
          log(`[WebSocket] Processing upgrade request for path: ${urlPath}`);
        } catch (error) {
          log(`[WebSocket] Invalid URL in upgrade request: ${fullUrl}`);
          socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
          socket.destroy();
          return;
        }

        if (urlPath !== WebSocketManager.WS_PATH) {
          log(`[WebSocket] Invalid WebSocket path: ${urlPath}`);
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          socket.destroy();
          return;
        }

        if (!wsServer) {
          throw new Error('WebSocket server not initialized');
        }

        const userId = (request as any).session?.passport?.user?.id;
        log(`[WebSocket] Upgrade request from user: ${userId || 'anonymous'}`);

        wsServer.handleUpgrade(request, socket, head, (ws) => {
          this.handleConnection(ws, userId).catch(error => {
            log(`[WebSocket] Connection handler error: ${error instanceof Error ? error.message : String(error)}`);
            if (ws.readyState === WebSocket.OPEN) {
              ws.close(1011, 'Internal Server Error');
            }
          });
        });
      } catch (error) {
        log(`[WebSocket] Upgrade error: ${error instanceof Error ? error.message : String(error)}`);
        socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        socket.destroy();
      }
    });
  }

  private async handleConnection(ws: WebSocket, userId?: string) {
    const sessionId = Math.random().toString(36).substring(2);
    log(`[WebSocket] New connection: ${sessionId}${userId ? ` for user ${userId}` : ''}`);

    // Clean up existing connections for this user
    if (userId) {
      for (const [oldSessionId, connection] of this.connections.entries()) {
        if (connection.userId === userId) {
          log(`[WebSocket] Cleaning up old connection for user: ${userId}`);
          if (connection.ws.readyState === WebSocket.OPEN) {
            connection.ws.close(1000, 'New connection established');
          }
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
        timestamp: Date.now()
      }
    });

    // Send initial balance for authenticated users
    if (userId) {
      try {
        const balance = await balanceTracker.getBalance(userId);
        this.sendMessage(ws, {
          type: 'balance_update',
          data: { balance, initial: true }
        });
      } catch (error) {
        log(`[WebSocket] Initial balance fetch error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Set up WebSocket event handlers
    ws.on('pong', () => {
      const connection = this.connections.get(sessionId);
      if (connection) {
        connection.isAlive = true;
        connection.lastPing = Date.now();
      }
    });

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const message = JSON.parse(data.toString()) as WebSocketMessage;

        if (message.type !== 'ping') {
          log(`[WebSocket] Received message: ${message.type} from ${sessionId}`);
        }

        switch (message.type) {
          case 'ping':
            this.sendMessage(ws, { type: 'pong' });
            break;
          default:
            log(`[WebSocket] Unknown message type: ${message.type}`);
        }
      } catch (error) {
        log(`[WebSocket] Message handling error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    ws.on('close', () => {
      log(`[WebSocket] Connection closed: ${sessionId}`);
      this.connections.delete(sessionId);
    });

    ws.on('error', (error) => {
      log(`[WebSocket] Error for connection ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
      this.handleClose(sessionId);
    });

    // Start ping interval for this connection
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, WebSocketManager.PING_INTERVAL);

    ws.on('close', () => clearInterval(pingInterval));
  }

  private handleClose(sessionId: string) {
    log(`[WebSocket] Connection closed: ${sessionId}`);
    this.connections.delete(sessionId);
  }

  private checkConnections() {
    this.connections.forEach((connection, id) => {
      if (!connection.isAlive) {
        log(`[WebSocket] Connection ${id} not responding to ping, terminating`);
        connection.ws.terminate();
        this.handleClose(id);
        return;
      }

      connection.isAlive = false;
      try {
        connection.ws.ping();
      } catch (error) {
        log(`[WebSocket] Ping failed for ${id}: ${error instanceof Error ? error.message : String(error)}`);
        connection.ws.terminate();
        this.handleClose(id);
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

  public cleanup() {
    clearInterval(this.pingInterval);
    this.connections.forEach(connection => {
      try {
        if (connection.ws.readyState === WebSocket.OPEN) {
          connection.ws.close(1000, 'Server shutdown');
        }
      } catch (error) {
        log(`[WebSocket] Cleanup error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    this.connections.clear();
  }

  public broadcastToUser(userId: string, type: string, data: any) {
    log(`[WebSocket] Broadcasting to user ${userId}: ${type}`);
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
}

export function setupWebSocket(server: Server) {
  try {
    if (wsManager) {
      log('[WebSocket] Cleaning up existing WebSocket manager');
      wsManager.cleanup();
    }

    log('[WebSocket] Setting up new WebSocket server');
    wsManager = new WebSocketManager(server);
    log('[WebSocket] WebSocket manager created successfully');
    return wsServer;
  } catch (error) {
    log(`[WebSocket] Setup failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

export function broadcastToUser(userId: string, type: string, data: any) {
  try {
    if (!wsManager) {
      log('[WebSocket] Cannot broadcast: WebSocket manager not initialized');
      return;
    }
    wsManager.broadcastToUser(userId, type, data);
  } catch (error) {
    log(`[WebSocket] Broadcast failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}