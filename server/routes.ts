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

      const { title, description, type, reward, proofType, proofRequired } = req.body;

      // Validate required fields
      if (!title || !description || !type || !reward || !proofType || !proofRequired) {
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
      const userBalance = await blockchainService.getBalance(req.user.username);
      if (userBalance < reward) {
        return res.status(400).json({
          message: 'Insufficient token balance',
          code: 'INSUFFICIENT_BALANCE'
        });
      }

      // Handle task creation and token escrow in a transaction
      const result = await db.transaction(async (tx) => {
        try {
          // Create escrow transaction first
          const escrowResult = await blockchainService.createTransaction(
            req.user!.username,
            'ESCROW',
            reward
          );

          // Create task
          const [newTask] = await tx
            .insert(tasks)
            .values({
              title,
              description,
              type,
              reward,
              status: 'open',
              creatorId: req.user!.id,
              proofType,
              proofRequired,
              escrowTransactionId: escrowResult.id,
              created_at: new Date(),
              updated_at: new Date()
            })
            .returning();

          console.log('[API] Created new task:', {
            taskId: newTask.id,
            escrowTx: escrowResult.id,
            timestamp: new Date().toISOString()
          });

          return {
            task: newTask,
            escrow: escrowResult
          };
        } catch (error) {
          console.error('[API] Transaction failed:', error);
          throw error;
        }
      });

      // Send JSON response with the created task
      res.status(201).json(result.task);
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
      console.log('[API] Fetching tasks');
      const allTasks = await db.query.tasks.findMany({
        orderBy: (tasks, { desc }) => [desc(tasks.created_at)],
        with: {
          creator: true,
          worker: true
        }
      });

      console.log('[API] Tasks fetched:', {
        count: allTasks.length,
        tasks: allTasks.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          creatorId: t.creatorId
        }))
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

  // Add task acceptance endpoint
  app.post('/api/tasks/:taskId/accept', async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          message: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
      }

      const taskId = parseInt(req.params.taskId);
      if (isNaN(taskId)) {
        return res.status(400).json({
          message: 'Invalid task ID',
          code: 'INVALID_PARAMETERS'
        });
      }

      // Get the task and verify it can be accepted
      const [task] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);

      if (!task) {
        return res.status(404).json({
          message: 'Task not found',
          code: 'TASK_NOT_FOUND'
        });
      }

      if (task.status !== 'open') {
        return res.status(400).json({
          message: 'Task is not available',
          code: 'TASK_NOT_AVAILABLE'
        });
      }

      if (task.creatorId === req.user.id) {
        return res.status(400).json({
          message: 'Cannot accept your own task',
          code: 'INVALID_OPERATION'
        });
      }

      // Update task status and assign worker
      const [updatedTask] = await db
        .update(tasks)
        .set({
          status: 'in_progress',
          workerId: req.user.id,
          updated_at: new Date()
        })
        .where(eq(tasks.id, taskId))
        .returning();

      console.log('[API] Task accepted:', {
        taskId,
        workerId: req.user.id,
        timestamp: new Date().toISOString()
      });

      res.json(updatedTask);
    } catch (error: any) {
      console.error('[API] Task acceptance failed:', error);
      res.status(500).json({
        message: error.message || 'Failed to accept task',
        code: 'TASK_ACCEPT_ERROR'
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

  // Add proof submission endpoint
  app.post('/api/tasks/:taskId/proof', async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          message: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
      }

      const taskId = parseInt(req.params.taskId);
      const { proof } = req.body;

      if (isNaN(taskId) || !proof) {
        return res.status(400).json({
          message: 'Invalid task ID or missing proof',
          code: 'INVALID_PARAMETERS'
        });
      }

      // Get the task and verify the user can submit proof
      const [task] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);

      if (!task) {
        return res.status(404).json({
          message: 'Task not found',
          code: 'TASK_NOT_FOUND'
        });
      }

      if (task.workerId !== req.user.id) {
        return res.status(403).json({
          message: 'Only the assigned worker can submit proof',
          code: 'UNAUTHORIZED'
        });
      }

      if (task.status !== 'in_progress') {
        return res.status(400).json({
          message: 'Task is not in progress',
          code: 'INVALID_STATUS'
        });
      }

      // Update task with proof and change status
      const [updatedTask] = await db
        .update(tasks)
        .set({
          status: 'pending_verification',
          proofSubmitted: proof,
          updated_at: new Date()
        })
        .where(eq(tasks.id, taskId))
        .returning();

      console.log('[API] Proof submitted:', {
        taskId,
        workerId: req.user.id,
        timestamp: new Date().toISOString()
      });

      res.json(updatedTask);
    } catch (error: any) {
      console.error('[API] Proof submission failed:', error);
      res.status(500).json({
        message: error.message || 'Failed to submit proof',
        code: 'PROOF_SUBMISSION_ERROR'
      });
    }
  });

  // Add task verification endpoint
  app.post('/api/tasks/:taskId/verify', async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          message: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
      }

      const taskId = parseInt(req.params.taskId);
      const { verified } = req.body;

      if (isNaN(taskId) || verified === undefined) {
        return res.status(400).json({
          message: 'Invalid parameters',
          code: 'INVALID_PARAMETERS'
        });
      }

      // Get the task and verify the user can verify it
      const [task] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);

      if (!task) {
        return res.status(404).json({
          message: 'Task not found',
          code: 'TASK_NOT_FOUND'
        });
      }

      if (task.creatorId !== req.user.id) {
        return res.status(403).json({
          message: 'Only the task creator can verify completion',
          code: 'UNAUTHORIZED'
        });
      }

      if (task.status !== 'pending_verification') {
        return res.status(400).json({
          message: 'Task is not pending verification',
          code: 'INVALID_STATUS'
        });
      }

      // Update task status based on verification
      const [updatedTask] = await db
        .update(tasks)
        .set({
          status: verified ? 'completed' : 'in_progress',
          proofSubmitted: verified ? task.proofSubmitted : null,
          updated_at: new Date()
        })
        .where(eq(tasks.id, taskId))
        .returning();

      // If task is completed, release escrow
      if (verified && task.escrowTransactionId) {
        await blockchainService.releaseEscrow(
          task.escrowTransactionId,
          task.workerId!.toString()
        );
      }

      console.log('[API] Task verification:', {
        taskId,
        verified,
        timestamp: new Date().toISOString()
      });

      res.json(updatedTask);
    } catch (error: any) {
      console.error('[API] Task verification failed:', error);
      res.status(500).json({
        message: error.message || 'Failed to verify task',
        code: 'VERIFICATION_ERROR'
      });
    }
  });

  return httpServer;
}