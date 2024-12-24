import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { setupWebSocket } from "./ws";
import { db } from "@db";
import { tasks, tokenTransactions, users } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import express from "express";
import { setupAuth } from "./auth";
import { insertTaskSchema } from "@db/schema";

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

  // Setup auth first
  setupAuth(app);

  // Setup WebSocket server after HTTP server is created
  const { broadcast } = setupWebSocket(httpServer);

  // Standard routes with JSON parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

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
      res.status(500).json({
        message: "Failed to purchase tokens",
      });
    }
  });

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

  // Task routes
  app.get("/api/tasks", requireAuth, async (_req: AuthRequest, res: Response) => {
    try {
      const allTasks = await db.query.tasks.findMany({
        orderBy: desc(tasks.created_at),
      });
      res.json(allTasks);
    } catch (error: unknown) {
      const err = error as Error;
      console.error('Error fetching tasks:', err);
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


  return httpServer;
}