import { WebSocket, WebSocketServer } from "ws";
import { type Server } from "http";
import { log } from "./vite";

// Store active connections with metadata
const clients = new Map<WebSocket, {
  lastPing: number;
  subscriptions: Set<string>;
  isAlive: boolean;
}>();

// Create a broadcast function that's used across the application
export function broadcast(type: string, data: any, filter?: (client: WebSocket) => boolean) {
  const message = JSON.stringify({ type, data });
  clients.forEach((metadata, client) => {
    if (client.readyState === WebSocket.OPEN && metadata.isAlive && (!filter || filter(client))) {
      try {
        client.send(message);
      } catch (error) {
        console.error('[WebSocket] Failed to send message:', error);
        cleanupClient(client);
      }
    }
  });
}

function cleanupClient(ws: WebSocket) {
  const metadata = clients.get(ws);
  if (metadata) {
    metadata.subscriptions.clear();
    clients.delete(ws);
  }
}

function heartbeat(this: WebSocket) {
  const metadata = clients.get(this);
  if (metadata) {
    metadata.isAlive = true;
    metadata.lastPing = Date.now();
  }
}

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  // Handle upgrade manually to filter out Vite HMR
  server.on('upgrade', (request, socket, head) => {
    try {
      const { pathname } = new URL(request.url || '', `http://${request.headers.host}`);
      const protocol = request.headers['sec-websocket-protocol'];

      // Skip non-websocket upgrades
      if (!protocol) {
        socket.destroy();
        return;
      }

      // Let Vite handle its own WebSocket connections
      if (protocol === 'vite-hmr') {
        return;
      }

      // Only handle WebSocket connections to our API endpoints
      if (!pathname.startsWith('/api/')) {
        socket.destroy();
        return;
      }

      log(`[WebSocket] Handling upgrade for: ${pathname}`);
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } catch (error) {
      console.error('[WebSocket] Upgrade error:', error);
      socket.destroy();
    }
  });

  // Set up periodic checks for connection health
  const interval = setInterval(() => {
    clients.forEach((metadata, ws) => {
      if (!metadata.isAlive) {
        log('[WebSocket] Terminating inactive connection');
        cleanupClient(ws);
        ws.terminate();
        return;
      }
      metadata.isAlive = false;
      try {
        ws.ping();
      } catch (error) {
        console.error('[WebSocket] Failed to send ping:', error);
        cleanupClient(ws);
        ws.terminate();
      }
    });
  }, 30000);

  wss.on("connection", (ws, request) => {
    try {
      const { pathname } = new URL(request.url || '', `http://${request.headers.host}`);

      // Initialize client metadata
      clients.set(ws, {
        lastPing: Date.now(),
        subscriptions: new Set([pathname]),
        isAlive: true
      });

      log('[WebSocket] New client connected to:', pathname);

      ws.on('ping', heartbeat);
      ws.on('pong', heartbeat);

      // Handle client messages
      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString());

          // Handle ping messages from client
          if (message.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
            heartbeat.call(ws);
            return;
          }

          log('[WebSocket] Message received:', JSON.stringify({
            type: message.type,
            pathname,
            timestamp: new Date().toISOString()
          }));

          // Update last activity
          const metadata = clients.get(ws);
          if (metadata) {
            metadata.lastPing = Date.now();
          }

          // Broadcast to relevant subscribers only
          broadcast(message.type, message.data, (client) => {
            const clientData = clients.get(client);
            return clientData?.subscriptions.has(pathname) || false;
          });
        } catch (error) {
          console.error('[WebSocket] Error processing message:', error);
        }
      });

      // Handle client disconnect
      ws.on("close", (code, reason) => {
        log('[WebSocket] Client disconnected:', JSON.stringify({
          pathname,
          code,
          reason: reason.toString()
        }));
        cleanupClient(ws);
      });

      // Handle client errors
      ws.on("error", (error) => {
        console.error("[WebSocket] Client error:", JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          pathname,
          timestamp: new Date().toISOString()
        }));
        cleanupClient(ws);
        ws.terminate();
      });

      // Send initial connection success message
      ws.send(JSON.stringify({ 
        type: 'connected', 
        data: { 
          message: 'Connected successfully',
          endpoint: pathname,
          timestamp: new Date().toISOString()
        } 
      }));
    } catch (error) {
      console.error('[WebSocket] Connection setup error:', error);
      ws.terminate();
    }
  });

  // Clean up interval on server close
  wss.on('close', () => {
    clearInterval(interval);
  });

  return wss;
}