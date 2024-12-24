import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Check, Star } from 'lucide-react';
import PaymentFlow from '@/components/PaymentFlow';
import type { TokenPackage } from '@db/schema';

export default function TokenMarketplace() {
  const { toast } = useToast();
  const [selectedPackage, setSelectedPackage] = useState<TokenPackage | null>(null);
  const [paymentFlowOpen, setPaymentFlowOpen] = useState(false);

  const { data: packages = [], isLoading } = useQuery<TokenPackage[]>({
    queryKey: ['/api/tokens/packages'],
  });

  const handlePurchase = (pkg: TokenPackage) => {
    setSelectedPackage(pkg);
    setPaymentFlowOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">Token Marketplace</h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          Choose the perfect token package for your needs. Get more tokens at better rates with our larger packages.
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        {packages.map((pkg) => (
          <Card 
            key={pkg.id}
            className={`relative ${pkg.isPopular ? 'border-primary shadow-lg' : ''}`}
          >
            {pkg.isPopular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="bg-primary">
                  <Star className="h-4 w-4 mr-1" />
                  Most Popular
                </Badge>
              </div>
            )}
            <CardHeader>
              <CardTitle>{pkg.name}</CardTitle>
              <CardDescription>{pkg.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center mb-6">
                <span className="text-4xl font-bold">{pkg.tokenAmount}</span>
                <span className="text-muted-foreground"> tokens</span>
                <p className="text-2xl font-semibold mt-2">
                  ${pkg.price}
                </p>
              </div>
              <ul className="space-y-2">
                {(pkg.features as string[]).map((feature, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Button
                className="w-full"
                onClick={() => handlePurchase(pkg)}
              >
                Purchase Package
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      {selectedPackage && (
        <PaymentFlow
          open={paymentFlowOpen}
          onOpenChange={setPaymentFlowOpen}
          amount={selectedPackage.price}
          packageId={selectedPackage.id}
        />
      )}
    </div>
  );
}