import { type Request, Response } from "express";
import Stripe from "stripe";
import { db } from "@db";
import { tokenTransactions, users } from "@db/schema";
import { eq } from "drizzle-orm";
import { blockchainService } from './blockchain';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY must be set");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Calculate price and bonus tokens based on tiers
function calculatePrice(amount: number) {
  let bonusPercentage = 0;
  let tier = 'standard';

  if (amount >= 1000) {
    bonusPercentage = 20;
    tier = 'premium';
  } else if (amount >= 500) {
    bonusPercentage = 10;
    tier = 'plus';
  }

  const basePrice = amount * 1.00; // $1 per token
  const bonusTokens = Math.floor(amount * (bonusPercentage / 100));

  return {
    basePrice: Math.round(basePrice * 100) / 100,
    bonusTokens,
    bonusPercentage,
    finalPrice: Math.round(basePrice * 100) / 100,
    tier,
    pricePerToken: 1.00 // $1 per token
  };
}

export async function createStripeSession(req: Request, res: Response) {
  try {
    const { amount } = req.body;

    if (!amount || isNaN(amount) || amount < 1 || amount > 10000) {
      return res.status(400).json({
        message: 'Token amount must be between 1 and 10,000',
        code: 'INVALID_AMOUNT'
      });
    }

    const priceInfo = calculatePrice(amount);
    const priceInCents = Math.round(priceInfo.finalPrice * 100);

    const isReplit = Boolean(req.headers['x-replit-user-id']);
    const host = req.get('host');
    const protocol = isReplit ? 'https' : 'http';
    const baseUrl = `${protocol}://${host}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${amount} Tokens${priceInfo.bonusTokens ? ` + ${priceInfo.bonusTokens} Bonus` : ''}`,
              description: `Purchase of ${amount} tokens with ${priceInfo.bonusPercentage}% bonus mining rewards`,
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
        username: (req as any).user?.username,
        tier: priceInfo.tier,
        bonusTokens: priceInfo.bonusTokens.toString(),
        bonusPercentage: priceInfo.bonusPercentage.toString(),
        pricePerToken: priceInfo.pricePerToken.toString()
      },
    });

    res.json({
      checkoutUrl: session.url,
      sessionId: session.id,
      pricing: priceInfo // Include pricing info in response
    });
  } catch (error: any) {
    console.error("Stripe session creation error:", error);
    res.status(500).json({
      message: error.message || "Failed to create payment session",
      code: 'INTERNAL_ERROR'
    });
  }
}

export async function verifyStripePayment(sessionId: string, res: Response) {
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

    const { tokenAmount, userId, username, bonusTokens, pricePerToken } = session.metadata || {};

    if (!tokenAmount || !userId || !username) {
      console.error('Missing metadata:', {
        sessionId,
        metadata: session.metadata
      });
      throw new Error('Missing required metadata in session');
    }

    // Process the token purchase
    const result = await db.transaction(async (tx) => {
      // Check if payment was already processed
      const existingTransaction = await tx.query.tokenTransactions.findFirst({
        where: eq(tokenTransactions.paymentId, session.payment_intent as string)
      });

      if (existingTransaction) {
        return {
          status: 'already_processed',
          transaction: existingTransaction
        };
      }

      // Create blockchain transaction with price per token
      const blockchainTx = await blockchainService.createTransaction(
        'SYSTEM',
        username,
        parseInt(tokenAmount),
        {
          paymentId: session.payment_intent as string,
          price: session.amount_total ? session.amount_total / 100 : undefined,
          pricePerToken: parseFloat(pricePerToken || "1.00"),
          bonusTokens: parseInt(bonusTokens || '0')
        }
      );

      return {
        status: 'success',
        transaction: blockchainTx
      };
    });

    if (result.status === 'already_processed') {
      res.json({
        success: true,
        status: 'processed',
        message: 'Payment was already processed',
        transaction: result.transaction
      });
    } else {
      res.json({
        success: true,
        status: 'completed',
        message: 'Payment processed successfully',
        transaction: result.transaction
      });
    }

  } catch (error: any) {
    console.error('Payment verification error:', error);
    throw error;
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

    // Only process checkout.session.completed events and respond immediately
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      // Process payment asynchronously to prevent duplicate processing
      verifyStripePayment(session.id, res).catch(error => {
        console.error("Async payment verification failed:", error);
      });
    }

    // Always respond immediately to webhook
    res.json({ received: true });
  } catch (error: any) {
    console.error("Stripe webhook error:", error);
    res.status(400).json({
      message: "Webhook error",
      error: error.message
    });
  }
}