import { type Request, Response } from "express";
import Stripe from "stripe";
import { db } from "@db";
import { tokenTransactions, users, tokens } from "@db/schema";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { blockchainService } from './blockchain';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY must be set");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Pricing tiers configuration
const PRICING_TIERS = {
  standard: {
    name: 'Standard',
    minTokens: 1,
    maxTokens: 499,
    pricePerToken: 1.00,
    bonusPercentage: 0
  },
  plus: {
    name: 'Plus',
    minTokens: 500,
    maxTokens: 999,
    pricePerToken: 1.00,
    bonusPercentage: 10
  },
  premium: {
    name: 'Premium',
    minTokens: 1000,
    maxTokens: 10000,
    pricePerToken: 1.00,
    bonusPercentage: 20
  }
};

function calculatePrice(amount: number) {
  let tier = 'standard';

  if (amount >= 1000) {
    tier = 'premium';
  } else if (amount >= 500) {
    tier = 'plus';
  }

  const selectedTier = PRICING_TIERS[tier as keyof typeof PRICING_TIERS];
  const basePrice = amount * selectedTier.pricePerToken;
  const bonusTokens = Math.floor(amount * (selectedTier.bonusPercentage / 100));

  return {
    basePrice: Math.round(basePrice * 100) / 100,
    bonusTokens,
    bonusPercentage: selectedTier.bonusPercentage,
    finalPrice: Math.round(basePrice * 100) / 100,
    tier: selectedTier.name.toLowerCase()
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

    console.log('Creating Stripe session:', {
      amount,
      priceInfo,
      userId: (req as any).user?.id
    });

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
        tier: priceInfo.tier,
        bonusTokens: priceInfo.bonusTokens.toString(),
        bonusPercentage: priceInfo.bonusPercentage.toString()
      },
    });

    res.json({
      checkoutUrl: session.url,
      sessionId: session.id
    });
  } catch (error: any) {
    console.error("Stripe session creation error:", error);
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

    const { tokenAmount, userId, bonusTokens } = session.metadata || {};

    if (!tokenAmount || !userId) {
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

      // Create blockchain transaction
      const blockchainTx = await blockchainService.createTransaction(
        'SYSTEM',
        session.metadata?.username || 'UNKNOWN',
        parseInt(tokenAmount),
        {
          paymentId: session.payment_intent as string,
          price: session.amount_total ? session.amount_total / 100 : undefined,
          bonusTokens: parseInt(bonusTokens || '0')
        }
      );

      //Credit Tokens to the user
      const creditResult = await creditTokensToUser(parseInt(userId), parseInt(tokenAmount), session.payment_intent as string);

      return {
        status: 'success',
        transaction: blockchainTx,
        creditResult
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
        transaction: result.transaction,
        creditResult: result.creditResult
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

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      await verifyStripePayment(session.id, res);
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error("Stripe webhook error:", error);
    res.status(400).json({
      message: "Webhook error",
      error: error.message
    });
  }
}

async function creditTokensToUser(userId: number, tokenAmount: number, paymentId: string) {
  console.log('Starting token credit process:', {
    userId,
    tokenAmount,
    paymentId,
    timestamp: new Date().toISOString()
  });

  try {
    const result = await db.transaction(async (tx) => {
      console.log('Beginning database transaction');

      // First check if this payment has already been processed
      const existingTransaction = await tx.query.tokenTransactions.findFirst({
        where: eq(tokenTransactions.paymentId, paymentId)
      });

      if (existingTransaction) {
        console.log('Payment already processed:', existingTransaction);
        return { status: 'already_processed', transaction: existingTransaction };
      }

      // Update user's token balance
      const [updateResult] = await tx
        .update(users)
        .set({
          tokenBalance: sql`token_balance + ${tokenAmount}`,
          updated_at: new Date()
        })
        .where(eq(users.id, userId))
        .returning({ 
          newBalance: users.tokenBalance,
          username: users.username 
        });

      console.log('Updated user token balance:', updateResult);

      // Record the transaction
      const [transactionResult] = await tx.insert(tokenTransactions)
        .values({
          userId,
          amount: tokenAmount,
          type: 'purchase',
          status: 'completed',
          paymentId,
          timestamp: new Date()
        })
        .returning();

      console.log('Recorded token transaction:', transactionResult);

      return { 
        status: 'success', 
        balance: updateResult.newBalance,
        transaction: transactionResult
      };
    });

    console.log('Transaction completed successfully:', result);
    return result;

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