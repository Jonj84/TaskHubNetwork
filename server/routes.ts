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

// Error logging interface
interface ClientError {
  message: string;
  stack?: string;
  componentStack?: string;
  location?: string;
  timestamp: string;
}

// Middleware to ensure user is authenticated
const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Authentication required" });
  }
  next();
};

function logError(error: any, req: Request) {
  const timestamp = new Date().toISOString();
  const userId = (req as AuthRequest).user?.id;
  const errorLog = {
    timestamp,
    userId,
    path: req.path,
    method: req.method,
    error: error.message || 'Unknown error',
    stack: error.stack,
    componentStack: error.componentStack,
    userAgent: req.headers['user-agent'],
  };

  console.error('Application Error:', JSON.stringify(errorLog, null, 2));
  return errorLog;
}

export function registerRoutes(app: Express): Server {
  // First create the HTTP server
  const httpServer = createServer(app);

  // Setup WebSocket server
  const { broadcast } = setupWebSocket(httpServer);

  // Error logging endpoint
  app.post('/api/log/error', express.json(), (req: Request, res: Response) => {
    const clientError: ClientError = req.body;
    const errorLog = logError(clientError, req);

    // Broadcast error to connected clients (useful for admin dashboards)
    broadcast('ERROR_EVENT', {
      type: 'client_error',
      ...errorLog
    });

    res.status(200).json({ message: 'Error logged successfully' });
  });

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

  // Enhanced error handling middleware
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const errorLog = logError(err, req);

    // Broadcast error to all connected clients
    broadcast('ERROR_EVENT', {
      ...errorLog,
      type: 'server_error',
    });

    res.status(500).json({
      message: err.message || 'Internal Server Error',
    });
  });

  return httpServer;
}

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