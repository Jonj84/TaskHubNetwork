import type { Express, Request, Response, NextFunction } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { createStripeSession, handleStripeWebhook, verifyStripePayment } from "./payments";
import { db } from "@db";
import { tokenTransactions, users } from "@db/schema";
import { eq } from "drizzle-orm";
import { blockchainService } from './blockchain';
import { balanceTracker } from './services/balanceTracker';

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
  // Set up auth routes first
  setupAuth(app);

  // Set up raw body parsing for Stripe webhook
  app.post(
    "/api/webhooks/stripe",
    express.raw({ type: "application/json" }),
    handleStripeWebhook
  );

  // Standard middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Blockchain API Routes
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

  app.post('/api/blockchain/transaction', (req: AuthRequest, res: Response) => {
    try {
      const { to, amount } = req.body;

      if (!req.user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const transaction = blockchainService.createTransaction(
        req.user.username,
        to,
        amount
      );

      res.json(transaction);
    } catch (error: any) {
      res.status(500).json({
        message: 'Failed to create transaction',
        error: error.message
      });
    }
  });

  app.get('/api/blockchain/balance/:address', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const balance = await blockchainService.getBalance(address);
      res.json({ balance });
    } catch (error: any) {
      console.error('[API] Balance fetch error:', {
        error: error.message,
        address: req.params.address
      });
      res.status(500).json({
        message: 'Failed to fetch balance',
        error: error.message
      });
    }
  });

  app.post('/api/blockchain/sync-balance', async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const updatedUser = await balanceTracker.forceSyncBalance(req.user.username);
      res.json({
        message: 'Balance synchronized successfully',
        user: updatedUser
      });
    } catch (error: any) {
      res.status(500).json({
        message: 'Failed to sync balance',
        error: error.message
      });
    }
  });

  // Token transaction history endpoint
  app.get("/api/tokens/history", async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const transactions = await db.query.tokenTransactions.findMany({
        where: eq(tokenTransactions.userId, req.user.id),
        orderBy: (tokenTransactions, { desc }) => [desc(tokenTransactions.timestamp)],
      });

      const totalSpent = transactions.reduce((sum, tx) =>
        tx.type === 'purchase' ? sum + tx.amount : sum, 0);

      const purchaseTransactions = transactions.filter(tx => tx.type === 'purchase');
      const avgPurchaseSize = purchaseTransactions.length > 0
        ? Math.round(totalSpent / purchaseTransactions.length)
        : 0;

      res.json({
        transactions,
        insights: {
          totalSpent,
          totalTransactions: purchaseTransactions.length,
          avgPurchaseSize
        }
      });
    } catch (error: any) {
      res.status(500).json({
        message: 'Failed to fetch transaction history',
        error: error.message
      });
    }
  });

  // Token purchase endpoints
  app.post("/api/tokens/purchase", async (req, res) => {
    try {
      await createStripeSession(req, res);
    } catch (error: any) {
      res.status(500).json({
        message: error.message || 'Failed to create payment session',
        error: error
      });
    }
  });

  app.get("/api/tokens/verify-payment", async (req, res) => {
    try {
      const sessionId = req.query.session_id as string;
      if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required' });
      }

      await verifyStripePayment(sessionId, res);
    } catch (error: any) {
      res.status(500).json({
        message: error.message || 'Failed to verify payment',
        error: error
      });
    }
  });


  const httpServer = createServer(app);
  return httpServer;
}