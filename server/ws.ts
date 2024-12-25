import { WebSocket, WebSocketServer } from "ws";
import { type Server } from "http";
import { log } from "./vite";
import type { Request } from "express";

interface ClientMetadata {
  lastPing: number;
  subscriptions: Set<string>;
  isAlive: boolean;
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

function heartbeat(this: WebSocket) {
  const metadata = clients.get(this);
  if (metadata) {
    metadata.isAlive = true;
    metadata.lastPing = Date.now();
  }
}

function cleanupClient(ws: WebSocket) {
  try {
    const metadata = clients.get(ws);
    if (metadata) {
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

export function broadcast(type: string, data: any, filter?: (client: WebSocket) => boolean) {
  const message = JSON.stringify({ type, data });
  let successCount = 0;
  let failCount = 0;

  clients.forEach((metadata, client) => {
    if (client.readyState === WebSocket.OPEN && metadata.isAlive && (!filter || filter(client))) {
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

export function setupWebSocket(server: Server, options: WebSocketOptions = {}): WebSocketServer {
  // Create WebSocket server
  const wss = new WebSocketServer({ noServer: true });

  // Handle upgrades
  server.on('upgrade', async (request, socket, head) => {
    if (!request.url) {
      log('[WebSocket] Missing URL in upgrade request');
      socket.destroy();
      return;
    }

    try {
      // Generate unique identifier for this upgrade request
      const requestId = `${request.headers['sec-websocket-key']}-${Date.now()}`;

      // Skip if we're already handling this upgrade
      if (pendingUpgrades.has(requestId)) {
        log('[WebSocket] Duplicate upgrade request detected');
        return;
      }

      // Skip non-API WebSocket upgrades
      if (!request.url.startsWith('/api/')) {
        log('[WebSocket] Non-API upgrade request, ignoring');
        return;
      }

      // Let Vite handle its own WebSocket connections
      if (request.headers['sec-websocket-protocol'] === 'vite-hmr') {
        log('[WebSocket] Vite HMR request, skipping');
        return;
      }

      // Check rate limit if beforeUpgrade is provided
      if (options.beforeUpgrade && !options.beforeUpgrade(request as Request)) {
        log('[WebSocket] Rate limit exceeded, rejecting connection');
        socket.destroy();
        return;
      }

      // Queue the connection request
      const queueKey = `${request.socket.remoteAddress}-${request.url}`;
      if (connectionQueue.has(queueKey)) {
        log('[WebSocket] Connection already in progress, queuing');
        await connectionQueue.get(queueKey);
        return;
      }

      const connectionPromise = new Promise<void>((resolve) => {
        log(`[WebSocket] Handling upgrade for: ${request.url}`);
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

  // Set up connection monitoring
  const interval = setInterval(() => {
    const now = Date.now();
    clients.forEach((metadata, ws) => {
      // Clean up stale pending upgrades
      if (now - metadata.lastPing > 60000) {
        pendingUpgrades.clear();
      }

      if (!metadata.isAlive) {
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

  // Handle new connections
  wss.on('connection', (ws, request) => {
    try {
      const pathname = request.url || '/api/unknown';

      // Initialize client metadata
      clients.set(ws, {
        lastPing: Date.now(),
        subscriptions: new Set([pathname]),
        isAlive: true
      });

      log(`[WebSocket] New client connected to: ${pathname}`);

      // Set up heartbeat
      ws.on('ping', heartbeat);
      ws.on('pong', heartbeat);

      // Handle messages
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());

          // Handle ping messages
          if (message.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
            heartbeat.call(ws);
            return;
          }

          // Update last activity
          const metadata = clients.get(ws);
          if (metadata) {
            metadata.lastPing = Date.now();
          }

          // Broadcast to subscribers
          broadcast(message.type, message.data, (client) => {
            const clientData = clients.get(client);
            return clientData?.subscriptions.has(pathname) || false;
          });
        } catch (error) {
          log(`[WebSocket] Message processing error: ${error instanceof Error ? error.message : String(error)}`);
        }
      });

      // Handle disconnection
      ws.on('close', () => {
        log(`[WebSocket] Client disconnected from ${pathname}`);
        cleanupClient(ws);
      });

      // Handle errors
      ws.on('error', (error) => {
        log(`[WebSocket] Client error: ${error instanceof Error ? error.message : String(error)}`);
        cleanupClient(ws);
      });

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

  // Clean up on server close
  wss.on('close', () => {
    clearInterval(interval);
    pendingUpgrades.clear();
    clients.clear();
  });

  return wss;
}