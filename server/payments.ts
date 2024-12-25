import { type Request, Response } from "express";
import Stripe from "stripe";
import { db } from "@db";
import { tokenTransactions, users, tokenProcessingQueue } from "@db/schema";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {blockchainService} from './blockchain';

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
    const host = req.get('host');
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
      successUrl: session.success_url,
      cancelUrl: session.cancel_url
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

    const { tokenAmount, userId } = session.metadata || {};

    if (!tokenAmount || !userId) {
      console.error('Missing metadata:', {
        sessionId,
        metadata: session.metadata
      });
      throw new Error('Missing required metadata in session');
    }

    const result = await db.transaction(async (tx) => {
      const existingQueue = await tx
        .select()
        .from(tokenProcessingQueue)
        .where(eq(tokenProcessingQueue.paymentId, session.payment_intent as string))
        .limit(1);

      if (existingQueue.length > 0) {
        return {
          status: 'already_queued',
          queueItem: existingQueue[0]
        };
      }

      const [queueEntry] = await tx
        .insert(tokenProcessingQueue)
        .values({
          userId: parseInt(userId, 10),
          amount: parseInt(tokenAmount, 10),
          paymentId: session.payment_intent as string,
          metadata: {
            sessionId,
            paymentIntent: session.payment_intent,
            customerEmail: session.customer_details?.email,
            purchaseDate: new Date().toISOString(),
            tokenSpecifications: {
              tier: session.metadata?.tier || 'standard',
              generationType: 'purchase',
              source: 'stripe'
            }
          }
        })
        .returning();

      return {
        status: 'queued',
        queueEntry
      };
    });

    if (result.status === 'already_queued') {
      res.json({
        success: true,
        status: 'processing',
        message: 'Your tokens are being processed',
        queueId: result.queueItem?.id
      });
    } else {
      res.json({
        success: true,
        status: 'queued',
        message: 'Your token generation has been queued',
        queueId: result.queueEntry?.id
      });
    }

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

// Token processing function - should be called by a background job
async function processTokenGeneration(queueId: number) {
  try {
    const result = await db.transaction(async (tx) => {
      // Get queue entry and lock it
      const [queueEntry] = await tx
        .select()
        .from(tokenProcessingQueue)
        .where(eq(tokenProcessingQueue.id, queueId))
        .limit(1);

      if (!queueEntry || queueEntry.status === 'completed') {
        return null;
      }

      // Update queue status to processing
      await tx
        .update(tokenProcessingQueue)
        .set({ status: 'processing', updated_at: new Date() })
        .where(eq(tokenProcessingQueue.id, queueId));

      try {
        // Generate blockchain transaction
        const [user] = await tx
          .select()
          .from(users)
          .where(eq(users.id, queueEntry.userId))
          .limit(1);

        const blockchainTx = await blockchainService.createTransaction(
          'SYSTEM',
          user.username,
          queueEntry.amount
        );

        // Update user's balance
        const [updatedUser] = await tx
          .update(users)
          .set({
            tokenBalance: user.tokenBalance + queueEntry.amount,
            updated_at: new Date()
          })
          .where(eq(users.id, queueEntry.userId))
          .returning();

        // Create transaction record
        const [transaction] = await tx
          .insert(tokenTransactions)
          .values({
            userId: queueEntry.userId,
            amount: queueEntry.amount,
            type: 'purchase',
            status: 'completed',
            paymentId: queueEntry.paymentId,
            fromAddress: 'SYSTEM',
            toAddress: user.username,
            blockHash: blockchainTx?.hash,
            metadata: queueEntry.metadata,
            timestamp: new Date()
          })
          .returning();

        // Mark queue entry as completed
        await tx
          .update(tokenProcessingQueue)
          .set({
            status: 'completed',
            updated_at: new Date()
          })
          .where(eq(tokenProcessingQueue.id, queueId));

        return {
          success: true,
          transaction,
          user: updatedUser
        };
      } catch (error: any) {
        // Update queue entry with error
        await tx
          .update(tokenProcessingQueue)
          .set({
            status: 'failed',
            error: error.message,
            retryCount: queueEntry.retryCount + 1,
            updated_at: new Date()
          })
          .where(eq(tokenProcessingQueue.id, queueId));

        throw error;
      }
    });

    return result;
  } catch (error) {
    console.error('Token processing error:', error);
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