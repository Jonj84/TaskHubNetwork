import { WebSocket, WebSocketServer } from "ws";
import { type Server } from "http";

// Store active connections
const clients = new Set<WebSocket>();

// Create a broadcast function that's used across the application
function broadcast(type: string, data: any) {
  const message = JSON.stringify({ type, data });
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ 
    server,
    // Handle the Vite HMR websocket specially
    handleProtocols: (protocols: Set<string>) => {
      if (protocols.has('vite-hmr')) {
        return false; // Let Vite handle its own WebSocket
      }
      return protocols.size > 0 ? Array.from(protocols)[0] : false;
    }
  });

  wss.on("connection", (ws, req) => {
    // Skip Vite HMR connections
    if (req.headers['sec-websocket-protocol'] === 'vite-hmr') {
      return;
    }

    // Add new client to the set
    clients.add(ws);

    // Handle client disconnect
    ws.on("close", () => {
      clients.delete(ws);
    });

    // Handle client errors
    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
      clients.delete(ws);
    });

    // Send initial connection status
    ws.send(JSON.stringify({ type: 'connected' }));
  });

  return { broadcast };
}

// Export the broadcast function for use in other modules
export const ws = {
  notifyTaskUpdate: (taskId: number) => {
    broadcast('task_update', { taskId });
  },
};