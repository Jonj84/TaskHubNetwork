import type { Server } from "http";
import type { Request } from "express";
import { WebSocketServer, WebSocket } from 'ws';
import { log } from "./vite";

export async function createWebSocketServer(server: Server) {
  try {
    log('[WebSocket] Creating server...');

    const wss = new WebSocketServer({ 
      noServer: true,
      clientTracking: true
    });

    server.on('upgrade', (request: Request, socket: any, head: Buffer) => {
      try {
        // Skip Vite HMR connections
        if (request.headers['sec-websocket-protocol']?.includes('vite-hmr')) {
          log('[WebSocket] Skipping Vite HMR connection');
          socket.destroy();
          return;
        }

        // Parse URL path
        const urlPath = new URL(request.url || '', `http://${request.headers.host}`).pathname;
        if (urlPath !== '/api/ws') {
          log('[WebSocket] Invalid path:', urlPath);
          socket.destroy();
          return;
        }

        log('[WebSocket] Handling upgrade request');
        wss.handleUpgrade(request, socket, head, (ws) => {
          log('[WebSocket] Client connected');
          handleConnection(ws);
        });
      } catch (error) {
        log(`[WebSocket] Upgrade error: ${error instanceof Error ? error.message : String(error)}`);
        socket.destroy();
      }
    });

    return wss;
  } catch (error) {
    log(`[WebSocket] Server creation failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

function handleConnection(ws: WebSocket) {
  // Send connection confirmation
  send(ws, { type: 'connection_established' });

  // Set up ping interval
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 30000);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      log(`[WebSocket] Message received: ${message.type}`);

      switch (message.type) {
        case 'ping':
          send(ws, { type: 'pong' });
          break;
        default:
          log(`[WebSocket] Unknown message type: ${message.type}`);
      }
    } catch (error) {
      log(`[WebSocket] Message handling error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  ws.on('close', () => {
    log('[WebSocket] Client disconnected');
    clearInterval(pingInterval);
  });

  ws.on('error', (error) => {
    log(`[WebSocket] Client error: ${error instanceof Error ? error.message : String(error)}`);
  });
}

function send(ws: WebSocket, message: any) {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      log(`[WebSocket] Send error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}