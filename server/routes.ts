import type { Express } from "express";
import { createServer, type Server } from "http";
import { log } from "./vite";
import { db } from "@db";
import { tasks, users } from "@db/schema";
import { eq } from "drizzle-orm";
import express from "express";
import { blockchainService } from './blockchain';
import { balanceTracker } from './services/balanceTracker';
import { createStripeSession, handleStripeWebhook, verifyStripePayment } from './payments';
import type { Request, Response, NextFunction } from "express";

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

  // Task Routes
  app.post('/api/tasks', async (req: AuthRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ 
          message: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
      }

      const { title, description, type, reward, proofRequired } = req.body;

      // Validate required fields
      if (!title || !description || !type || !reward || !proofRequired) {
        return res.status(400).json({
          message: 'Missing required fields',
          code: 'INVALID_PARAMETERS'
        });
      }

      // Validate reward amount
      if (isNaN(reward) || reward <= 0 || reward > 1000) {
        return res.status(400).json({
          message: 'Reward must be between 1 and 1000 tokens',
          code: 'INVALID_REWARD'
        });
      }

      // Check user's token balance
      if (req.user.tokenBalance < reward) {
        return res.status(400).json({
          message: 'Insufficient token balance',
          code: 'INSUFFICIENT_BALANCE'
        });
      }

      // Handle task creation and token escrow in a transaction
      const [task] = await db.transaction(async (tx) => {
        // Create escrow transaction first
        const escrowResult = await blockchainService.createTransaction(
          req.user.username,
          'ESCROW',
          reward
        );

        // Create task with escrow reference
        const [newTask] = await tx.insert(tasks).values({
          title,
          description,
          type,
          reward,
          status: 'open',
          creatorId: req.user.id,
          proofRequired,
          escrowTransactionId: escrowResult.id,
          created_at: new Date(),
          updated_at: new Date()
        }).returning();

        return newTask;
      });

      // Send JSON response
      res.status(201).json(task);
    } catch (error: any) {
      console.error('[API] Task creation failed:', error);
      res.status(500).json({
        message: error.message || 'Failed to create task',
        code: 'TASK_CREATION_ERROR'
      });
    }
  });

  app.get('/api/tasks', async (_req: Request, res) => {
    try {
      const allTasks = await db.query.tasks.findMany({
        orderBy: (tasks, { desc }) => [desc(tasks.created_at)]
      });
      res.json(allTasks);
    } catch (error: any) {
      console.error('[API] Task fetch error:', error);
      res.status(500).json({
        message: error.message || 'Failed to fetch tasks',
        code: 'TASK_FETCH_ERROR'
      });
    }
  });

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
      console.error('[API] Price calculation error:', error);
      res.status(500).json({
        message: error.message || 'Failed to calculate price',
        code: 'CALCULATION_ERROR'
      });
    }
  });

  // New Transaction Creation Endpoint
  app.post('/api/blockchain/transaction', async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ 
          message: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
      }

      const { to, amount } = req.body;
      console.log('[API] Creating transaction:', { 
        from: req.user.username,
        to, 
        amount,
        timestamp: new Date().toISOString()
      });

      if (!to || !amount) {
        return res.status(400).json({
          message: 'Missing required fields: to and amount',
          code: 'INVALID_PARAMETERS'
        });
      }

      if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({
          message: 'Amount must be a positive number',
          code: 'INVALID_AMOUNT'
        });
      }

      const transaction = await blockchainService.createTransaction(
        req.user.username,
        to,
        amount
      );

      console.log('[API] Transaction created:', {
        id: transaction.id,
        timestamp: new Date().toISOString()
      });

      res.json(transaction);
    } catch (error: any) {
      console.error('[API] Transaction creation failed:', error);
      res.status(500).json({
        message: error.message || 'Failed to create transaction',
        code: 'TRANSACTION_ERROR'
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

  app.get('/api/tokens/verify-payment', async (req: AuthRequest, res: Response) => {
    try {
      console.log('[API] Verifying payment for session:', req.query.session_id);

      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
      }

      const result = await verifyStripePayment(req.query.session_id as string);

      if (result.success) {
        // Force sync user's balance
        await balanceTracker.forceSyncBalance(req.user.username);
        res.json({
          success: true,
          message: 'Payment verified and tokens created successfully',
          transaction: result.transaction
        });
      } else {
        res.json({
          success: false,
          message: result.message || 'Payment verification pending',
          code: result.code || 'VERIFICATION_PENDING'
        });
      }
    } catch (error: any) {
      console.error('[API] Payment verification error:', error);
      res.json({
        success: false,
        message: 'Payment verification in progress',
        code: 'VERIFICATION_IN_PROGRESS'
      });
    }
  });

  // Blockchain Routes
  app.get('/api/blockchain/transactions', (req: Request, res: Response) => {
    try {
      const transactions = blockchainService.getAllTransactions();
      res.json(transactions);
    } catch (error: any) {
      console.error('[API] Transaction fetch error:', error);
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
      console.error('[API] Pending transaction fetch error:', error);
      res.status(500).json({
        message: 'Failed to fetch pending transactions',
        error: error.message
      });
    }
  });

  app.get('/api/blockchain/balance/:address', async (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      console.log('[API] Fetching balance for:', address);

      const balance = await balanceTracker.getBalance(address);
      console.log('[API] Balance result:', { address, balance });

      res.json({ balance });
    } catch (error: any) {
      console.error('[API] Balance fetch error:', error);
      res.status(500).json({
        message: 'Failed to fetch balance',
        error: error.message
      });
    }
  });

  app.get('/api/blockchain/tokens/:username', async (req: Request, res: Response) => {
    try {
      const { username } = req.params;
      console.log('[API] Fetching tokens for:', username);

      const tokens = await blockchainService.getTokens(username);
      console.log('[API] Tokens result:', { username, count: tokens.length });

      res.json(tokens);
    } catch (error: any) {
      console.error('[API] Tokens fetch error:', error);
      res.status(500).json({
        message: 'Failed to fetch tokens',
        error: error.message
      });
    }
  });

  return httpServer;
}