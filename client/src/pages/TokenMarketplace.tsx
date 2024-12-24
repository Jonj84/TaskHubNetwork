import { useState } from 'react';
import { useTokens } from '@/hooks/use-tokens';
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
import { motion } from 'framer-motion';

export default function TokenMarketplace() {
  const { toast } = useToast();
  const [tokenAmount, setTokenAmount] = useState(100);
  const [isProcessing, setIsProcessing] = useState(false);
  const { purchaseTokens } = useTokens();

  // Calculate price with optional volume discounts
  const calculatePrice = (amount: number) => {
    const basePrice = amount * 0.1; // $0.10 per token
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

  const pricing = calculatePrice(tokenAmount);

  const handlePurchase = async () => {
    try {
      setIsProcessing(true);
      await purchaseTokens(tokenAmount);
      toast({
        title: 'Success',
        description: `Successfully purchased ${tokenAmount} tokens`,
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Purchase Failed',
        description: error.message,
      });
    } finally {
      setIsProcessing(false);
    }
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
          <div className="flex items-center gap-4">
            <Slider
              value={[tokenAmount]}
              onValueChange={(value) => setTokenAmount(value[0])}
              max={2000}
              min={1}
              step={1}
              className="flex-1"
            />
            <Input
              type="number"
              value={tokenAmount}
              onChange={(e) => setTokenAmount(Number(e.target.value))}
              className="w-24"
              min={1}
              max={2000}
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
              <span>${pricing.basePrice.toFixed(2)}</span>
            </div>

            {pricing.discount > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex justify-between text-sm text-green-500"
              >
                <span>Volume Discount:</span>
                <span>-{pricing.discount}%</span>
              </motion.div>
            )}

            <div className="border-t pt-2 flex justify-between font-medium">
              <span>Final Price:</span>
              <span>${pricing.finalPrice.toFixed(2)}</span>
            </div>
          </motion.div>

          <Button 
            onClick={handlePurchase}
            disabled={isProcessing || tokenAmount < 1}
            className="w-full relative overflow-hidden"
          >
            {isProcessing ? (
              <div className="flex items-center justify-center gap-2">
                <BlockchainLoader size="sm" />
                <span>Processing...</span>
              </div>
            ) : (
              `Purchase ${tokenAmount} Tokens`
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}