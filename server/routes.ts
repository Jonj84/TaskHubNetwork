import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import express from "express";
import { createStripeSession, handleStripeWebhook, verifyStripePayment } from "./payments";

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
  // Stripe webhook endpoint - must be before body parsing middleware
  app.post(
    "/api/webhooks/stripe",
    express.raw({ type: "application/json" }),
    handleStripeWebhook
  );

  // Standard routes with JSON parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Error logging endpoint
  app.post('/api/log/error', (req: Request, res: Response) => {
    const errorLog = logError(req.body, req);
    res.status(200).json({ message: 'Error logged successfully', log: errorLog });
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

  // Global error handler
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const errorLog = logError(err, req);
    res.status(500).json({
      message: 'Internal Server Error',
      error: errorLog
    });
  });

  const httpServer = createServer(app);
  return httpServer;
}