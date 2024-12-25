import { WebSocket, WebSocketServer } from "ws";
import { type Server } from "http";
import { log } from "./vite";

// Store active connections with metadata
const clients = new Map<WebSocket, {
  lastPing: number;
  subscriptions: Set<string>;
}>();

// Create a broadcast function that's used across the application
export function broadcast(type: string, data: any, filter?: (client: WebSocket) => boolean) {
  const message = JSON.stringify({ type, data });
  for (const [client, metadata] of clients.entries()) {
    if (client.readyState === WebSocket.OPEN && (!filter || filter(client))) {
      try {
        client.send(message);
      } catch (error) {
        console.error('[WebSocket] Failed to send message:', error);
        cleanupClient(client);
      }
    }
  }
}

function cleanupClient(ws: WebSocket) {
  const metadata = clients.get(ws);
  if (metadata) {
    // Clear any subscriptions or resources
    metadata.subscriptions.clear();
    clients.delete(ws);
  }
}

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  // Handle upgrade manually to filter out Vite HMR
  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url || '', `http://${request.headers.host}`);
    const protocol = request.headers['sec-websocket-protocol'];

    // Skip non-websocket upgrades
    if (!protocol) {
      socket.end();
      return;
    }

    // Let Vite handle its own WebSocket connections
    if (protocol === 'vite-hmr') {
      return;
    }

    // Only handle WebSocket connections to our API endpoints
    if (!pathname.startsWith('/api/')) {
      socket.end();
      return;
    }

    log(`[WebSocket] Handling upgrade for: ${pathname}`);
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on("connection", (ws, request) => {
    const { pathname } = new URL(request.url || '', `http://${request.headers.host}`);

    // Initialize client metadata
    clients.set(ws, {
      lastPing: Date.now(),
      subscriptions: new Set([pathname])
    });

    log('[WebSocket] New client connected to:', pathname);

    // Keep connection alive with ping/pong
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const metadata = clients.get(ws);
        if (metadata) {
          // Check if client hasn't responded for too long
          if (Date.now() - metadata.lastPing > 45000) {
            log('[WebSocket] Client unresponsive, closing connection');
            cleanupClient(ws);
            ws.terminate();
            return;
          }
          ws.ping();
          metadata.lastPing = Date.now();
        }
      }
    }, 30000);

    // Handle client messages
    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        log('[WebSocket] Message received:', {
          type: message.type,
          pathname,
          timestamp: new Date().toISOString()
        });

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

    // Handle pong messages to track connection health
    ws.on("pong", () => {
      const metadata = clients.get(ws);
      if (metadata) {
        metadata.lastPing = Date.now();
      }
    });

    // Handle client disconnect
    ws.on("close", () => {
      log('[WebSocket] Client disconnected from:', pathname);
      cleanupClient(ws);
      clearInterval(pingInterval);
    });

    // Handle client errors
    ws.on("error", (error) => {
      console.error("[WebSocket] Client error:", error);
      cleanupClient(ws);
      clearInterval(pingInterval);
      ws.terminate();
    });

    // Send initial connection success message
    try {
      ws.send(JSON.stringify({ 
        type: 'connected', 
        data: { 
          message: 'Connected successfully',
          endpoint: pathname,
          timestamp: new Date().toISOString()
        } 
      }));
    } catch (error) {
      console.error('[WebSocket] Failed to send connection message:', error);
    }
  });

  return { broadcast };
}