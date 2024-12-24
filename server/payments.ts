import { type Request, Response } from "express";
import Stripe from "stripe";
import { db } from "@db";
import { tokenTransactions, users, tokenPackages } from "@db/schema";
import { eq, sql } from "drizzle-orm";

const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-12-18.acacia" })
  : null;

if (!stripe) {
  console.error("Warning: STRIPE_SECRET_KEY not configured");
}

async function ensureStripeProduct(tokenPackage: any) {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  try {
    // If we already have valid Stripe IDs, validate them first
    if (tokenPackage.stripeProductId && tokenPackage.stripePriceId) {
      try {
        // Verify the price still exists and is valid
        await stripe.prices.retrieve(tokenPackage.stripePriceId);
        return tokenPackage.stripePriceId;
      } catch (error) {
        console.log("Cached Stripe price not found, creating new one");
      }
    }

    // Create a new product in Stripe with better metadata
    const product = await stripe.products.create({
      name: tokenPackage.name,
      description: `${tokenPackage.tokenAmount} tokens - ${tokenPackage.description}`,
      metadata: {
        packageId: tokenPackage.id.toString(),
        tokenAmount: tokenPackage.tokenAmount.toString(),
        isPopular: tokenPackage.isPopular ? "true" : "false",
      },
    });

    // Create a price for the product
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: tokenPackage.price, // Price is already in cents
      currency: "usd",
      metadata: {
        packageId: tokenPackage.id.toString(),
      },
    });

    // Update our database with the new Stripe IDs
    await db
      .update(tokenPackages)
      .set({
        stripeProductId: product.id,
        stripePriceId: price.id,
        updated_at: new Date(),
      })
      .where(eq(tokenPackages.id, tokenPackage.id));

    console.log(`Created Stripe product/price for package ${tokenPackage.name}`);
    return price.id;
  } catch (error) {
    console.error("Failed to create Stripe product/price:", error);
    throw new Error("Failed to create Stripe product/price");
  }
}

export async function createStripeSession(req: Request, res: Response) {
  try {
    if (!stripe) {
      return res.status(500).json({ message: "Stripe is not configured" });
    }
    const { packageId } = req.body;
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

    // Ensure we have a valid Stripe price ID for this package
    const stripePriceId = await ensureStripeProduct(tokenPackage);

    // Get the base URL dynamically
    const baseUrl = process.env.APP_URL || `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;

    // Create a Stripe Checkout Session using the price ID
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price: stripePriceId,
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${baseUrl}/marketplace?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/marketplace?canceled=true`,
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
    // Important: Use raw body for webhook signature verification
    const event = stripe!.webhooks.constructEvent(
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

      console.log(`Processed payment for user ${userId}, package ${packageId}`);
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