import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { BlockchainLoader } from '@/components/BlockchainLoader';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, CreditCard, Percent } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY);

interface PriceInfo {
  basePrice: number;
  discount: number;
  finalPrice: number;
}

export default function TokenMarketplace() {
  const { toast } = useToast();
  const [tokenAmount, setTokenAmount] = useState(100);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pricing, setPricing] = useState<PriceInfo>({ basePrice: 10, discount: 0, finalPrice: 10 });

  // Calculate price with volume discounts
  const calculatePrice = (amount: number): PriceInfo => {
    const basePrice = amount; // $1.00 per token
    let discount = 0;

    if (amount >= 1000) {
      discount = 20; // 20% discount
    } else if (amount >= 500) {
      discount = 10; // 10% discount
    }

    return {
      basePrice,
      discount,
      finalPrice: basePrice * (1 - discount / 100)
    };
  };

  // Update price whenever token amount changes
  useEffect(() => {
    setPricing(calculatePrice(tokenAmount));
  }, [tokenAmount]);

  const handlePurchase = async () => {
    try {
      setIsProcessing(true);

      // Create Stripe checkout session
      const response = await fetch('/api/tokens/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amount: tokenAmount }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const { sessionId } = await response.json();

      // Get Stripe instance
      const stripe = await stripePromise;
      if (!stripe) {
        throw new Error('Failed to load Stripe');
      }

      // Redirect to Stripe Checkout
      const result = await stripe.redirectToCheckout({
        sessionId,
      });

      if (result.error) {
        throw new Error(result.error.message);
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Purchase Failed',
        description: error.message || 'Failed to process payment',
      });
      setIsProcessing(false);
    }
  };

  const handleAmountChange = (value: number) => {
    // Clamp value between 1 and 10000
    const clampedValue = Math.min(Math.max(Math.round(value), 1), 10000);
    setTokenAmount(clampedValue);
  };

  const isValidAmount = tokenAmount >= 1 && tokenAmount <= 10000;

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">Purchase Tokens</h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          Select the amount of tokens you want to purchase. Get volume discounts on larger purchases.
        </p>
      </div>

      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>Token Amount</CardTitle>
          <CardDescription>
            Adjust the slider or enter a value to select your desired amount of tokens
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col space-y-4">
            <div className="flex items-center gap-4">
              <Slider
                value={[tokenAmount]}
                onValueChange={(value) => handleAmountChange(value[0])}
                max={10000}
                min={1}
                step={1}
                className="flex-1"
              />
              <Input
                type="number"
                value={tokenAmount}
                onChange={(e) => handleAmountChange(Number(e.target.value))}
                className="w-24"
                min={1}
                max={10000}
              />
            </div>

            {/* Discount thresholds information */}
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Volume Discounts:</span>
              <div className="space-x-4">
                <span>500+ tokens: 10% off</span>
                <span>1000+ tokens: 20% off</span>
              </div>
            </div>
          </div>

          <motion.div 
            className="rounded-lg bg-muted p-4 space-y-2"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex justify-between text-sm">
              <span>Base Price:</span>
              <motion.span
                key={pricing.basePrice}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
              >
                ${pricing.basePrice.toFixed(2)}
              </motion.span>
            </div>

            <AnimatePresence>
              {pricing.discount > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex justify-between text-sm text-green-500"
                >
                  <span className="flex items-center gap-1">
                    <Percent className="h-4 w-4" />
                    Volume Discount:
                  </span>
                  <span>-{pricing.discount}%</span>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="border-t pt-2 mt-2">
              <div className="flex justify-between font-medium text-lg">
                <span>Final Price:</span>
                <motion.span
                  key={pricing.finalPrice}
                  initial={{ scale: 1.1 }}
                  animate={{ scale: 1 }}
                  className="text-primary"
                >
                  ${pricing.finalPrice.toFixed(2)}
                </motion.span>
              </div>
            </div>
          </motion.div>

          <Button 
            onClick={handlePurchase}
            disabled={isProcessing || !isValidAmount}
            className="w-full relative"
          >
            {isProcessing ? (
              <div className="flex items-center justify-center gap-2">
                <BlockchainLoader size="sm" />
                <span>Processing Purchase...</span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2">
                <CreditCard className="h-5 w-5" />
                <span>Purchase {tokenAmount} Tokens</span>
              </div>
            )}
          </Button>

          {/* Validation message */}
          {!isValidAmount && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              <span>Please enter a valid amount between 1 and 10,000 tokens</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}