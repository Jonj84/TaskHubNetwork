import { WebSocket, WebSocketServer } from "ws";
import { type Server } from "http";

// Store active connections
const clients = new Set<WebSocket>();

// Create a broadcast function that's used across the application
export function broadcast(type: string, data: any) {
  const message = JSON.stringify({ type, data });
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  // Handle upgrade manually to filter out Vite HMR
  server.on('upgrade', (request, socket, head) => {
    try {
      const protocol = request.headers['sec-websocket-protocol'];
      // Skip Vite HMR connections
      if (protocol === 'vite-hmr') {
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } catch (error) {
      console.error('WebSocket upgrade error:', error);
      socket.destroy();
    }
  });

  wss.on("connection", (ws) => {
    // Add new client to the set
    clients.add(ws);

    // Keep connection alive with ping/pong
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);

    // Handle client disconnect
    ws.on("close", () => {
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

    // Send initial connection status
    ws.send(JSON.stringify({ type: 'connected' }));
  });

  return { broadcast };
}