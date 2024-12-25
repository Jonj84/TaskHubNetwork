import type { Express, Request, Response, NextFunction } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { createStripeSession, handleStripeWebhook, verifyStripePayment } from "./payments";
import { db } from "@db";
import { tokenTransactions, tokenProcessingQueue, users, tokens } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { blockchainService } from './blockchain';

// Pricing tiers configuration
const PRICING_TIERS = {
  standard: {
    name: 'Standard',
    minTokens: 1,
    maxTokens: 499,
    pricePerToken: 1.00,
    discount: 0
  },
  plus: {
    name: 'Plus',
    minTokens: 500,
    maxTokens: 999,
    pricePerToken: 0.90, // 10% discount
    discount: 10
  },
  premium: {
    name: 'Premium',
    minTokens: 1000,
    maxTokens: 10000,
    pricePerToken: 0.80, // 20% discount
    discount: 20
  }
};

// Calculate price with volume discounts based on tiers
function calculatePrice(amount: number) {
  let tier = 'standard';

  if (amount >= PRICING_TIERS.premium.minTokens) {
    tier = 'premium';
  } else if (amount >= PRICING_TIERS.plus.minTokens) {
    tier = 'plus';
  }

  const selectedTier = PRICING_TIERS[tier as keyof typeof PRICING_TIERS];
  const basePrice = amount;
  const finalPrice = amount * selectedTier.pricePerToken;

  return {
    basePrice,
    discount: selectedTier.discount,
    finalPrice: Math.round(finalPrice * 100) / 100,
    tier: selectedTier.name.toLowerCase()
  };
}

// Auth request type
interface AuthRequest extends Request {
  user?: {
    id: number;
    username: string;
    tokenBalance: number;
  };
}

// Error logging interface
interface ErrorLog {
  message: string;
  timestamp: string;
  userId?: number;
  path: string;
  method: string;
  stack?: string;
  componentStack?: string;
}

