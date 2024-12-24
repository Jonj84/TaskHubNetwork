import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { setupWebSocket } from "./ws";
import { db } from "@db";
import { tasks } from "@db/schema";
import { desc, eq } from "drizzle-orm";
import { insertTaskSchema } from "@db/schema";

// Extend Express Request type to include authenticated user
interface AuthRequest extends Request {
  user?: {
    id: number;
    username: string;
    tokenBalance: number;
  };
}

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

  // Middleware to ensure user is authenticated
  const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Authentication required" });
    }
    next();
  };

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