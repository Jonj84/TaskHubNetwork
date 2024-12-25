import { WebSocket, WebSocketServer } from "ws";
import { type Server } from "http";
import { log } from "./vite";
import type { Request } from "express";
import { balanceTracker } from './services/balanceTracker';

interface ClientMetadata {
  lastPing: number;
  subscriptions: Set<string>;
  isAlive: boolean;
  state: 'connecting' | 'connected' | 'closing' | 'closed';
  userId?: string;
}

interface WebSocketOptions {
  beforeUpgrade?: (request: Request) => boolean;
}

// Store active connections with metadata
const clients = new Map<WebSocket, ClientMetadata>();

// Track upgrade requests to prevent duplicates
const pendingUpgrades = new Set<string>();

// Connection queue to prevent race conditions
const connectionQueue = new Map<string, Promise<void>>();

// Active balance subscriptions
const balanceSubscriptions = new Map<string, Set<WebSocket>>();

function heartbeat(this: WebSocket) {
  const metadata = clients.get(this);
  if (metadata) {
    metadata.isAlive = true;
    metadata.lastPing = Date.now();
    log('[WebSocket] Heartbeat received');
  }
}

async function cleanupClient(ws: WebSocket) {
  try {
    const metadata = clients.get(ws);
    if (metadata) {
      metadata.state = 'closing';

      // Remove from balance subscriptions
      if (metadata.userId) {
        const subscribers = balanceSubscriptions.get(metadata.userId);
        if (subscribers) {
          subscribers.delete(ws);
          if (subscribers.size === 0) {
            balanceSubscriptions.delete(metadata.userId);
          }
        }
      }

      metadata.subscriptions.clear();
      clients.delete(ws);
      metadata.state = 'closed';
    }

    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000, 'Server cleanup');
    }
  } catch (error) {
    log(`[WebSocket] Cleanup error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function broadcast(type: string, data: any, filter?: (client: WebSocket) => boolean) {
  const message = JSON.stringify({ type, data });
  let successCount = 0;
  let failCount = 0;

  clients.forEach((metadata, client) => {
    if (client.readyState === WebSocket.OPEN && 
        metadata.isAlive && 
        metadata.state === 'connected' &&
        (!filter || filter(client))) {
      try {
        client.send(message);
        successCount++;
      } catch (error) {
        log(`[WebSocket] Failed to send message: ${error instanceof Error ? error.message : String(error)}`);
        cleanupClient(client);
        failCount++;
      }
    }
  });

  log(`[WebSocket] Broadcast complete: ${successCount} successful, ${failCount} failed`);
}

// Notify balance updates to subscribed clients
export async function notifyBalanceUpdate(userId: string, newBalance: number) {
  const subscribers = balanceSubscriptions.get(userId);
  if (!subscribers) return;

  const message = JSON.stringify({
    type: 'balance_update',
    data: { userId, balance: newBalance }
  });

  for (const client of subscribers) {
    try {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    } catch (error) {
      log(`[WebSocket] Failed to send balance update: ${error instanceof Error ? error.message : String(error)}`);
      cleanupClient(client);
    }
  }
}

export function setupWebSocket(server: Server, options: WebSocketOptions = {}): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (request, socket, head) => {
    if (!request.url) {
      log('[WebSocket] Missing URL in upgrade request');
      socket.destroy();
      return;
    }

    try {
      const requestId = `${request.headers['sec-websocket-key']}-${Date.now()}`;

      if (pendingUpgrades.has(requestId)) {
        log('[WebSocket] Duplicate upgrade request detected');
        return;
      }

      if (!request.url.startsWith('/api/')) {
        log('[WebSocket] Non-API upgrade request, ignoring');
        return;
      }

      if (request.headers['sec-websocket-protocol'] === 'vite-hmr') {
        log('[WebSocket] Vite HMR request, skipping');
        return;
      }

      if (options.beforeUpgrade && !options.beforeUpgrade(request as Request)) {
        log('[WebSocket] Rate limit exceeded, rejecting connection');
        socket.destroy();
        return;
      }

      const queueKey = `${request.socket.remoteAddress}-${request.url}`;
      if (connectionQueue.has(queueKey)) {
        log('[WebSocket] Connection already in progress, queuing');
        await connectionQueue.get(queueKey);
        return;
      }

      const connectionPromise = new Promise<void>((resolve) => {
        pendingUpgrades.add(requestId);

        wss.handleUpgrade(request, socket, head, (ws) => {
          pendingUpgrades.delete(requestId);
          connectionQueue.delete(queueKey);
          wss.emit('connection', ws, request);
          resolve();
        });
      });

      connectionQueue.set(queueKey, connectionPromise);
      await connectionPromise;

    } catch (error) {
      log(`[WebSocket] Upgrade error: ${error instanceof Error ? error.message : String(error)}`);
      if (!socket.destroyed) {
        socket.destroy();
      }
    }
  });

  const interval = setInterval(() => {
    const now = Date.now();
    clients.forEach((metadata, ws) => {
      if (now - metadata.lastPing > 60000) {
        pendingUpgrades.clear();
      }

      if (!metadata.isAlive || metadata.state !== 'connected') {
        log('[WebSocket] Terminating inactive connection');
        cleanupClient(ws);
        return;
      }

      metadata.isAlive = false;
      try {
        ws.ping();
      } catch (error) {
        log(`[WebSocket] Ping failed: ${error instanceof Error ? error.message : String(error)}`);
        cleanupClient(ws);
      }
    });
  }, 30000);

  wss.on('connection', (ws, request) => {
    try {
      const pathname = request.url || '/api/unknown';
      const userId = (request as any).session?.userId;

      clients.set(ws, {
        lastPing: Date.now(),
        subscriptions: new Set([pathname]),
        isAlive: true,
        state: 'connecting',
        userId
      });

      log(`[WebSocket] New client connected to: ${pathname}`);

      // Set up heartbeat
      ws.on('ping', heartbeat);
      ws.on('pong', heartbeat);

      // Handle messages
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          const metadata = clients.get(ws);

          if (!metadata) return;

          // Handle ping messages
          if (message.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
            heartbeat.call(ws);
            return;
          }

          // Handle balance subscription
          if (message.type === 'subscribe_balance' && metadata.userId) {
            let subscribers = balanceSubscriptions.get(metadata.userId);
            if (!subscribers) {
              subscribers = new Set();
              balanceSubscriptions.set(metadata.userId, subscribers);
            }
            subscribers.add(ws);

            // Send initial balance
            try {
              const balance = await balanceTracker.getBalance(metadata.userId);
              ws.send(JSON.stringify({
                type: 'balance_update',
                data: { userId: metadata.userId, balance }
              }));
            } catch (error) {
              log(`[WebSocket] Failed to fetch initial balance: ${error instanceof Error ? error.message : String(error)}`);
            }
          }

          metadata.lastPing = Date.now();
          metadata.state = 'connected';

          // Broadcast to subscribers
          broadcast(message.type, message.data, (client) => {
            const clientData = clients.get(client);
            return clientData?.subscriptions.has(pathname) || false;
          });

        } catch (error) {
          log(`[WebSocket] Message processing error: ${error instanceof Error ? error.message : String(error)}`);
        }
      });

      ws.on('close', () => {
        log(`[WebSocket] Client disconnected from ${pathname}`);
        cleanupClient(ws);
      });

      ws.on('error', (error) => {
        log(`[WebSocket] Client error: ${error instanceof Error ? error.message : String(error)}`);
        cleanupClient(ws);
      });

      // Mark as fully connected
      const metadata = clients.get(ws);
      if (metadata) {
        metadata.state = 'connected';
      }

      // Send connection confirmation
      ws.send(JSON.stringify({
        type: 'connected',
        data: {
          message: 'Connected successfully',
          endpoint: pathname,
          timestamp: new Date().toISOString()
        }
      }));

    } catch (error) {
      log(`[WebSocket] Connection setup error: ${error instanceof Error ? error.message : String(error)}`);
      cleanupClient(ws);
    }
  });

  wss.on('close', () => {
    clearInterval(interval);
    pendingUpgrades.clear();
    connectionQueue.clear();
    balanceSubscriptions.clear();
    clients.clear();
  });

  return wss;
}