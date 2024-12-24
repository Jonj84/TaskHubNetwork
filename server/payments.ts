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

// Calculate price for custom token amount
function calculateTokenPrice(amount: number): number {
  // Base price per token (in cents)
  const BASE_PRICE = 100; // $1.00 per token

  // Volume discounts
  if (amount >= 1000) {
    return Math.floor(amount * BASE_PRICE * 0.8); // 20% discount
  } else if (amount >= 500) {
    return Math.floor(amount * BASE_PRICE * 0.9); // 10% discount
  }
  return amount * BASE_PRICE;
}

async function createCustomTokenProduct(amount: number): Promise<string> {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  try {
    // Create a one-time product for this custom amount
    const product = await stripe.products.create({
      name: `${amount} Custom Tokens`,
      description: `Purchase of ${amount} tokens`,
      metadata: {
        tokenAmount: amount.toString(),
        isCustom: "true",
      },
    });

    // Create a price for the custom amount
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: calculateTokenPrice(amount),
      currency: "usd",
      metadata: {
        tokenAmount: amount.toString(),
      },
    });

    return price.id;
  } catch (error) {
    console.error("Failed to create custom token product:", error);
    throw new Error("Failed to create custom token product");
  }
}

export async function createStripeSession(req: Request, res: Response) {
  try {
    if (!stripe) {
      return res.status(500).json({ message: "Stripe is not configured" });
    }
    const { packageId, customAmount } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    let stripePriceId: string;
    let tokenAmount: number;

    if (customAmount) {
      // Validate custom amount
      if (customAmount < 1 || customAmount > 10000) {
        return res.status(400).json({ 
          message: "Custom token amount must be between 1 and 10,000" 
        });
      }
      stripePriceId = await createCustomTokenProduct(customAmount);
      tokenAmount = customAmount;
    } else {
      // Regular package purchase
      const [tokenPackage] = await db
        .select()
        .from(tokenPackages)
        .where(eq(tokenPackages.id, packageId))
        .limit(1);

      if (!tokenPackage) {
        return res.status(404).json({ message: "Package not found" });
      }

      stripePriceId = await createCustomTokenProduct(tokenPackage.tokenAmount);
      tokenAmount = tokenPackage.tokenAmount;
    }

    // Get the base URL dynamically
    const baseUrl = process.env.APP_URL || `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;

    // Create Stripe checkout session
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
        tokenAmount: tokenAmount.toString(),
        isCustomAmount: customAmount ? "true" : "false",
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
      const { userId, tokenAmount, isCustomAmount } = session.metadata || {};

      if (!userId || !tokenAmount) {
        throw new Error("Missing metadata");
      }

      // Record the purchase and update balance
      await db.transaction(async (tx) => {
        // Create transaction record
        await tx.insert(tokenTransactions).values({
          userId: parseInt(userId),
          amount: parseInt(tokenAmount),
          type: "purchase",
          packageId: isCustomAmount === "true" ? null : parseInt(tokenAmount),
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

      console.log(`Processed payment for user ${userId}, amount: ${tokenAmount} tokens`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook error:", error);
    res.status(400).json({ message: "Webhook error" });
  }
}

export async function createCryptoPayment(req: Request, res: Response) {
  try {
    const { amount } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!amount || amount < 1 || amount > 10000) {
      return res.status(400).json({ 
        message: "Token amount must be between 1 and 10,000" 
      });
    }

    const priceInCents = calculateTokenPrice(amount);

    // For demo purposes, we'll just return a static address
    // In a real implementation, you would:
    // 1. Generate a unique deposit address
    // 2. Set up webhooks to monitor for payments
    // 3. Convert fiat amount to crypto
    res.json({
      paymentAddress: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
      amount: priceInCents / 100, // Convert back to dollars for display
      tokenAmount: amount,
      currency: "ETH",
    });
  } catch (error) {
    console.error("Crypto payment error:", error);
    res.status(500).json({ message: "Failed to create crypto payment" });
  }
}