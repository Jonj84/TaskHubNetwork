import { WebSocket, WebSocketServer } from "ws";
import { type Server } from "http";
import { log } from "./vite";
import type { Request } from "express";
import { balanceTracker } from './services/balanceTracker';

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface ClientMetadata {
  lastPing: number;
  subscriptions: Set<string>;
  isAlive: boolean;
  state: WebSocketStatus;
  userId?: string;
}

interface WebSocketOptions {
  beforeUpgrade?: (request: Request) => boolean;
}

// Store active connections with metadata
const clients = new Map<WebSocket, ClientMetadata>();
// Track handled upgrade requests to prevent duplicates
const handledUpgrades = new WeakSet<any>();

// Active balance subscriptions
const balanceSubscriptions = new Map<string, Set<WebSocket>>();

function heartbeat(this: WebSocket) {
  const metadata = clients.get(this);
  if (metadata) {
    metadata.isAlive = true;
    metadata.lastPing = Date.now();
  }
}

async function cleanupClient(ws: WebSocket) {
  try {
    const metadata = clients.get(ws);
    if (metadata) {
      metadata.state = 'disconnected';

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
    }

    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000, 'Server cleanup');
    }
  } catch (error) {
    log(`[WebSocket] Cleanup error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function notifyBalanceUpdate(userId: string, newBalance: number) {
  try {
    const subscribers = balanceSubscriptions.get(userId);
    if (!subscribers) {
      log(`[WebSocket] No subscribers for balance updates: ${userId}`);
      return;
    }

    const message = JSON.stringify({
      type: 'balance_update',
      data: { userId, balance: newBalance }
    });

    let successCount = 0;
    let failCount = 0;

    for (const client of subscribers) {
      try {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
          successCount++;
        } else {
          await cleanupClient(client);
          failCount++;
        }
      } catch (error) {
        log(`[WebSocket] Balance update failed: ${error instanceof Error ? error.message : String(error)}`);
        await cleanupClient(client);
        failCount++;
      }
    }

    log(`[WebSocket] Balance update broadcast: ${successCount} successful, ${failCount} failed`);
  } catch (error) {
    log(`[WebSocket] Balance notification error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function setupWebSocket(server: Server, options: WebSocketOptions = {}): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (request, socket, head) => {
    if (!request.url) {
      socket.destroy();
      return;
    }

    try {
      // Skip if we've already handled this socket
      if (handledUpgrades.has(socket)) {
        return;
      }

      // Skip non-API WebSocket upgrades
      if (!request.url.startsWith('/api/')) {
        return;
      }

      // Let Vite handle its own WebSocket connections
      if (request.headers['sec-websocket-protocol'] === 'vite-hmr') {
        return;
      }

      // Check rate limit if provided
      if (options.beforeUpgrade && !options.beforeUpgrade(request as Request)) {
        socket.destroy();
        return;
      }

      // Prevent duplicate upgrade handling
      if (socket.destroyed) {
        return;
      }

      // Mark this socket as handled
      handledUpgrades.add(socket);

      log(`[WebSocket] Handling upgrade for ${request.url}`);
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });

    } catch (error) {
      log(`[WebSocket] Upgrade error: ${error instanceof Error ? error.message : String(error)}`);
      if (!socket.destroyed) {
        socket.destroy();
      }
    }
  });

  // Heartbeat check interval
  const interval = setInterval(() => {
    clients.forEach((metadata, ws) => {
      if (!metadata.isAlive || metadata.state !== 'connected') {
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

      ws.on('ping', heartbeat);
      ws.on('pong', heartbeat);

      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          const metadata = clients.get(ws);

          if (!metadata) return;

          metadata.lastPing = Date.now();
          metadata.state = 'connected';

          if (message.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
            heartbeat.call(ws);
            return;
          }

          if (message.type === 'subscribe_balance' && metadata.userId) {
            let subscribers = balanceSubscriptions.get(metadata.userId);
            if (!subscribers) {
              subscribers = new Set();
              balanceSubscriptions.set(metadata.userId, subscribers);
            }
            subscribers.add(ws);

            try {
              const balance = await balanceTracker.getBalance(metadata.userId);
              await notifyBalanceUpdate(metadata.userId, balance); // Use the new function
            } catch (error) {
              log(`[WebSocket] Initial balance fetch failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        } catch (error) {
          log(`[WebSocket] Message processing error: ${error instanceof Error ? error.message : String(error)}`);
        }
      });

      ws.on('close', () => {
        log(`[WebSocket] Client disconnected: ${pathname}`);
        cleanupClient(ws);
      });

      ws.on('error', (error) => {
        log(`[WebSocket] Client error: ${error instanceof Error ? error.message : String(error)}`);
        cleanupClient(ws);
      });

      const metadata = clients.get(ws);
      if (metadata) {
        metadata.state = 'connected';
      }

      log(`[WebSocket] New client connected: ${pathname}`);
      ws.send(JSON.stringify({
        type: 'connected',
        data: {
          message: 'Connected successfully',
          endpoint: pathname
        }
      }));

    } catch (error) {
      log(`[WebSocket] Connection setup error: ${error instanceof Error ? error.message : String(error)}`);
      cleanupClient(ws);
    }
  });

  wss.on('close', () => {
    clearInterval(interval);
    balanceSubscriptions.clear();
    clients.clear();
  });

  return wss;
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
        log(`[WebSocket] Broadcast failed: ${error instanceof Error ? error.message : String(error)}`);
        cleanupClient(client);
        failCount++;
      }
    }
  });

  log(`[WebSocket] Broadcast complete: ${successCount} successful, ${failCount} failed`);
}