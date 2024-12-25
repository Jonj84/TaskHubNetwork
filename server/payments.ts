import { type Request, Response } from "express";
import Stripe from "stripe";
import { db } from "@db";
import { tokenTransactions, users } from "@db/schema";
import { eq, sql } from "drizzle-orm";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY must be set");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Pricing tiers for Stripe products
const STRIPE_PRODUCTS = {
  standard: {
    name: 'Standard Tokens',
    description: 'Basic token package (1-499 tokens)',
    pricePerToken: 1.00
  },
  plus: {
    name: 'Plus Tokens',
    description: 'Volume discount package (500-999 tokens) - 10% off',
    pricePerToken: 0.90
  },
  premium: {
    name: 'Premium Tokens',
    description: 'Bulk discount package (1000+ tokens) - 20% off',
    pricePerToken: 0.80
  }
};

async function creditTokensToUser(userId: number, tokenAmount: number, paymentId: string) {
  console.log('Starting token credit process:', {
    userId,
    tokenAmount,
    paymentId,
    timestamp: new Date().toISOString()
  });

  try {
    await db.transaction(async (tx) => {
      console.log('Beginning database transaction');

      // Update user's token balance
      const updateResult = await tx
        .update(users)
        .set({
          tokenBalance: sql`token_balance + ${tokenAmount}`,
          updated_at: new Date()
        })
        .where(eq(users.id, userId))
        .returning({ newBalance: users.tokenBalance });

      console.log('Updated user token balance:', updateResult);

      // Record the transaction
      const transactionResult = await tx.insert(tokenTransactions).values({
        userId,
        amount: tokenAmount,
        type: 'purchase',
        status: 'completed',
        paymentId,
        timestamp: new Date()
      }).returning();

      console.log('Recorded token transaction:', transactionResult);
    });

    // Verify the updated balance
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        tokenBalance: true,
        username: true
      }
    });

    console.log('Successfully credited tokens:', {
      userId,
      tokenAmount,
      paymentId,
      newBalance: user?.tokenBalance,
      timestamp: new Date().toISOString()
    });

    return true;
  } catch (error) {
    console.error('Failed to credit tokens:', {
      error,
      userId,
      tokenAmount,
      paymentId,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

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

    // Determine pricing tier
    let tier = 'standard';
    if (amount >= 1000) {
      tier = 'premium';
    } else if (amount >= 500) {
      tier = 'plus';
    }

    const product = STRIPE_PRODUCTS[tier as keyof typeof STRIPE_PRODUCTS];
    const priceInCents = Math.round(amount * product.pricePerToken * 100);

    console.log('Creating Stripe session:', {
      amount,
      tier,
      priceInCents,
      userId: (req as any).user?.id
    });

    // Get the correct domain based on environment
    const isReplit = Boolean(req.headers['x-replit-user-id']);
    const host = isReplit ? req.get('host') : 'localhost:5000';
    const protocol = isReplit ? 'https' : 'http';
    const baseUrl = `${protocol}://${host}`;

    console.log('Using base URL:', baseUrl);

    // Create a checkout session with dynamic URLs
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${amount} ${product.name}`,
              description: `Purchase of ${amount} tokens (${product.description})`,
            },
            unit_amount: priceInCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/payment/cancel`,
      metadata: {
        tokenAmount: amount.toString(),
        userId: (req as any).user?.id?.toString(),
        tier
      },
    });

    console.log('Stripe session created:', {
      sessionId: session.id,
      url: session.url,
      successUrl: `${baseUrl}/payment/success`,
      cancelUrl: `${baseUrl}/payment/cancel`
    });

    // Return the checkout URL and session ID
    res.json({
      checkoutUrl: session.url,
      sessionId: session.id
    });
  } catch (error: any) {
    console.error("Stripe session creation error:", {
      error: error.message,
      type: error.type,
      stack: error.stack,
      stripeCode: error.code
    });

    if (error.type?.startsWith('Stripe')) {
      return res.status(400).json({
        message: error.message,
        code: error.code,
        type: error.type
      });
    }

    return res.status(500).json({
      message: error.message || "Failed to create payment session",
      code: 'INTERNAL_ERROR'
    });
  }
}

export async function verifyStripePayment(sessionId: string, res: Response) {
  console.log('Verifying payment for session:', sessionId);

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    console.log('Retrieved Stripe session:', {
      id: session.id,
      paymentStatus: session.payment_status,
      metadata: session.metadata
    });

    if (!session) {
      throw new Error('Payment session not found');
    }

    // Check payment status
    if (session.payment_status !== 'paid') {
      console.log('Payment not completed:', {
        sessionId,
        status: session.payment_status
      });
      return res.status(400).json({
        message: 'Payment has not been completed',
        status: session.payment_status
      });
    }

    const { tokenAmount, userId } = session.metadata || {};

    if (!tokenAmount || !userId) {
      console.error('Missing metadata:', {
        sessionId,
        metadata: session.metadata
      });
      throw new Error('Missing required metadata in session');
    }

    // Credit tokens to user
    await creditTokensToUser(
      parseInt(userId, 10),
      parseInt(tokenAmount, 10),
      session.payment_intent as string
    );

    // Return success response
    const response = {
      success: true,
      tokenAmount: parseInt(tokenAmount, 10),
      paymentId: session.payment_intent as string
    };

    console.log('Payment verification successful:', response);
    res.json(response);

  } catch (error: any) {
    console.error('Payment verification error:', {
      error,
      sessionId,
      message: error.message,
      stack: error.stack
    });
    throw error;
  }
}

export async function handleStripeWebhook(req: Request, res: Response) {
    console.log('Handling Stripe Webhook');
    const sig = req.headers["stripe-signature"];

    try {
        if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
            console.error('Missing Stripe webhook configuration');
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
            const { tokenAmount, userId } = session.metadata || {};

            if (!tokenAmount || !userId) {
                console.error("Missing metadata in Stripe session:", {session});
                throw new Error("Missing metadata in Stripe session");
            }

            console.log('Payment completed:', {
                tokenAmount,
                userId,
                sessionId: session.id
            });

            // Credit tokens to user's account
            await creditTokensToUser(
                parseInt(userId, 10),
                parseInt(tokenAmount, 10),
                session.payment_intent as string
            );
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