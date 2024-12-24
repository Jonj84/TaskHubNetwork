import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { setupWebSocket } from "./ws";
import { db } from "@db";
import { tasks, tokenTransactions, users } from "@db/schema";
import { and, eq, desc, sql } from "drizzle-orm";

// Extend Express Request type to include authenticated user
interface AuthRequest extends Request {
  user?: {
    id: number;
    username: string;
    tokenBalance: number;
  };
}

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);
  setupAuth(app);
  const { broadcast } = setupWebSocket(httpServer);

  // Middleware to ensure user is authenticated
  const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) {
      return res.status(401).send("Authentication required");
    }
    next();
  };

  // Tasks
  app.get("/api/tasks", requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const allTasks = await db.query.tasks.findMany({
        orderBy: desc(tasks.created_at),
      });
      res.json(allTasks);
    } catch (error) {
      console.error('Error fetching tasks:', error);
      res.status(500).send("Failed to fetch tasks");
    }
  });

  app.post("/api/tasks", requireAuth, async (req: AuthRequest, res: Response) => {
    const { title, description, type, reward, proofRequired } = req.body;

    if (!req.user || req.user.tokenBalance < reward) {
      return res.status(400).send("Insufficient token balance");
    }

    try {
      const [task] = await db.transaction(async (tx) => {
        const [newTask] = await tx
          .insert(tasks)
          .values({
            title,
            description,
            type,
            reward,
            proofRequired,
            creatorId: req.user!.id,
          })
          .returning();

        await tx.insert(tokenTransactions).values({
          userId: req.user!.id,
          amount: -reward,
          type: "escrow",
          taskId: newTask.id,
        });

        await tx
          .update(users)
          .set({
            tokenBalance: sql`${users.tokenBalance} - ${reward}`,
            updated_at: new Date(),
          })
          .where(eq(users.id, req.user!.id));

        return [newTask];
      });

      broadcast('task_update', { taskId: task.id });
      res.json(task);
    } catch (error) {
      console.error('Error creating task:', error);
      res.status(500).send("Failed to create task");
    }
  });

  app.post("/api/tasks/:taskId/proof", requireAuth, async (req: AuthRequest, res: Response) => {
    const taskId = parseInt(req.params.taskId);
    const { proof } = req.body;

    try {
      const [task] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);

      if (!task) {
        return res.status(404).send("Task not found");
      }

      if (!req.user || task.status !== "in_progress" || task.workerId !== req.user.id) {
        return res.status(400).send("Cannot submit proof for this task");
      }

      const [updatedTask] = await db
        .update(tasks)
        .set({
          status: "pending_verification",
          proofSubmitted: proof,
          updated_at: new Date(),
        })
        .where(eq(tasks.id, taskId))
        .returning();

      broadcast('task_update', { taskId });
      res.json(updatedTask);
    } catch (error) {
      console.error('Error submitting proof:', error);
      res.status(500).send("Failed to submit proof");
    }
  });

  app.post("/api/tasks/:taskId/verify", requireAuth, async (req: AuthRequest, res: Response) => {
    const taskId = parseInt(req.params.taskId);
    const { verified } = req.body;

    if (!req.user) {
      return res.status(401).send("Authentication required");
    }

    try {
      const [task] = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.creatorId, req.user.id)))
        .limit(1);

      if (!task) {
        return res.status(404).send("Task not found");
      }

      if (task.status !== "pending_verification") {
        return res.status(400).send("Task is not pending verification");
      }

      await db.transaction(async (tx) => {
        if (verified) {
          // Release tokens to worker
          await tx.insert(tokenTransactions).values({
            userId: task.workerId!,
            amount: task.reward,
            type: "reward",
            taskId: task.id,
          });

          // Update worker balance
          await tx
            .update(users)
            .set({
              tokenBalance: sql`${users.tokenBalance} + ${task.reward}`,
              updated_at: new Date(),
            })
            .where(eq(users.id, task.workerId!));

          // Update task status
          await tx
            .update(tasks)
            .set({
              status: "completed",
              updated_at: new Date(),
            })
            .where(eq(tasks.id, taskId));
        } else {
          // Return tokens to creator
          await tx.insert(tokenTransactions).values({
            userId: task.creatorId,
            amount: task.reward,
            type: "release",
            taskId: task.id,
          });

          // Update creator balance
          await tx
            .update(users)
            .set({
              tokenBalance: sql`${users.tokenBalance} + ${task.reward}`,
              updated_at: new Date(),
            })
            .where(eq(users.id, task.creatorId));

          // Update task status
          await tx
            .update(tasks)
            .set({
              status: "open",
              workerId: null,
              proofSubmitted: null,
              updated_at: new Date(),
            })
            .where(eq(tasks.id, taskId));
        }
      });

      broadcast('task_update', { taskId });
      res.json({ success: true });
    } catch (error) {
      console.error('Error verifying task:', error);
      res.status(500).send("Failed to verify task");
    }
  });

  // Tokens
  app.get("/api/tokens/transactions", requireAuth, async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).send("Authentication required");
    }

    try {
      const transactions = await db.query.tokenTransactions.findMany({
        where: eq(tokenTransactions.userId, req.user.id),
        orderBy: desc(tokenTransactions.timestamp),
      });
      res.json(transactions);
    } catch (error) {
      console.error('Error fetching transactions:', error);
      res.status(500).send("Failed to fetch transactions");
    }
  });

  app.post("/api/tokens/purchase", requireAuth, async (req: AuthRequest, res: Response) => {
    const { amount } = req.body;

    if (!req.user || !amount || amount <= 0) {
      return res.status(400).send("Invalid amount");
    }

    try {
      const [updatedUser] = await db.transaction(async (tx) => {
        // Record purchase transaction
        await tx.insert(tokenTransactions).values({
          userId: req.user!.id,
          amount,
          type: "purchase",
        });

        // Update user balance
        return await tx
          .update(users)
          .set({
            tokenBalance: sql`${users.tokenBalance} + ${amount}`,
            updated_at: new Date(),
          })
          .where(eq(users.id, req.user!.id))
          .returning();
      });

      res.json({
        success: true,
        newBalance: updatedUser.tokenBalance,
      });
    } catch (error) {
      console.error('Error purchasing tokens:', error);
      res.status(500).send("Failed to purchase tokens");
    }
  });

  return httpServer;
}