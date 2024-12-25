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

    // First create a PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: priceInCents,
      currency: 'usd',
      payment_method_types: ['card'],
      metadata: {
        tokenAmount: amount.toString(),
        userId: (req as any).user?.id?.toString(),
        tier
      }
    });

    // Then create a checkout session linked to the PaymentIntent
    const session = await stripe.checkout.sessions.create({
      payment_intent: paymentIntent.id,
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
      ui_mode: 'embedded',
      return_url: `${req.protocol}://${req.get('host')}/payment/success`,
      metadata: {
        tokenAmount: amount.toString(),
        userId: (req as any).user?.id?.toString(),
        tier
      },
    });

    console.log('Stripe session created:', {
      sessionId: session.id,
      clientSecret: paymentIntent.client_secret
    });

    // Return the PaymentIntent client secret
    res.json({ 
      clientSecret: paymentIntent.client_secret,
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

    if (!session) {
      throw new Error('Payment session not found');
    }

    // Check payment status
    if (session.payment_status !== 'paid') {
      return res.status(400).json({
        message: 'Payment has not been completed',
        status: session.payment_status
      });
    }

    const { tokenAmount, userId } = session.metadata || {};

    if (!tokenAmount) {
      throw new Error('Missing token amount in session metadata');
    }

    // Return success response
    res.json({
      success: true,
      tokenAmount: parseInt(tokenAmount, 10),
      paymentId: session.payment_intent as string
    });

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
      const { tokenAmount, userId } = session.metadata || {};

      if (!tokenAmount) {
        throw new Error("Missing metadata in Stripe session");
      }

      console.log('Payment completed:', {
        tokenAmount,
        userId,
        sessionId: session.id
      });

      // Credit tokens to user account will be implemented in the next step
      // This ensures the transaction is recorded even if the success page isn't visited
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