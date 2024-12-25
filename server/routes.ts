import type { Express, Request, Response, NextFunction } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { db } from "@db";
import { tokenTransactions } from "@db/schema";
import { eq } from "drizzle-orm";
import { blockchainService } from './blockchain';
import { balanceTracker } from './services/balanceTracker';
import { setupWebSocket } from './ws';

// Auth request type
interface AuthRequest extends Request {
  user?: {
    id: number;
    username: string;
    tokenBalance: number;
    created_at: Date;
    updated_at: Date;
  };
}

export function registerRoutes(app: Express): Server {
  // Create HTTP server
  const httpServer = createServer(app);

  // Global error handler - needs to be first
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[API] Error:', {
      message: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    });
    res.status(500).json({ message: err.message || 'Internal Server Error' });
  });

  // Set up core middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Set up authentication
  setupAuth(app);

  // API Routes
  app.get('/api/blockchain/transactions', (req: Request, res: Response) => {
    try {
      const transactions = blockchainService.getAllTransactions();
      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({
        message: 'Failed to fetch transactions',
        error: error.message
      });
    }
  });

  app.get('/api/blockchain/pending', (req: Request, res: Response) => {
    try {
      const transactions = blockchainService.getPendingTransactions();
      res.json(transactions);
    } catch (error: any) {
      res.status(500).json({
        message: 'Failed to fetch pending transactions',
        error: error.message
      });
    }
  });

  // Final error handler - needs to be after all routes
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[API] Unhandled Error:', {
      message: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    });

    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
  });

  // Set up WebSocket server last
  setupWebSocket(httpServer);

  return httpServer;
}