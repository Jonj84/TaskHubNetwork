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
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Validate amount
    if (!amount || isNaN(amount) || amount < 1 || amount > 10000) {
      return res.status(400).json({
        message: "Token amount must be between 1 and 10,000"
      });
    }

    // Calculate price in cents (Stripe expects amounts in smallest currency unit)
    const priceInCents = Math.round(amount * 100); // $1 per token

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${amount} Platform Tokens`,
            },
            unit_amount: priceInCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${req.protocol}://${req.get('host')}/marketplace?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.protocol}://${req.get('host')}/marketplace?canceled=true`,
      metadata: {
        userId: userId.toString(),
        tokenAmount: amount.toString(),
      },
    });

    // Return session information
    res.json({
      sessionId: session.id,
    });
  } catch (error: any) {
    console.error("Stripe session creation error:", error);
    res.status(500).json({ 
      message: error.message || "Failed to create payment session" 
    });
  }
}

export async function handleStripeWebhook(req: Request, res: Response) {
  try {
    const sig = req.headers["stripe-signature"];

    if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(400).json({ message: "Missing required Stripe configuration" });
    }

    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const { userId, tokenAmount } = session.metadata || {};

      if (!userId || !tokenAmount) {
        throw new Error("Missing metadata in Stripe session");
      }

      // Record the purchase and update balance
      await db.transaction(async (tx) => {
        // Create transaction record
        await tx.insert(tokenTransactions).values({
          userId: parseInt(userId),
          amount: parseInt(tokenAmount),
          type: "purchase",
          timestamp: new Date()
        });

        // Update user's token balance
        await tx
          .update(users)
          .set({
            tokenBalance: sql`${users.tokenBalance} + ${parseInt(tokenAmount)}`,
            updated_at: new Date(),
          })
          .where(eq(users.id, parseInt(userId)));
      });

      console.log(`Successfully processed payment for user ${userId}, amount: ${tokenAmount} tokens`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook error:", error);
    res.status(400).json({ message: "Webhook error" });
  }
}