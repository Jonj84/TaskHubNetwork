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
import { Loader2, CreditCard, Bitcoin, Percent } from 'lucide-react';
import { BlockchainLoader } from '@/components/BlockchainLoader';
import { motion, AnimatePresence } from 'framer-motion';

interface PaymentFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  amount?: number;
  packageId?: number;
}

// Calculate price with volume discounts
function calculatePrice(tokenAmount: number): { price: number; discount: number } {
  const BASE_PRICE = 100; // $1.00 per token in cents
  let discount = 0;

  if (tokenAmount >= 1000) {
    discount = 20; // 20% discount
  } else if (tokenAmount >= 500) {
    discount = 10; // 10% discount
  }

  const baseTotal = tokenAmount * BASE_PRICE;
  const finalPrice = Math.floor(baseTotal * (1 - discount / 100));

  return { price: finalPrice, discount };
}

export default function PaymentFlow({
  open,
  onOpenChange,
  amount: defaultAmount,
  packageId,
}: PaymentFlowProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'crypto' | null>(null);
  const [tokenAmount, setTokenAmount] = useState<number>(defaultAmount || 100);
  const [price, setPrice] = useState({ price: 0, discount: 0 });

  // Update price whenever token amount changes
  useEffect(() => {
    setPrice(calculatePrice(tokenAmount));
  }, [tokenAmount]);

  const handleCardPayment = async () => {
    try {
      if (tokenAmount < 1 || tokenAmount > 10000) {
        toast({
          variant: 'destructive',
          title: 'Invalid Amount',
          description: 'Please enter a token amount between 1 and 10,000',
        });
        return;
      }

      setIsProcessing(true);

      const response = await fetch('/api/payments/create-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(
          packageId 
            ? { packageId } 
            : { customAmount: tokenAmount }
        ),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const { sessionId } = await response.json();
      const stripe = await loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY);

      if (!stripe) {
        throw new Error('Failed to load Stripe');
      }

      await stripe.redirectToCheckout({ sessionId });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Payment Error',
        description: error.message || 'Failed to process payment',
      });
      setIsProcessing(false);
    }
  };

  const handleCryptoPayment = async () => {
    try {
      if (tokenAmount < 1 || tokenAmount > 10000) {
        toast({
          variant: 'destructive',
          title: 'Invalid Amount',
          description: 'Please enter a token amount between 1 and 10,000',
        });
        return;
      }

      setIsProcessing(true);
      const response = await fetch('/api/payments/crypto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amount: tokenAmount }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const { paymentAddress, amount, currency } = await response.json();

      toast({
        title: 'Crypto Payment',
        description: `Please send ${amount} ${currency} to ${paymentAddress}`,
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Payment Error',
        description: error.message || 'Failed to generate crypto payment',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Purchase Tokens</DialogTitle>
          <DialogDescription>
            Adjust the slider to select your desired amount of tokens
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          <div className="space-y-4">
            <Label htmlFor="token-amount">Token Amount</Label>
            <div className="flex items-center gap-4">
              <Slider
                id="token-amount"
                max={10000}
                min={1}
                step={10}
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

            <motion.div 
              className="rounded-lg bg-muted p-4 space-y-2"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="flex justify-between text-sm">
                <span>Base Price:</span>
                <span>${(tokenAmount).toFixed(2)}</span>
              </div>

              <AnimatePresence>
                {price.discount > 0 && (
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
                    <span>-{price.discount}%</span>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="border-t pt-2 flex justify-between font-medium">
                <span>Final Price:</span>
                <span>${(price.price / 100).toFixed(2)}</span>
              </div>
            </motion.div>
          </div>

          <div className="space-y-2">
            <Button
              onClick={() => {
                setPaymentMethod('card');
                handleCardPayment();
              }}
              disabled={isProcessing}
              className="w-full flex items-center justify-center gap-2"
            >
              {isProcessing && paymentMethod === 'card' ? (
                <BlockchainLoader size="sm" />
              ) : (
                <CreditCard className="h-4 w-4" />
              )}
              Pay with Card
            </Button>

            <Button
              onClick={() => {
                setPaymentMethod('crypto');
                handleCryptoPayment();
              }}
              disabled={isProcessing}
              variant="outline"
              className="w-full flex items-center justify-center gap-2"
            >
              {isProcessing && paymentMethod === 'crypto' ? (
                <BlockchainLoader size="sm" />
              ) : (
                <Bitcoin className="h-4 w-4" />
              )}
              Pay with Crypto
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}