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
  sessionId: string;
}

let wsServer: WebSocketServer | null = null;
let wsManager: WebSocketManager | null = null;

class WebSocketManager {
  private connections: Map<string, ClientConnection> = new Map();
  private pingInterval: NodeJS.Timeout;
  private static readonly PING_INTERVAL = 30000; // 30 seconds

  constructor(server: Server) {
    try {
      log('[WebSocket] Initializing WebSocket server');
      wsServer = new WebSocketServer({ 
        noServer: true,
        clientTracking: true
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
    server.on('upgrade', (request: Request, socket, head) => {
      try {
        // Skip Vite HMR connections
        if (request.headers['sec-websocket-protocol']?.includes('vite-hmr')) {
          log('[WebSocket] Skipping Vite HMR connection');
          return;
        }

        // Only handle API websocket connections
        if (!request.url?.startsWith('/api/ws')) {
          log('[WebSocket] Invalid WebSocket path:', request.url);
          socket.destroy();
          return;
        }

        // Extract session data if available
        const userId = (request as any).session?.passport?.user?.id;
        log(`[WebSocket] Upgrade request from user: ${userId || 'anonymous'}`);

        if (!wsServer) {
          throw new Error('WebSocket server not initialized');
        }

        wsServer.handleUpgrade(request, socket, head, (ws) => {
          // Store userId in request for connection handler
          (request as any).userId = userId;
          wsServer?.emit('connection', ws, request);
        });
      } catch (error) {
        log(`[WebSocket] Upgrade error: ${error instanceof Error ? error.message : String(error)}`);
        socket.destroy();
      }
    });

    if (!wsServer) {
      throw new Error('WebSocket server not initialized');
    }

    wsServer.on('connection', (ws: WebSocket, request: Request) => {
      this.handleConnection(ws, request).catch(error => {
        log(`[WebSocket] Connection handler error: ${error.message}`);
      });
    });
  }

  private async handleConnection(ws: WebSocket, request: Request) {
    const sessionId = Math.random().toString(36).substring(2);
    const userId = (request as any).userId;

    log(`[WebSocket] New connection: ${sessionId}${userId ? ` for user ${userId}` : ''}`);

    const connection: ClientConnection = {
      ws,
      userId,
      lastPing: Date.now(),
      isAlive: true,
      connectionAttempts: 0,
      sessionId
    };

    this.connections.set(sessionId, connection);

    ws.on('pong', () => this.handlePong(sessionId));
    ws.on('message', (data) => this.handleMessage(sessionId, data));
    ws.on('close', (code, reason) => {
      log(`[WebSocket] Connection closed: ${sessionId}, Code: ${code}, Reason: ${reason}`);
      this.handleClose(sessionId);
    });
    ws.on('error', (error) => {
      log(`[WebSocket] Error for connection ${sessionId}: ${error.message}`);
      if (!ws.destroyed) {
        ws.close(1006, 'Connection error');
      }
    });

    // Send initial balance for authenticated users
    if (userId) {
      try {
        const balance = await balanceTracker.getBalance(userId);
        log(`[WebSocket] Sending initial balance to user ${userId}: ${balance}`);
        this.sendMessage(ws, {
          type: 'balance_update',
          data: { balance, initial: true }
        });
      } catch (error) {
        log(`[WebSocket] Initial balance fetch error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private handlePong(sessionId: string) {
    const connection = this.connections.get(sessionId);
    if (connection) {
      connection.isAlive = true;
      connection.lastPing = Date.now();
    }
  }

  private handleMessage(sessionId: string, data: any) {
    try {
      const connection = this.connections.get(sessionId);
      if (!connection) {
        log(`[WebSocket] Message received for unknown connection: ${sessionId}`);
        return;
      }

      const message = JSON.parse(data.toString());

      if (message.type !== 'ping') {
        log(`[WebSocket] Received message: ${message.type} from ${sessionId}`);
      }

      switch (message.type) {
        case 'subscribe_balance':
          if (connection.userId) {
            balanceTracker.getBalance(connection.userId)
              .then(balance => {
                this.sendMessage(connection.ws, {
                  type: 'balance_update',
                  data: { balance, subscribed: true }
                });
              })
              .catch(error => {
                log(`[WebSocket] Balance subscription error: ${error.message}`);
                this.sendMessage(connection.ws, {
                  type: 'error',
                  data: { message: 'Failed to fetch balance' }
                });
              });
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

  private sendMessage(ws: WebSocket, message: any) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        log(`[WebSocket] Send message error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private handleClose(sessionId: string) {
    const connection = this.connections.get(sessionId);
    if (connection) {
      this.connections.delete(sessionId);
    }
  }

  private checkConnections() {
    this.connections.forEach((connection, id) => {
      if (!connection.isAlive) {
        log(`[WebSocket] Connection ${id} not responding to ping, terminating`);
        if (!connection.ws.destroyed) {
          connection.ws.terminate();
        }
        this.handleClose(id);
        return;
      }

      connection.isAlive = false;
      try {
        connection.ws.ping();
      } catch (error) {
        log(`[WebSocket] Ping failed for ${id}: ${error instanceof Error ? error.message : String(error)}`);
        if (!connection.ws.destroyed) {
          connection.ws.terminate();
        }
        this.handleClose(id);
      }
    });
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

  public cleanup() {
    clearInterval(this.pingInterval);
    this.connections.forEach((connection) => {
      try {
        if (!connection.ws.destroyed) {
          connection.ws.close(1000, 'Server shutdown');
        }
      } catch (error) {
        log(`[WebSocket] Cleanup error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    this.connections.clear();
  }
}

export function setupWebSocket(server: Server) {
  try {
    log('[WebSocket] Setting up WebSocket server');
    if (!wsManager) {
      wsManager = new WebSocketManager(server);
      log('[WebSocket] WebSocket manager created successfully');
    }
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