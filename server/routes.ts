import type { Express } from "express";
import { createServer, type Server } from "http";
import express from "express";
import { createStripeSession, handleStripeWebhook } from "./payments";

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


  // Token purchase endpoint
  app.post("/api/tokens/purchase", async (req, res) => {
    try {
      await createStripeSession(req, res);
    } catch (error: any) {
      console.error('Token purchase error:', error);
      return res.status(500).json({ 
        message: error.message || 'Failed to create payment session' 
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}