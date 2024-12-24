import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { db } from "@db";
import { tokenTransactions, users } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import express from "express";
import { setupAuth } from "./auth";
import { createStripeSession, handleStripeWebhook, createCryptoPayment } from "./payments";
import { setupWebSocket } from "./ws";

// Extend Express Request type to include authenticated user
interface AuthRequest extends Request {
  user?: {
    id: number;
    username: string;
    tokenBalance: number;
  };
}

// Middleware to ensure user is authenticated
const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Authentication required" });
  }
  next();
};

function calculateTokenPrice(amount: number): {
  basePrice: number;
  discount: number;
  finalPrice: number;
} {
  const basePrice = amount; // $1 per token
  let discount = 0;

  if (amount >= 1000) {
    discount = 20; // 20% discount
  } else if (amount >= 500) {
    discount = 10; // 10% discount
  }

  const finalPrice = basePrice * (1 - discount / 100);

  return {
    basePrice,
    discount,
    finalPrice,
  };
}

export function registerRoutes(app: Express): Server {
  // First create the HTTP server
  const httpServer = createServer(app);

  // Setup WebSocket server
  const { broadcast } = setupWebSocket(httpServer);

  // Stripe webhook endpoint - must be before body parsing middleware
  app.post(
    "/api/webhooks/stripe",
    express.raw({ type: "application/json" }),
    handleStripeWebhook
  );

  // Standard routes with JSON parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Setup auth after body parsing middleware
  setupAuth(app);

  // Price calculation endpoint
  app.post("/api/tokens/calculate-price", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { amount } = req.body;

      if (!amount || isNaN(amount) || amount < 1 || amount > 10000) {
        return res.status(400).json({
          message: "Token amount must be between 1 and 10,000"
        });
      }

      const pricing = calculateTokenPrice(amount);
      res.json(pricing);
    } catch (error: any) {
      console.error('Price calculation error:', error);
      res.status(500).json({ 
        message: error.message || 'Failed to calculate price' 
      });
    }
  });

  // Token purchase endpoints
  app.post("/api/tokens/purchase", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const result = await createStripeSession(req, res);
      // Broadcast successful session creation
      broadcast('PAYMENT_EVENT', {
        type: 'SESSION_CREATED',
        userId: req.user?.id,
        amount: req.body.amount
      });
      return result;
    } catch (error: any) {
      console.error('Token purchase error:', error);
      return res.status(500).json({ 
        message: error.message || 'Failed to create payment session'
      });
    }
  });

  // Crypto payment endpoint
  app.post("/api/tokens/purchase/crypto", requireAuth, createCryptoPayment);

  // Transaction history endpoint
  app.get("/api/tokens/history", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const transactions = await db
        .select()
        .from(tokenTransactions)
        .where(eq(tokenTransactions.userId, userId))
        .orderBy(desc(tokenTransactions.timestamp));

      res.json(transactions);
    } catch (error: unknown) {
      const err = error as Error;
      console.error('Error fetching token history:', err);
      res.status(500).json({ message: "Failed to fetch token history" });
    }
  });

  // Error handling middleware
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    console.error('Error:', err);

    // Broadcast error to all connected clients
    broadcast('ERROR_EVENT', {
      message: err.message,
      type: 'error',
      source: req.path,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });

    res.status(500).json({
      message: err.message || 'Internal Server Error',
    });
  });

  return httpServer;
}