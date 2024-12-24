import { type Request, Response } from "express";
import Stripe from "stripe";
import { db } from "@db";
import { tokenTransactions, users, tokenPackages } from "@db/schema";
import { eq, sql } from "drizzle-orm";

const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-01-01" })
  : null;

if (!stripe) {
  console.error("Warning: STRIPE_SECRET_KEY not configured");
}

export async function createStripeSession(req: Request, res: Response) {
  try {
    if (!stripe) {
      return res.status(500).json({ message: "Stripe is not configured" });
    }
    const { amount, packageId } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Get the package details
    const [tokenPackage] = await db
      .select()
      .from(tokenPackages)
      .where(eq(tokenPackages.id, packageId))
      .limit(1);

    if (!tokenPackage) {
      return res.status(404).json({ message: "Package not found" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: tokenPackage.name,
              description: `${tokenPackage.tokenAmount} tokens`,
            },
            unit_amount: tokenPackage.price * 100, // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${req.protocol}://${req.get("host")}/marketplace?success=true`,
      cancel_url: `${req.protocol}://${req.get("host")}/marketplace?canceled=true`,
      metadata: {
        userId: userId.toString(),
        packageId: packageId.toString(),
      },
    });

    res.json({ sessionId: session.id });
  } catch (error) {
    console.error("Stripe session creation error:", error);
    res.status(500).json({ message: "Failed to create payment session" });
  }
}

export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"];
  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(400).json({ message: "Missing stripe signature" });
  }

  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const { userId, packageId } = session.metadata || {};

      if (!userId || !packageId) {
        throw new Error("Missing metadata");
      }

      // Get the package details
      const [tokenPackage] = await db
        .select()
        .from(tokenPackages)
        .where(eq(tokenPackages.id, parseInt(packageId)))
        .limit(1);

      if (!tokenPackage) {
        throw new Error("Package not found");
      }

      // Record the purchase and update balance
      await db.transaction(async (tx) => {
        // Create transaction record
        await tx.insert(tokenTransactions).values({
          userId: parseInt(userId),
          amount: tokenPackage.tokenAmount,
          type: "purchase",
          packageId: parseInt(packageId),
        });

        // Update user's token balance using SQL expression
        await tx
          .update(users)
          .set({
            tokenBalance: sql`${users.tokenBalance} + ${tokenPackage.tokenAmount}`,
            updated_at: new Date(),
          })
          .where(eq(users.id, parseInt(userId)));
      });
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook error:", error);
    res.status(400).json({ message: "Webhook error" });
  }
}

export async function createCryptoPayment(req: Request, res: Response) {
  try {
    const { amount, packageId } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // For demo purposes, we'll just return a static address
    // In a real implementation, you would:
    // 1. Generate a unique deposit address
    // 2. Set up webhooks to monitor for payments
    // 3. Convert fiat amount to crypto
    res.json({
      paymentAddress: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
      amount: amount,
      currency: "ETH",
    });
  } catch (error) {
    console.error("Crypto payment error:", error);
    res.status(500).json({ message: "Failed to create crypto payment" });
  }
}