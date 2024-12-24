import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { setupWebSocket } from "./ws";
import { db } from "@db";
import { tasks, tokenTransactions, users, tokenPackages } from "@db/schema";
import { desc, eq } from "drizzle-orm";
import { insertTaskSchema } from "@db/schema";
import { createStripeSession, handleStripeWebhook, createCryptoPayment } from "./payments";
import express from "express";

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

export function registerRoutes(app: Express): Server {
  // First create the HTTP server
  const httpServer = createServer(app);

  // Setup WebSocket server after HTTP server is created
  const { broadcast } = setupWebSocket(httpServer);

  // Error handling middleware
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
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

  // Add the Stripe webhook endpoint
  // This needs to be before the json middleware to properly verify signatures
  app.post(
    "/api/webhooks/stripe/we_1QZXXeDP8A1L3VjbvGyrmWGf",
    express.raw({ type: "application/json" }),
    handleStripeWebhook
  );

  // Payment endpoints
  app.post("/api/payments/create-session", requireAuth, createStripeSession);
  app.post("/api/payments/crypto", requireAuth, createCryptoPayment);

  // Token purchase endpoint
  app.post("/api/tokens/purchase", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { amount } = req.body;

      if (!amount || amount < 1 || amount > 1000) {
        return res.status(400).json({ message: "Invalid token amount" });
      }

      const userId = req.user!.id;

      // Record the purchase transaction
      await db.transaction(async (tx) => {
        await tx.insert(tokenTransactions).values({
          userId,
          amount,
          type: 'purchase',
        });

        // Update user's token balance
        await tx
          .update(users)
          .set({ 
            tokenBalance: req.user!.tokenBalance + amount,
            updated_at: new Date(),
          })
          .where(eq(users.id, userId));
      });

      // Get updated user data
      const [updatedUser] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      res.json({
        message: "Tokens purchased successfully",
        newBalance: updatedUser.tokenBalance,
      });
    } catch (error: unknown) {
      const err = error as Error;
      console.error('Error purchasing tokens:', err);

      broadcast('ERROR_EVENT', {
        message: err.message || 'Failed to purchase tokens',
        type: 'error',
        source: '/api/tokens/purchase',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      });

      res.status(500).json({
        message: "Failed to purchase tokens",
      });
    }
  });

  // Token package endpoints
  app.get("/api/tokens/packages", async (_req, res: Response) => {
    try {
      const packages = await db
        .select()
        .from(tokenPackages)
        .orderBy(tokenPackages.price);

      res.json(packages);
    } catch (error: unknown) {
      const err = error as Error;
      console.error('Error fetching token packages:', err);

      broadcast('ERROR_EVENT', {
        message: err.message || 'Failed to fetch token packages',
        type: 'error',
        source: '/api/tokens/packages',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      });

      res.status(500).json({ message: "Failed to fetch token packages" });
    }
  });

  app.post("/api/tokens/packages/:id/purchase", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const packageId = parseInt(req.params.id);
      const userId = req.user!.id;

      const [tokenPackage] = await db
        .select()
        .from(tokenPackages)
        .where(eq(tokenPackages.id, packageId))
        .limit(1);

      if (!tokenPackage) {
        return res.status(404).json({ message: "Token package not found" });
      }

      // Record the purchase transaction and update balance
      await db.transaction(async (tx) => {
        // Create transaction record
        await tx.insert(tokenTransactions).values({
          userId,
          amount: tokenPackage.tokenAmount,
          type: 'purchase',
          packageId,
        });

        // Update user's token balance
        await tx
          .update(users)
          .set({
            tokenBalance: req.user!.tokenBalance + tokenPackage.tokenAmount,
            updated_at: new Date(),
          })
          .where(eq(users.id, userId));
      });

      // Get updated user data
      const [updatedUser] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      res.json({
        message: "Token package purchased successfully",
        newBalance: updatedUser.tokenBalance,
      });
    } catch (error: unknown) {
      const err = error as Error;
      console.error('Error purchasing token package:', err);

      broadcast('ERROR_EVENT', {
        message: err.message || 'Failed to purchase token package',
        type: 'error',
        source: '/api/tokens/packages/:id/purchase',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      });

      res.status(500).json({ message: "Failed to purchase token package" });
    }
  });

  // Task routes
  app.get("/api/tasks", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const allTasks = await db.query.tasks.findMany({
        orderBy: desc(tasks.created_at),
      });
      res.json(allTasks);
    } catch (error: unknown) {
      const err = error as Error;
      console.error('Error fetching tasks:', err);
      broadcast('ERROR_EVENT', {
        message: err.message || 'Failed to fetch tasks',
        type: 'error',
        source: '/api/tasks',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      });
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  // Create task endpoint
  app.post("/api/tasks", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      // Validate the request body
      const validatedData = insertTaskSchema.parse({
        ...req.body,
        creatorId: req.user!.id,
        status: "open",
      });

      // Check if user has enough tokens
      if (req.user!.tokenBalance < validatedData.reward) {
        return res.status(400).json({
          message: "Insufficient token balance to create task",
        });
      }

      // Create the task
      const [newTask] = await db
        .insert(tasks)
        .values(validatedData)
        .returning();

      // Send the created task back
      res.status(200).json(newTask);
    } catch (error: unknown) {
      const err = error as Error;
      console.error('Error creating task:', err);

      broadcast('ERROR_EVENT', {
        message: err.message || 'Failed to create task',
        type: 'error',
        source: '/api/tasks',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      });

      if ('errors' in err) {
        // Validation error
        return res.status(400).json({
          message: "Invalid task data",
          errors: err.errors,
        });
      }

      res.status(500).json({
        message: "Failed to create task",
      });
    }
  });

  return httpServer;
}