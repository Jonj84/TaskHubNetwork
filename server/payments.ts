import { type Request, Response } from "express";
import Stripe from "stripe";
import { db } from "@db";
import { tokenTransactions, users } from "@db/schema";
import { eq, sql } from "drizzle-orm";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY must be set");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16" // Latest stable version from Stripe docs
});

// Define base prices for tokens
const BASE_PRICE = 100; // $1.00 per token in cents

// Define pricing tiers products
const TIER_PRODUCTS = {
  standard: {
    name: "Standard Token Package",
    description: "1-499 tokens, no discount",
    multiplier: 1, // No discount
    minTokens: 1,
    maxTokens: 499
  },
  silver: {
    name: "Silver Token Package",
    description: "500-999 tokens, 10% discount",
    multiplier: 0.9, // 10% discount
    minTokens: 500,
    maxTokens: 999
  },
  gold: {
    name: "Gold Token Package",
    description: "1000+ tokens, 20% discount",
    multiplier: 0.8, // 20% discount
    minTokens: 1000,
    maxTokens: Infinity
  }
};

// Get the appropriate tier for token amount
function getTierForAmount(amount: number) {
  if (amount >= TIER_PRODUCTS.gold.minTokens) return 'gold';
  if (amount >= TIER_PRODUCTS.silver.minTokens) return 'silver';
  return 'standard';
}

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

    // Get tier based on amount
    const tier = getTierForAmount(amount);
    const tierProduct = TIER_PRODUCTS[tier];

    // Calculate final price
    const priceInCents = Math.round(amount * BASE_PRICE * tierProduct.multiplier);
    const discountPercentage = Math.round((1 - tierProduct.multiplier) * 100);

    // Create or retrieve product for this tier
    const product = await stripe.products.create({
      name: `${amount} Platform Tokens (${tierProduct.name})`,
      description: `Purchase of ${amount} tokens with ${discountPercentage}% volume discount`,
    });

    // Create a price for this product
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: priceInCents,
      currency: "usd",
    });

    // Get the base URL for success/cancel redirects
    const baseUrl = `${req.protocol}://${req.get('host')}`;

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
        tier,
        discount: discountPercentage.toString()
      },
    });

    // Return only the sessionId and pricing information
    res.json({
      sessionId: session.id,
      url: session.url,
      basePrice: amount * BASE_PRICE / 100,
      discount: discountPercentage,
      finalPrice: priceInCents / 100,
      tier
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
    const priceInDollars = priceInCents / 100;

    res.json({
      paymentAddress: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e", // Demo address
      amount: priceInDollars,
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
  const priceInCents = Math.floor(amount * pricePerToken * (1 - discount / 100));

  return { 
    priceInCents,
    discount,
    tier
  };
}

const PRICING_TIERS = {
  base: {
    name: "Base Tier",
    pricePerToken: 100, // $1.00 per token in cents
    minTokens: 1,
    maxTokens: 499,
    discount: 0
  },
  silver: {
    name: "Silver Tier",
    pricePerToken: 90, // $0.90 per token in cents
    minTokens: 500,
    maxTokens: 999,
    discount: 10
  },
  gold: {
    name: "Gold Tier",
    pricePerToken: 80, // $0.80 per token in cents
    minTokens: 1000,
    maxTokens: Infinity,
    discount: 20
  }
};