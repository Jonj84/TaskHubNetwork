import { useState, useEffect, useCallback } from 'react';
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
import { CreditCard, Percent } from 'lucide-react';
import { BlockchainLoader } from '@/components/BlockchainLoader';
import { motion, AnimatePresence } from 'framer-motion';
import { logErrorToServer } from '@/lib/errorLogging';

interface PaymentFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  amount?: number;
}

export default function PaymentFlow({
  open,
  onOpenChange,
  amount: defaultAmount,
}: PaymentFlowProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const [tokenAmount, setTokenAmount] = useState<number>(defaultAmount || 100);
  const [pricing, setPricing] = useState({
    basePrice: 0,
    discount: 0,
    finalPrice: 0,
    tier: 'standard'
  });

  const calculatePrice = useCallback(async (amount: number) => {
    if (!isValidAmount(amount)) return;

    try {
      const response = await fetch('/api/tokens/calculate-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amount }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = await response.json();
      setPricing(data);
    } catch (error) {
      console.error('Failed to calculate price:', error);
      await logErrorToServer(error as Error, 'price_calculation_failed');
    }
  }, []);

  useEffect(() => {
    let isSubscribed = true;
    const timer = setTimeout(() => {
      if (isSubscribed) {
        calculatePrice(tokenAmount);
      }
    }, 300);

    return () => {
      isSubscribed = false;
      clearTimeout(timer);
    };
  }, [tokenAmount, calculatePrice]);

  const handleCardPayment = async () => {
    try {
      if (!isValidAmount(tokenAmount)) {
        throw new Error('Invalid token amount');
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

      const { checkoutUrl } = await response.json();

      if (!checkoutUrl) {
        throw new Error('No checkout URL received');
      }

      // Open Stripe checkout in a popup window
      const popupWidth = 450;
      const popupHeight = 650;
      const left = (window.screen.width / 2) - (popupWidth / 2);
      const top = (window.screen.height / 2) - (popupHeight / 2);

      const popup = window.open(
        checkoutUrl,
        'Stripe Checkout',
        `width=${popupWidth},height=${popupHeight},left=${left},top=${top}`
      );

      if (!popup) {
        throw new Error('Popup was blocked. Please allow popups and try again.');
      }

      onOpenChange(false);

      // Monitor popup status
      const checkPopup = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkPopup);
          toast({
            title: 'Payment Complete',
            description: 'Your tokens will be credited to your account shortly.',
          });
        }
      }, 500);

    } catch (error: any) {
      await logErrorToServer(error, 'payment_initiation_failed');
      toast({
        variant: 'destructive',
        title: 'Payment Failed',
        description: error.message || 'Failed to process payment. Please try again.',
      });
    } finally {
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