import { type Request, Response } from "express";
import Stripe from "stripe";
import { db } from "@db";
import { tokenTransactions, users } from "@db/schema";
import { eq, sql } from "drizzle-orm";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY must be set");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function createStripeSession(req: Request, res: Response) {
  try {
    const { amount } = req.body;

    // Validate amount
    if (!amount || isNaN(amount) || amount < 1 || amount > 10000) {
      return res.status(400).json({
        message: "Token amount must be between 1 and 10,000",
        code: 'INVALID_AMOUNT'
      });
    }

    // Calculate price in cents (Stripe expects amounts in smallest currency unit)
    const priceInCents = Math.round(amount * 100); // $1 per token
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    console.log('Creating Stripe session:', {
      amount,
      priceInCents,
      baseUrl
    });

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${amount} Platform Tokens`,
              description: `Purchase of ${amount} tokens`,
            },
            unit_amount: priceInCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/cancel`,
      metadata: {
        tokenAmount: amount.toString(),
      },
    });

    console.log('Stripe session created:', {
      sessionId: session.id,
      success_url: session.success_url,
      cancel_url: session.cancel_url
    });

    // Return session information
    res.json({
      sessionId: session.id
    });
  } catch (error: any) {
    console.error("Stripe session creation error:", {
      error: error.message,
      type: error.type,
      stack: error.stack,
      stripeCode: error.code
    });

    // Format Stripe errors appropriately
    if (error.type?.startsWith('Stripe')) {
      res.status(400).json({ 
        message: error.message,
        code: error.code,
        type: error.type
      });
    } else {
      res.status(500).json({ 
        message: error.message || "Failed to create payment session",
        code: 'INTERNAL_ERROR'
      });
    }
  }
}

export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"];

  try {
    if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
      throw new Error("Missing Stripe webhook configuration");
    }

    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    console.log('Received Stripe webhook event:', {
      type: event.type,
      id: event.id
    });

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const { tokenAmount } = session.metadata || {};

      if (!tokenAmount) {
        throw new Error("Missing metadata in Stripe session");
      }

      console.log('Payment completed:', {
        tokenAmount,
        sessionId: session.id
      });
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error("Stripe webhook error:", {
      error: error.message,
      type: error.type,
      stack: error.stack
    });

    res.status(400).json({ 
      message: "Webhook error",
      error: error.message
    });
  }
}