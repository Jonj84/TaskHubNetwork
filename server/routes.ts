import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { setupWebSocket } from "./ws";
import { db } from "@db";
import { tasks, tokenTransactions, users, tokenPackages } from "@db/schema";
import { desc, eq, sql, and, or } from "drizzle-orm";
import { insertTaskSchema } from "@db/schema";
import { createStripeSession, handleStripeWebhook, createCryptoPayment } from "./payments";
import express from "express";
import { validatePackageMiddleware } from './middleware/packageValidation';
import { avg, count, sum } from "drizzle-orm";
import { setupAuth } from "./auth";

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

  // Add the Stripe webhook endpoint before any body parsing middleware
  app.post(
    "/api/webhooks/stripe",
    express.raw({ type: 'application/json' }),
    handleStripeWebhook
  );

  // Standard routes with JSON parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

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
  app.post(
    "/api/tokens/packages",
    requireAuth,
    validatePackageMiddleware,
    async (req: AuthRequest, res: Response) => {
      try {
        const [newPackage] = await db
          .insert(tokenPackages)
          .values(req.body)
          .returning();

        res.json(newPackage);
      } catch (error) {
        console.error('Error creating token package:', error);
        res.status(500).json({ message: "Failed to create token package" });
      }
    }
  );

  app.put(
    "/api/tokens/packages/:id",
    requireAuth,
    validatePackageMiddleware,
    async (req: AuthRequest, res: Response) => {
      try {
        const packageId = parseInt(req.params.id);

        const [updatedPackage] = await db
          .update(tokenPackages)
          .set({
            ...req.body,
            updated_at: new Date(),
          })
          .where(eq(tokenPackages.id, packageId))
          .returning();

        if (!updatedPackage) {
          return res.status(404).json({ message: "Package not found" });
        }

        res.json(updatedPackage);
      } catch (error) {
        console.error('Error updating token package:', error);
        res.status(500).json({ message: "Failed to update token package" });
      }
    }
  );

  // Validation check endpoint
  app.post(
    "/api/tokens/packages/validate",
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const packageData = req.body;

        const existingPackages = await db
          .select()
          .from(tokenPackages)
          .where(
            packageData.id 
              ? and(
                  eq(tokenPackages.id, packageData.id),
                  sql`true`
                )
              : sql`true`
          );

        const validation = await validateTokenPackage(packageData, existingPackages);

        res.json(validation);
      } catch (error) {
        console.error('Validation check error:', error);
        res.status(500).json({ message: "Failed to validate package" });
      }
    }
  );

  app.get("/api/tokens/packages", async (_req, res: Response) => {
    try {
      const packages = await db
        .select()
        .from(tokenPackages)
        .orderBy(tokenPackages.price);

      // Ensure each package has a valid Stripe product/price
      for (const pkg of packages) {
        try {
          await createStripeSession({
            body: { packageId: pkg.id },
            user: { id: 0 }, // Dummy user for product creation
          } as any, {
            status: () => ({ json: () => {} }),
          } as any);
        } catch (error) {
          console.error(`Failed to ensure Stripe product for package ${pkg.id}:`, error);
        }
      }

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

  // Token transaction history endpoint
  app.get("/api/tokens/history", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;

      // Get all transactions for the user
      const transactions = await db
        .select({
          id: tokenTransactions.id,
          amount: tokenTransactions.amount,
          type: tokenTransactions.type,
          timestamp: tokenTransactions.timestamp,
          packageId: tokenTransactions.packageId,
        })
        .from(tokenTransactions)
        .where(eq(tokenTransactions.userId, userId))
        .orderBy(desc(tokenTransactions.timestamp));

      // Get aggregated insights
      const [insights] = await db
        .select({
          totalSpent: sum(tokenTransactions.amount).mapWith(Number),
          totalTransactions: count().mapWith(Number),
          avgPurchaseSize: avg(tokenTransactions.amount).mapWith(Number),
        })
        .from(tokenTransactions)
        .where(sql`${tokenTransactions.userId} = ${userId} AND ${tokenTransactions.type} = 'purchase'`);

      res.json({
        transactions,
        insights: {
          totalSpent: insights.totalSpent || 0,
          totalTransactions: insights.totalTransactions || 0,
          avgPurchaseSize: Math.round(insights.avgPurchaseSize || 0),
        },
      });
    } catch (error: unknown) {
      const err = error as Error;
      console.error('Error fetching token history:', err);

      broadcast('ERROR_EVENT', {
        message: err.message || 'Failed to fetch token history',
        type: 'error',
        source: '/api/tokens/history',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      });

      res.status(500).json({ message: "Failed to fetch token history" });
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

async function validateTokenPackage(packageData: any, existingPackages: any[]): Promise<boolean> {
    //Add your validation logic here.  This is a placeholder.
    return true; // Replace with actual validation result
}