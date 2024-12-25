import type { Server } from "http";
import type { Request } from "express";
import { log } from "./vite";
import { balanceTracker } from './services/balanceTracker';
import { createWebSocketServer } from "./websocket";

// WebSocket connection states
export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface ClientConnection {
  ws: any; // WebSocket instance
  userId?: string;
  lastPing: number;
  isAlive: boolean;
  connectionAttempts: number;
  sessionId: string;
}

// WebSocket message types
interface WebSocketMessage {
  type: string;
  data?: any;
}

let wsServer: any = null; // WebSocket.Server instance
let wsManager: WebSocketManager | null = null;

class WebSocketManager {
  private connections: Map<string, ClientConnection> = new Map();
  private pingInterval: NodeJS.Timeout;
  private static readonly PING_INTERVAL = 30000; // 30 seconds
  private static readonly WS_PATH = '/api/ws';

  constructor(server: Server) {
    try {
      log('[WebSocket] Initializing WebSocket server');
      this.setupServer(server);
      this.pingInterval = setInterval(() => this.checkConnections(), WebSocketManager.PING_INTERVAL);
      log('[WebSocket] Manager initialized successfully');
    } catch (error) {
      log(`[WebSocket] Initialization error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async setupServer(server: Server) {
    try {
      wsServer = await createWebSocketServer();

      server.on('upgrade', async (request: Request, socket: any, head: any) => {
        try {
          // Skip Vite HMR connections
          if (request.headers['sec-websocket-protocol']?.includes('vite-hmr')) {
            log('[WebSocket] Skipping Vite HMR connection');
            socket.destroy();
            return;
          }

          // Parse URL path
          const path = new URL(request.url || '', `http://${request.headers.host}`).pathname;

          // Only handle WebSocket API connections
          if (path !== WebSocketManager.WS_PATH) {
            log('[WebSocket] Invalid WebSocket path:', path);
            socket.destroy();
            return;
          }

          if (!wsServer) {
            throw new Error('WebSocket server not initialized');
          }

          // Extract session data if available
          const userId = (request as any).session?.passport?.user?.id;
          log(`[WebSocket] Upgrade request from user: ${userId || 'anonymous'}`);

          // Handle upgrade with proper error handling
          wsServer.handleUpgrade(request, socket, head, (ws: any) => {
            this.handleConnection(ws, userId).catch(error => {
              log(`[WebSocket] Connection handler error: ${error.message}`);
              ws.terminate();
            });
          });
        } catch (error) {
          log(`[WebSocket] Upgrade error: ${error instanceof Error ? error.message : String(error)}`);
          socket.destroy();
        }
      });
    } catch (error) {
      log(`[WebSocket] Server setup error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private async handleConnection(ws: any, userId?: string) {
    const sessionId = Math.random().toString(36).substring(2);

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

    // Set up event handlers
    ws.on('pong', () => this.handlePong(sessionId));
    ws.on('message', (data: any) => this.handleMessage(sessionId, data));
    ws.on('close', () => this.handleClose(sessionId));
    ws.on('error', (error: Error) => {
      log(`[WebSocket] Error for connection ${sessionId}: ${error.message}`);
      this.handleClose(sessionId);
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

      // Parse message data
      const message = JSON.parse(data.toString()) as WebSocketMessage;

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

  private sendMessage(ws: any, message: WebSocketMessage) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        log(`[WebSocket] Send message error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
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

  public broadcastToUser(userId: string, type: string, data: any) {
    log(`[WebSocket] Broadcasting to user ${userId}: ${type}`);
    this.connections.forEach(connection => {
      if (connection.userId === userId && connection.ws.readyState === 1) { // WebSocket.OPEN
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
        connection.ws.close(1000, 'Server shutdown');
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