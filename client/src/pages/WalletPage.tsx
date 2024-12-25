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
import { AlertTriangle, ArrowRightLeft, History } from "lucide-react";
import { format } from 'date-fns';
import { Transaction } from '../lib/blockchain/types';
import { motion } from 'framer-motion';
import { TokenBrowser } from '@/components/TokenBrowser';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

interface GroupedTransactions {
  purchases: Transaction[];
  mining: Transaction[];
}

export default function WalletPage() {
  // Hooks
  const { user } = useUser();
  const { transactions = [], tokens = [], createTransaction, isLoading, balance } = useBlockchain();

  // State
  const [amount, setAmount] = useState<number>(0);
  const [recipient, setRecipient] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Debug logging
  useEffect(() => {
    console.log('[Balance] Starting balance calculation for:', user?.username);
    console.log('[Balance] Token status for address:', {
      address: user?.username,
      balance: balance
    });
  }, [balance, user?.username]);

  // Memoized handlers
  const groupTransactions = useCallback(() => {
    if (!Array.isArray(transactions) || !user?.username) {
      console.log('[WalletPage] No transactions or user:', { transactions, username: user?.username });
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
      console.log('[WalletPage] Creating transaction:', { recipient, amount });
      await createTransaction({ to: recipient, amount });
      setAmount(0);
      setRecipient('');
    } catch (error: any) {
      console.error('[WalletPage] Transaction failed:', error);
      setError(error.message);
    } finally {
      setIsProcessing(false);
    }
  }, [user, amount, recipient, createTransaction]);

  const { purchases, mining } = groupTransactions();
  const displayBalance = balance || 0;

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="grid gap-4 md:grid-cols-2">
        {/* Balance Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5" />
              Token Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{displayBalance}</p>
            <p className="text-sm text-muted-foreground">Available tokens</p>
          </CardContent>
        </Card>

        {/* Send Tokens Card */}
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

      {/* Tabs for Transaction History and Token Browser */}
      <Tabs defaultValue="transactions" className="mt-8">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="transactions">Transaction History</TabsTrigger>
          <TabsTrigger value="tokens">Token Browser</TabsTrigger>
        </TabsList>

        <TabsContent value="transactions">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
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
                      <TableHead>Type</TableHead>
                      <TableHead>From/To</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...purchases, ...mining]
                      .sort((a, b) => b.timestamp - a.timestamp)
                      .map((tx, index) => (
                      <motion.tr
                        key={tx.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.1 }}
                        className="group border-b border-border hover:bg-muted/50"
                      >
                        <TableCell>
                          {format(new Date(tx.timestamp), 'MMM d, yyyy HH:mm')}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium
                            ${tx.type === 'mint' ? 'bg-blue-100 text-blue-800' :
                            tx.type === 'escrow' ? 'bg-yellow-100 text-yellow-800' :
                            tx.type === 'release' ? 'bg-green-100 text-green-800' :
                            'bg-gray-100 text-gray-800'}`}>
                            {tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {tx.to === user?.username ? 
                            <span className="text-green-600">From: {tx.from}</span> :
                            <span className="text-red-600">To: {tx.to}</span>
                          }
                        </TableCell>
                        <TableCell className={`text-right font-medium ${
                          tx.to === user?.username ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {tx.to === user?.username ? '+' : '-'}
                          {tx.amount}
                        </TableCell>
                      </motion.tr>
                    ))}
                    {transactions.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                          No transactions found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tokens">
          <TokenBrowser tokens={tokens} isLoading={isLoading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}