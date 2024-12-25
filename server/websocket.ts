// Dynamic import of ws package
export async function createWebSocketServer() {
  try {
    const { WebSocketServer } = await import('ws');
    return new WebSocketServer({ 
      noServer: true,
      clientTracking: true,
      perMessageDeflate: false // Disable compression for better stability
    });
  } catch (error) {
    console.error('[WebSocket] Failed to create WebSocket server:', error);
    throw error;
  }
}
