import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { BlockchainLoader } from '@/components/BlockchainLoader';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, CreditCard, Percent } from 'lucide-react';
import { logErrorToServer } from '@/lib/errorLogging';

interface PriceInfo {
  basePrice: number;
  discount: number;
  finalPrice: number;
  tier: string;
}

export default function TokenMarketplace() {
  const { toast } = useToast();
  const [tokenAmount, setTokenAmount] = useState<number>(100);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pricing, setPricing] = useState<PriceInfo>({
    basePrice: 0,
    discount: 0,
    finalPrice: 0,
    tier: 'standard',
  });
  const [isPriceLoading, setIsPriceLoading] = useState(false);

  // Debounced price calculation
  useEffect(() => {
    const calculatePrice = async () => {
      try {
        setIsPriceLoading(true);

        if (!isValidAmount(tokenAmount)) {
          setPricing({ basePrice: 0, discount: 0, finalPrice: 0, tier: 'standard' });
          return;
        }

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
      } catch (error: any) {
        await logErrorToServer(error, 'price_calculation_failed');
        toast({
          variant: 'destructive',
          title: 'Price Calculation Error',
          description: 'Failed to calculate token price. Please try again.',
        });
      } finally {
        setIsPriceLoading(false);
      }
    };

    const timeoutId = setTimeout(() => {
      calculatePrice();
    }, 300); // Debounce for 300ms

    return () => clearTimeout(timeoutId);
  }, [tokenAmount, toast]);

  const handlePurchase = async () => {
    try {
      setIsProcessing(true);

      if (!isValidAmount(tokenAmount)) {
        throw new Error('Please enter a valid amount between 1 and 10,000 tokens');
      }

      console.log('Initiating purchase for', tokenAmount, 'tokens');

      const response = await fetch('/api/tokens/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amount: tokenAmount }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText);
      }

      const { checkoutUrl } = await response.json();

      if (!checkoutUrl) {
        throw new Error('No checkout URL received from server');
      }

      // Open in a popup window
      const popupWidth = 450;
      const popupHeight = 650;
      const left = (window.screen.width / 2) - (popupWidth / 2);
      const top = (window.screen.height / 2) - (popupHeight / 2);

      const popup = window.open(
        checkoutUrl,
        'Stripe Checkout',
        `width=${popupWidth},height=${popupHeight},left=${left},top=${top},toolbar=0,location=0,menubar=0`
      );

      if (!popup) {
        throw new Error('Popup was blocked. Please allow popups and try again.');
      }

      // Monitor popup status
      const checkPopup = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkPopup);
          setIsProcessing(false);
        }
      }, 500);

      toast({
        title: 'Checkout Started',
        description: 'Please complete your purchase in the popup window',
      });

    } catch (error: any) {
      console.error('[Token purchase failed] Error:', error);
      await logErrorToServer(error, 'token_purchase_failed');

      toast({
        variant: 'destructive',
        title: 'Purchase Failed',
        description: error.message || 'Failed to process payment. Please try again.',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const isValidAmount = (amount: number) => amount >= 1 && amount <= 10000;

  const handleAmountChange = (value: number) => {
    const clampedValue = Math.min(Math.max(Math.round(value), 1), 10000);
    setTokenAmount(clampedValue);
  };

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
                onValueChange={(values) => handleAmountChange(values[0])}
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
                    Volume Discount ({pricing.tier}):
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
            disabled={isProcessing || !isValidAmount(tokenAmount)}
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

          {!isValidAmount(tokenAmount) && (
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