import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/hooks/use-toast';
import { CreditCard, Bitcoin, Percent } from 'lucide-react';
import { BlockchainLoader } from '@/components/BlockchainLoader';
import { motion, AnimatePresence } from 'framer-motion';

interface PaymentFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  amount?: number;
}

interface PricingInfo {
  basePrice: number;
  discount: number;
  finalPrice: number;
  tier: string;
}

export default function PaymentFlow({
  open,
  onOpenChange,
  amount: defaultAmount,
}: PaymentFlowProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'crypto' | null>(null);
  const [tokenAmount, setTokenAmount] = useState<number>(defaultAmount || 100);
  const [pricing, setPricing] = useState<PricingInfo>({
    basePrice: 0,
    discount: 0,
    finalPrice: 0,
    tier: 'standard'
  });

  // Update price whenever token amount changes
  useEffect(() => {
    const calculatePrice = async () => {
      try {
        const response = await fetch('/api/tokens/calculate-price', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ amount: tokenAmount }),
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const data = await response.json();
        setPricing(data);
      } catch (error) {
        console.error('Failed to calculate price:', error);
        toast({
          variant: 'destructive',
          title: 'Price Calculation Error',
          description: 'Failed to calculate token price. Please try again.',
        });
      }
    };

    if (isValidAmount(tokenAmount)) {
      calculatePrice();
    }
  }, [tokenAmount]);

  const handleCardPayment = async () => {
    try {
      if (!isValidAmount(tokenAmount)) {
        toast({
          variant: 'destructive',
          title: 'Invalid Amount',
          description: 'Please enter a token amount between 1 and 10,000',
        });
        return;
      }

      setIsProcessing(true);

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
      const stripe = await loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY);

      if (!stripe) {
        throw new Error('Failed to load Stripe');
      }

      // Handle the redirect
      const { error } = await stripe.redirectToCheckout({ sessionId });

      if (error) {
        throw new Error(error.message);
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Payment Failed',
        description: error.message || 'Failed to process payment',
      });
      setIsProcessing(false);
    }
  };

  const isValidAmount = (amount: number) => {
    return amount >= 1 && amount <= 10000;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Purchase Tokens</DialogTitle>
          <DialogDescription>
            Select your desired amount of tokens. Volume discounts available!
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          <div className="space-y-4">
            <Label>Token Amount</Label>
            <div className="flex items-center gap-4">
              <Slider
                max={10000}
                min={1}
                step={1}
                value={[tokenAmount]}
                onValueChange={(value) => setTokenAmount(value[0])}
                className="flex-1"
              />
              <Input
                type="number"
                value={tokenAmount}
                onChange={(e) => setTokenAmount(Number(e.target.value))}
                className="w-20"
                min={1}
                max={10000}
              />
            </div>

            {/* Volume discount information */}
            <div className="text-sm text-muted-foreground">
              <div>Volume Discounts:</div>
              <div>• 500+ tokens: 10% off</div>
              <div>• 1000+ tokens: 20% off</div>
            </div>

            <motion.div 
              className="rounded-lg bg-muted p-4 space-y-2"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="flex justify-between text-sm">
                <span>Base Price:</span>
                <span>${pricing.basePrice.toFixed(2)}</span>
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
                      Volume Discount ({pricing.tier}):
                    </span>
                    <span>-{pricing.discount}%</span>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="border-t pt-2 flex justify-between font-medium">
                <span>Final Price:</span>
                <span>${pricing.finalPrice.toFixed(2)}</span>
              </div>
            </motion.div>
          </div>

          <Button 
            onClick={handleCardPayment}
            disabled={isProcessing || !isValidAmount(tokenAmount)}
            className="w-full flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <BlockchainLoader size="sm" />
            ) : (
              <CreditCard className="h-4 w-4" />
            )}
            {isProcessing ? 'Processing...' : 'Purchase Tokens'}
          </Button>

          {!isValidAmount(tokenAmount) && (
            <p className="text-sm text-destructive">
              Please enter a valid amount between 1 and 10,000 tokens
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}