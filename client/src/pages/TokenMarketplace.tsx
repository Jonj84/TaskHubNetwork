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
import { motion } from 'framer-motion';
import { useTheme } from '@/hooks/use-theme';

export default function TokenMarketplace() {
  const { toast } = useToast();
  const [selectedPackage, setSelectedPackage] = useState<TokenPackage | null>(null);
  const [paymentFlowOpen, setPaymentFlowOpen] = useState(false);
  const [hoveredCard, setHoveredCard] = useState<number | null>(null);
  const { theme } = useTheme();

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

      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3 perspective-[1000px]">
        {packages.map((pkg) => (
          <motion.div
            key={pkg.id}
            initial={{ scale: 1 }}
            whileHover={{ 
              scale: 1.05,
              rotateY: 5,
              z: 50,
            }}
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 20
            }}
            onHoverStart={() => setHoveredCard(pkg.id)}
            onHoverEnd={() => setHoveredCard(null)}
            style={{
              transformStyle: "preserve-3d",
            }}
          >
            <Card 
              className={`relative transition-shadow duration-300 ${
                pkg.isPopular ? 'border-primary shadow-lg' : ''
              } ${
                hoveredCard === pkg.id
                  ? 'shadow-2xl ring-2 ring-primary/20'
                  : 'hover:shadow-xl'
              }`}
            >
              {pkg.isPopular && (
                <motion.div 
                  className="absolute -top-3 left-1/2 -translate-x-1/2"
                  animate={{ 
                    y: hoveredCard === pkg.id ? -8 : -4,
                    scale: hoveredCard === pkg.id ? 1.1 : 1,
                  }}
                  transition={{ type: "spring", stiffness: 400, damping: 17 }}
                >
                  <Badge className="bg-primary shadow-lg">
                    <Star className="h-4 w-4 mr-1" />
                    Most Popular
                  </Badge>
                </motion.div>
              )}
              <CardHeader>
                <CardTitle>{pkg.name}</CardTitle>
                <CardDescription>{pkg.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <motion.div 
                  className="text-center mb-6"
                  animate={{ 
                    scale: hoveredCard === pkg.id ? 1.1 : 1,
                    y: hoveredCard === pkg.id ? -4 : 0,
                  }}
                  transition={{ type: "spring", stiffness: 300, damping: 15 }}
                >
                  <span className="text-4xl font-bold">{pkg.tokenAmount}</span>
                  <span className="text-muted-foreground"> tokens</span>
                  <p className="text-2xl font-semibold mt-2">
                    ${(pkg.price / 100).toFixed(2)}
                  </p>
                </motion.div>
                <ul className="space-y-2">
                  {(pkg.features as string[]).map((feature, index) => (
                    <motion.li 
                      key={index} 
                      className="flex items-center gap-2"
                      initial={{ x: 0 }}
                      animate={{ 
                        x: hoveredCard === pkg.id ? 4 : 0,
                      }}
                      transition={{ delay: index * 0.1 }}
                    >
                      <Check className="h-4 w-4 text-green-500" />
                      <span>{feature}</span>
                    </motion.li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full relative overflow-hidden group"
                  onClick={() => handlePurchase(pkg)}
                >
                  <motion.div
                    className="absolute inset-0 bg-primary/10"
                    initial={{ scale: 0, opacity: 0 }}
                    whileHover={{ scale: 2, opacity: 1 }}
                    transition={{ duration: 0.5 }}
                  />
                  Purchase Package
                </Button>
              </CardFooter>
            </Card>
          </motion.div>
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