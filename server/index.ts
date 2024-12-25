import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { setupAuth } from "./auth";
import { db } from "@db";
import { IncomingMessage } from "http";
import { Socket } from "net";
import { setupWebSocket } from "./ws";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

(async () => {
  try {
    log("Starting server initialization...");

    // Verify database connection
    try {
      await db.query.users.findFirst();
      log("Database connection verified");
    } catch (error: any) {
      log("Database connection error:", error);
      throw new Error(`Database connection failed: ${error.message}`);
    }

    // Set up auth
    log("Setting up authentication...");
    setupAuth(app);
    log("Authentication setup complete");

    // Register routes and get HTTP server
    log("Registering routes...");
    const server = registerRoutes(app);
    log("Route registration complete");

    // Setup WebSocket server
    log("Setting up WebSocket server...");
    setupWebSocket(server);
    log("WebSocket setup complete");

    // Global error handler with detailed logging
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      log(`Error handling request: ${message}`);
      if (err.stack) {
        log(`Stack trace: ${err.stack}`);
      }

      // Log additional error details if available
      if (err.details) {
        log(`Additional error details: ${JSON.stringify(err.details)}`);
      }

      res.status(status).json({ 
        message,
        ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {})
      });
    });

    // Setup Vite in development mode or serve static files in production
    if (app.get("env") === "development") {
      log("Setting up Vite development server...");
      await setupVite(app, server);
      log("Vite setup complete");
    } else {
      log("Setting up static file serving...");
      serveStatic(app);
      log("Static file serving setup complete");
    }

    // Start server
    const PORT = 5000;
    server.listen(PORT, "0.0.0.0", () => {
      log(`Server is running on port ${PORT}`);
    });

    // Handle server errors
    server.on('error', (error: Error) => {
      log(`Server error: ${error.message}`);
      if (error.stack) {
        log(`Stack trace: ${error.stack}`);
      }
      process.exit(1);
    });

  } catch (error: any) {
    log(`Fatal error during startup: ${error.message}`);
    if (error.stack) {
      log(`Stack trace: ${error.stack}`);
    }
    process.exit(1);
  }
})();