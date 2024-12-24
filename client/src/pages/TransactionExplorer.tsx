import { useEffect, useState } from 'react';
import { useBlockchain } from '../hooks/use-blockchain';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Transaction } from '../lib/blockchain/Block';

export default function TransactionExplorer() {
  const { transactions, isLoading } = useBlockchain();
  const [animatingTx, setAnimatingTx] = useState<Transaction | null>(null);

  // Watch for new transactions to trigger animations
  useEffect(() => {
    if (transactions.length > 0) {
      const latestTx = transactions[transactions.length - 1];
      setAnimatingTx(latestTx);
      const timer = setTimeout(() => setAnimatingTx(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [transactions]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Transaction Explorer</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Transaction Flow Visualization */}
          <div className="relative h-[400px] bg-muted/10 rounded-lg p-4">
            {/* Nodes representing users/addresses */}
            <div className="absolute inset-0 flex items-center justify-around">
              {transactions.slice(-5).map((tx, index) => (
                <div key={index} className="relative">
                  {/* Sender Node */}
                  <motion.div
                    className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold"
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    whileHover={{ scale: 1.1 }}
                  >
                    {tx.from.slice(0, 2)}
                  </motion.div>
                  
                  {/* Animated Transaction Flow */}
                  <AnimatePresence>
                    {animatingTx && animatingTx === tx && (
                      <motion.div
                        className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        transition={{ duration: 0.5 }}
                      >
                        <div className="px-3 py-1 rounded-full bg-accent text-accent-foreground text-sm">
                          {tx.amount} tokens
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Recipient Node */}
                  <motion.div
                    className="absolute left-32 w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-secondary-foreground font-bold"
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    whileHover={{ scale: 1.1 }}
                  >
                    {tx.to.slice(0, 2)}
                  </motion.div>
                </div>
              ))}
            </div>
          </div>

          {/* Transaction List */}
          <div className="mt-6 space-y-4">
            {transactions.map((tx, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="p-4 rounded-lg border border-border bg-card"
              >
                <div className="flex justify-between items-center">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      From: {tx.from}
                    </p>
                    <p className="text-sm font-medium">
                      To: {tx.to}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold">{tx.amount} tokens</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(tx.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
