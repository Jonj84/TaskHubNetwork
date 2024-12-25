import { WebSocket, WebSocketServer } from "ws";
import { type Server } from "http";
import { log } from "./vite";

// Store active connections
const clients = new Set<WebSocket>();

// Create a broadcast function that's used across the application
export function broadcast(type: string, data: any) {
  const message = JSON.stringify({ type, data });
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (error) {
        console.error('[WebSocket] Failed to send message:', error);
        // Remove failed client from set
        clients.delete(client);
      }
    }
  });
}

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  // Handle upgrade manually to filter out Vite HMR
  server.on('upgrade', (request, socket, head) => {
    const protocol = request.headers['sec-websocket-protocol'];
    const isViteHMR = protocol === 'vite-hmr';
    const path = request.url;

    // Skip non-websocket upgrades
    if (!protocol) {
      log('Non-WebSocket upgrade request, ignoring');
      socket.end();
      return;
    }

    // Let Vite handle its own WebSocket connections
    if (isViteHMR) {
      log('Vite HMR WebSocket connection, bypassing');
      return;
    }

    // Only handle WebSocket connections to our API endpoints
    if (!path?.startsWith('/api/')) {
      log('Invalid WebSocket path:', path);
      socket.end();
      return;
    }

    log('Handling WebSocket upgrade for:', path);
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on("connection", (ws) => {
    // Add new client to the set
    clients.add(ws);
    log('New WebSocket client connected');

    // Keep connection alive with ping/pong
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);

    // Handle client messages
    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        log('WebSocket message received:', message);
        broadcast(message.type, message.data);
      } catch (error) {
        console.error('Error processing message:', error);
      }
    });

    // Handle client disconnect
    ws.on("close", () => {
      log('WebSocket client disconnected');
      clients.delete(ws);
      clearInterval(pingInterval);
    });

    // Handle client errors
    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
      clients.delete(ws);
      clearInterval(pingInterval);
      ws.terminate();
    });

    // Send initial connection success message
    try {
      ws.send(JSON.stringify({ type: 'connected', data: { message: 'Connected successfully' } }));
    } catch (error) {
      console.error('Failed to send connection success message:', error);
    }
  });

  return { broadcast };
}