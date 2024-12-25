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
  try {
    console.log('[Server] Starting route registration');

    // Create HTTP server
    const httpServer = createServer(app);

    // Set up core middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));

    // Set up authentication
    setupAuth(app);

    // Set up WebSocket server with error handling
    try {
      console.log('[Server] Initializing WebSocket server');
      setupWebSocket(httpServer);
      console.log('[Server] WebSocket server initialized successfully');
    } catch (error) {
      console.error('[Server] WebSocket initialization error:', error);
      // Continue server startup even if WebSocket fails
    }

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

        // Set proper content type
        res.setHeader('Content-Type', 'application/json');

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

        // Set proper content type and return neutral response
        res.setHeader('Content-Type', 'application/json');
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

        const balance = await blockchainService.getBalance(address);
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

    // Final error handler - needs to be after all routes
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      console.error('[API] Unhandled Error:', err);

      // Return neutral response for payment-related errors
      if (err.message?.toLowerCase().includes('payment') || _req.path.includes('/payment/')) {
        return res.json({
          success: false,
          message: 'Processing payment',
          code: 'PAYMENT_IN_PROGRESS'
        });
      }

      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      res.status(status).json({ message });
    });

    console.log('[Server] Route registration completed successfully');
    return httpServer;
  } catch (error) {
    console.error('[Server] Fatal error during route registration:', error);
    throw error;
  }
}