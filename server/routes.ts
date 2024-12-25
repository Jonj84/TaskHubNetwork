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
import { createStripeSession, handleStripeWebhook, verifyStripePayment } from './payments';

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

  // Set up WebSocket server
  setupWebSocket(httpServer);

  // Token and Payment Routes
  app.post('/api/tokens/calculate-price', (req: AuthRequest, res: Response) => {
    try {
      const { amount } = req.body;

      if (!amount || isNaN(amount) || amount < 1 || amount > 10000) {
        return res.status(400).json({
          message: 'Token amount must be between 1 and 10,000',
          code: 'INVALID_AMOUNT'
        });
      }

      // Calculate price based on amount
      let bonusPercentage = 0;
      let tier = 'standard';

      if (amount >= 1000) {
        bonusPercentage = 20;
        tier = 'premium';
      } else if (amount >= 500) {
        bonusPercentage = 10;
        tier = 'plus';
      }

      const basePrice = amount * 1.00; // $1 per token
      const bonusTokens = Math.floor(amount * (bonusPercentage / 100));

      const pricing = {
        basePrice: Math.round(basePrice * 100) / 100,
        bonusTokens,
        bonusPercentage,
        finalPrice: Math.round(basePrice * 100) / 100,
        tier,
        pricePerToken: 1.00
      };

      console.log('[API] Price calculation:', {
        amount,
        pricing,
        timestamp: new Date().toISOString()
      });

      res.json({ pricing });
    } catch (error: any) {
      console.error('[API] Price calculation error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      res.status(500).json({
        message: error.message || 'Failed to calculate price',
        code: 'CALCULATION_ERROR'
      });
    }
  });

  app.post('/api/tokens/purchase', (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    createStripeSession(req, res);
  });

  app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), handleStripeWebhook);

  app.get('/api/payment/verify/:sessionId', async (req: Request, res: Response) => {
    try {
      await verifyStripePayment(req.params.sessionId, res);
    } catch (error: any) {
      console.error('[API] Payment verification error:', {
        sessionId: req.params.sessionId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      res.status(500).json({
        message: error.message || 'Failed to verify payment',
        code: 'VERIFICATION_ERROR'
      });
    }
  });

  // Blockchain Routes
  app.get('/api/blockchain/transactions', (req: Request, res: Response) => {
    try {
      const transactions = blockchainService.getAllTransactions();
      res.json(transactions);
    } catch (error: any) {
      console.error('[API] Transaction fetch error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
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
      console.error('[API] Pending transaction fetch error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
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

  return httpServer;
}