import { type Request, Response } from "express";
import Stripe from "stripe";
import { db } from "@db";
import { tokenTransactions, users } from "@db/schema";
import { eq, sql } from "drizzle-orm";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-12-18.acacia" })
  : null;

if (!stripe) {
  console.error("Warning: STRIPE_SECRET_KEY not configured");
}

// Define pricing tiers
const PRICING_TIERS = {
  base: {
    name: "Base Tier",
    pricePerToken: 10, // $0.10 per token in cents
    minTokens: 1,
    maxTokens: 499,
    discount: 0
  },
  silver: {
    name: "Silver Tier",
    pricePerToken: 9, // $0.09 per token in cents
    minTokens: 500,
    maxTokens: 999,
    discount: 10
  },
  gold: {
    name: "Gold Tier",
    pricePerToken: 8, // $0.08 per token in cents
    minTokens: 1000,
    maxTokens: 10000,
    discount: 20
  }
};

// Calculate price based on token amount and volume discounts
function calculateTokenPrice(amount: number): {
  priceInCents: number;
  discount: number;
  tier: string;
} {
  let tier: keyof typeof PRICING_TIERS;

  if (amount >= PRICING_TIERS.gold.minTokens) {
    tier = 'gold';
  } else if (amount >= PRICING_TIERS.silver.minTokens) {
    tier = 'silver';
  } else {
    tier = 'base';
  }

  const { pricePerToken, discount } = PRICING_TIERS[tier];
  const priceInCents = Math.floor(amount * pricePerToken);

  return { 
    priceInCents,
    discount,
    tier
  };
}

// Create or get Stripe product for token purchase
async function getOrCreateTokenProduct(): Promise<string> {
  if (!stripe) {
    throw new Error("Stripe is not configured");
  }

  const productName = "Platform Tokens";

  // Search for existing product
  const products = await stripe.products.list({
    limit: 1,
    active: true
  });

  let product;
  if (products.data.length > 0) {
    product = products.data[0];
  } else {
    // Create new product if none exists
    product = await stripe.products.create({
      name: productName,
      description: "Platform tokens with volume discounts",
      metadata: {
        type: "platform_token"
      }
    });
  }

  return product.id;
}

export async function createStripeSession(req: Request, res: Response) {
  try {
    if (!stripe) {
      return res.status(500).json({ message: "Stripe is not configured" });
    }

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

    // Get product ID
    const productId = await getOrCreateTokenProduct();

    // Calculate price with volume discount
    const { priceInCents, discount, tier } = calculateTokenPrice(amount);

    // Create a one-time price
    const price = await stripe.prices.create({
      product: productId,
      unit_amount: priceInCents,
      currency: "usd",
      metadata: {
        tokenAmount: amount.toString(),
        discount: discount.toString(),
        tier
      },
    });

    // Get the base URL dynamically
    const baseUrl = process.env.APP_URL || `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`;

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price: price.id,
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${baseUrl}/marketplace?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/marketplace?canceled=true`,
      metadata: {
        userId: userId.toString(),
        tokenAmount: amount.toString(),
        discount: discount.toString(),
        tier
      },
    });

    res.json({
      sessionId: session.id,
      discount,
      tier,
      finalPrice: priceInCents / 100, // Convert to dollars for display
      basePrice: (amount * PRICING_TIERS.base.pricePerToken) / 100
    });
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
    const event = stripe!.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const { userId, tokenAmount, discount, tier } = session.metadata || {};

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

      console.log(`Processed payment for user ${userId}, amount: ${tokenAmount} tokens, tier: ${tier}, discount: ${discount}%`);
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

    const { priceInCents, discount, tier } = calculateTokenPrice(amount);

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
      tier,
      discount
    });
  } catch (error) {
    console.error("Crypto payment error:", error);
    res.status(500).json({ message: "Failed to create crypto payment" });
  }
}