// Error logging function
function logError(error: any, req: Request): ErrorLog {
  const errorLog: ErrorLog = {
    timestamp: new Date().toISOString(),
    userId: (req as AuthRequest).user?.id,
    path: req.path,
    method: req.method,
    message: error.message || 'Unknown error',
    stack: error.stack,
    componentStack: error.componentStack,
  };

  console.error('Application Error:', JSON.stringify(errorLog, null, 2));
  return errorLog;
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

  // Token processing endpoint - this should be called periodically
  app.post("/api/tokens/process-queue", async (req: Request, res: Response) => {
    try {
      const pendingTokens = await db
        .select()
        .from(tokenProcessingQueue)
        .where(
          and(
            eq(tokenProcessingQueue.status, 'pending'),
            eq(tokenProcessingQueue.retryCount, 0)
          )
        )
        .limit(10);

      console.log('Processing pending tokens:', pendingTokens.length);

      for (const queueItem of pendingTokens) {
        try {
          await db
            .update(tokenProcessingQueue)
            .set({
              status: 'processing',
              updated_at: new Date()
            })
            .where(eq(tokenProcessingQueue.id, queueItem.id));

          const [user] = await db
            .select()
            .from(users)
            .where(eq(users.id, queueItem.userId))
            .limit(1);

          if (!user) {
            throw new Error('User not found');
          }

          // Create blockchain transaction which will generate tokens with metadata
          const blockchainTx = await blockchainService.createTransaction(
            'SYSTEM',
            user.username,
            queueItem.amount,
            {
              paymentId: queueItem.paymentId,
              price: queueItem.metadata?.price
            }
          );

          // Update user's token balance based on actual token count
          const tokenCount = await db.query.tokens.count({
            where: (tokens, { eq }) => eq(tokens.owner, user.username)
          });

          const [updatedUser] = await db
            .update(users)
            .set({
              tokenBalance: tokenCount,
              updated_at: new Date()
            })
            .where(eq(users.id, user.id))
            .returning();

          // Record the transaction with blockchain data
          await db
            .insert(tokenTransactions)
            .values({
              userId: queueItem.userId,
              amount: queueItem.amount,
              type: 'purchase',
              status: 'completed',
              paymentId: queueItem.paymentId,
              fromAddress: 'SYSTEM',
              toAddress: user.username,
              blockHash: blockchainTx.blockHash,
              tokenIds: blockchainTx.tokenIds,
              metadata: {
                ...queueItem.metadata,
                blockchainTransaction: blockchainTx
              },
              timestamp: new Date()
            });

          // Mark queue item as completed
          await db
            .update(tokenProcessingQueue)
            .set({
              status: 'completed',
              updated_at: new Date()
            })
            .where(eq(tokenProcessingQueue.id, queueItem.id));

          console.log('Successfully processed token generation:', {
            queueId: queueItem.id,
            userId: user.id,
            amount: queueItem.amount,
            blockchainTx,
            newBalance: updatedUser.tokenBalance
          });
        } catch (error: any) {
          console.error('Failed to process token generation:', {
            queueId: queueItem.id,
            error: error.message
          });

          await db
            .update(tokenProcessingQueue)
            .set({
              status: 'failed',
              error: error.message,
              retryCount: queueItem.retryCount + 1,
              updated_at: new Date()
            })
            .where(eq(tokenProcessingQueue.id, queueItem.id));
        }
      }

      res.json({
        processed: pendingTokens.length,
        status: 'completed'
      });
    } catch (error: any) {
      console.error('Token processing error:', error);
      res.status(500).json({
        message: 'Failed to process token queue',
        error: error.message
      });
    }
  });

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

  app.get('/api/blockchain/balance/:address', (req: Request, res: Response) => {
    try {
      const { address } = req.params;
      const balance = blockchainService.getBalance(address);
      res.json({ balance });
    } catch (error: any) {
      res.status(500).json({
        message: 'Failed to fetch balance',
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
      console.error('Failed to fetch token history:', error);
      res.status(500).json({
        message: 'Failed to fetch transaction history',
        error: error.message
      });
    }
  });

  // Price calculation endpoint
  app.post('/api/tokens/calculate-price', (req: Request, res: Response) => {
    try {
      const { amount } = req.body;

      if (!amount || isNaN(amount) || amount < 1 || amount > 10000) {
        return res.status(400).json({
          message: 'Invalid amount. Must be between 1 and 10,000',
          code: 'INVALID_AMOUNT'
        });
      }

      const priceInfo = calculatePrice(amount);
      res.json(priceInfo);
    } catch (error: any) {
      const errorLog = logError(error, req);
      res.status(500).json({
        message: 'Failed to calculate price',
        error: errorLog
      });
    }
  });

  // Token purchase endpoint
  app.post("/api/tokens/purchase", async (req, res) => {
    try {
      await createStripeSession(req, res);
    } catch (error: any) {
      const errorLog = logError(error, req);
      console.error('Token purchase error:', errorLog);
      return res.status(500).json({
        message: error.message || 'Failed to create payment session',
        error: errorLog
      });
    }
  });

  // Payment verification endpoint
  app.get("/api/tokens/verify-payment", async (req, res) => {
    try {
      const sessionId = req.query.session_id as string;
      if (!sessionId) {
        return res.status(400).json({ message: 'Session ID is required' });
      }

      await verifyStripePayment(sessionId, res);
    } catch (error: any) {
      const errorLog = logError(error, req);
      console.error('Payment verification error:', errorLog);
      return res.status(500).json({
        message: error.message || 'Failed to verify payment',
        error: errorLog
      });
    }
  });

  // Error logging endpoint
  app.post('/api/log/error', (req: Request, res: Response) => {
    const errorLog = logError(req.body, req);
    res.status(200).json({ message: 'Error logged successfully', log: errorLog });
  });

  // Global error handler
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const errorLog = logError(err, req);
    res.status(500).json({
      message: 'Internal Server Error',
      error: errorLog
    });
  });

  const httpServer = createServer(app);

  // Set up periodic token processing
  setInterval(async () => {
    try {
      await fetch('http://localhost:5000/api/tokens/process-queue', {
        method: 'POST',
      });
    } catch (error) {
      console.error('Failed to process token queue:', error);
    }
  }, 30000); // Check every 30 seconds

  return httpServer;
}