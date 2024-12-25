import { useState, useEffect, useCallback } from 'react';
import { useUser } from '../hooks/use-user';
import { useBlockchain } from '../hooks/use-blockchain';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, Award, ArrowRightLeft, Database } from "lucide-react";
import { format } from 'date-fns';
import { Transaction } from '../lib/blockchain/types';
import { motion } from 'framer-motion';

interface GroupedTransactions {
  purchases: Transaction[];
  mining: Transaction[];
}

export default function WalletPage() {
  // Hooks - maintain consistent order
  const { user } = useUser();
  const { transactions, createTransaction, isLoading, balance } = useBlockchain();

  // State declarations
  const [amount, setAmount] = useState<number>(0);
  const [recipient, setRecipient] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Memoized handlers
  const groupTransactions = useCallback(() => {
    if (!transactions || !user?.username) {
      return { purchases: [], mining: [] };
    }

    return transactions.reduce<GroupedTransactions>((acc, tx) => {
      if (tx.from === user.username || tx.to === user.username) {
        if (tx.type === 'mint' && tx.from === 'SYSTEM') {
          tx.amount === 1 ? acc.mining.push(tx) : acc.purchases.push(tx);
        } else {
          acc.purchases.push(tx);
        }
      }
      return acc;
    }, { purchases: [], mining: [] });
  }, [transactions, user?.username]);

  const handleTransaction = useCallback(async () => {
    if (!user) {
      setError("Please login first");
      return;
    }

    if (amount <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    if (!recipient) {
      setError("Please enter a recipient address");
      return;
    }

    try {
      setError(null);
      setIsProcessing(true);
      await createTransaction({ to: recipient, amount });
      setAmount(0);
      setRecipient('');
    } catch (error: any) {
      setError(error.message);
    } finally {
      setIsProcessing(false);
    }
  }, [user, amount, recipient, createTransaction]);

  const { purchases, mining } = groupTransactions();

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" />
              Token Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{balance ?? 0}</p>
            <p className="text-sm text-muted-foreground">Available tokens</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Send Tokens</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Input
              placeholder="Recipient Address"
              value={recipient}
              onChange={(e) => {
                setError(null);
                setRecipient(e.target.value);
              }}
              disabled={isProcessing}
            />
            <Input
              type="number"
              placeholder="Amount"
              value={amount}
              onChange={(e) => {
                setError(null);
                setAmount(Number(e.target.value));
              }}
              disabled={isProcessing}
              min="0"
            />
            <Button
              onClick={handleTransaction}
              className="w-full"
              disabled={isProcessing || amount <= 0 || !recipient || !user}
            >
              {isProcessing ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  Processing Transaction...
                </>
              ) : (
                'Send Tokens'
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Transaction History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Transaction History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner size="lg" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Block Hash</TableHead>
                  <TableHead>Token IDs</TableHead>
                  <TableHead>Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...purchases, ...mining].map((tx, index) => (
                  <motion.tr
                    key={tx.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="border-b border-border hover:bg-muted/50"
                  >
                    <TableCell>
                      {format(new Date(tx.timestamp), 'MMM d, yyyy HH:mm')}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {tx.blockHash?.substring(0, 10)}...
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {tx.tokenIds?.map(id => id.substring(0, 6)).join(', ')}
                    </TableCell>
                    <TableCell className={tx.to === user?.username ? 'text-green-600' : 'text-red-600'}>
                      {tx.to === user?.username ? '+' : '-'}
                      {tx.amount}
                      {tx.type === 'mint' && tx.from === 'SYSTEM' && tx.amount === 1 ? ' (Mining Reward)' : ' Tokens'}
                    </TableCell>
                  </motion.tr>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}