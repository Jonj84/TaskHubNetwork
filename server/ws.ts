import { WebSocket, WebSocketServer } from "ws";
import { type Server } from "http";
import { blockchainService } from "../client/src/lib/blockchain/BlockchainService";

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
    blockchainService.addPeer(ws);

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

        switch (message.type) {
          case 'NEW_TRANSACTION':
            // Broadcast new transaction to all peers
            broadcast('NEW_TRANSACTION', message.data);
            break;
          case 'CHAIN_UPDATE':
            // Broadcast chain updates to all peers
            broadcast('CHAIN_UPDATE', message.data);
            break;
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    });

    // Handle client disconnect
    ws.on("close", () => {
      clients.delete(ws);
      blockchainService.removePeer(ws);
      clearInterval(pingInterval);
    });

    // Handle client errors
    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
      clients.delete(ws);
      blockchainService.removePeer(ws);
      clearInterval(pingInterval);
      ws.terminate();
    });

    // Send initial chain state
    ws.send(JSON.stringify({ 
      type: 'CHAIN_UPDATE', 
      data: blockchainService.getAllTransactions() 
    }));
  });

  return { broadcast };
}