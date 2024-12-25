import { useQuery } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { format } from 'date-fns';
import { Loader2, TrendingUp, History, CreditCard } from 'lucide-react';
import { motion } from 'framer-motion';
import { TransactionFlowChart } from '@/components/TransactionFlowChart';
import { type TokenTransaction } from '@/hooks/use-tokens';

interface Insights {
  totalSpent: number;
  totalTransactions: number;
  avgPurchaseSize: number;
}

interface TokenHistoryResponse {
  transactions: TokenTransaction[];
  insights: Insights;
}

export default function TokenHistory() {
  const { data, isLoading, isError } = useQuery<TokenHistoryResponse>({
    queryKey: ['/api/tokens/history'],
  });

  if (isLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading transaction history...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="container mx-auto py-8">
        <Card className="bg-destructive/10">
          <CardContent className="pt-6">
            <p className="text-center text-destructive">Failed to load transaction history</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const insights = data?.insights;
  const transactions = data?.transactions || [];

  return (
    <div className="min-h-screen bg-gray-50/50">
      <div className="container mx-auto py-12 px-4 space-y-12">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-4">Token History</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Track your token transactions and visualize token flows across the network
          </p>
        </div>

        {/* Flow Chart Visualization */}
        <Card className="overflow-hidden border-none shadow-lg">
          <CardHeader className="bg-primary/5 border-b">
            <CardTitle>Transaction Flow Visualization</CardTitle>
            <CardDescription>
              Interactive visualization of token movements between addresses
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <TransactionFlowChart transactions={transactions} height={500} />
          </CardContent>
        </Card>

        {/* Insights Grid */}
        {insights && (
          <div className="grid gap-6 md:grid-cols-3">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <Card className="hover:shadow-md transition-shadow">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Total Tokens Purchased
                  </CardTitle>
                  <TrendingUp className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{insights.totalSpent}</div>
                  <p className="text-xs text-muted-foreground">
                    Lifetime token purchases
                  </p>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
            >
              <Card className="hover:shadow-md transition-shadow">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Total Transactions
                  </CardTitle>
                  <History className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{insights.totalTransactions}</div>
                  <p className="text-xs text-muted-foreground">
                    Number of transactions processed
                  </p>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
            >
              <Card className="hover:shadow-md transition-shadow">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Average Transaction Size
                  </CardTitle>
                  <CreditCard className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{insights.avgPurchaseSize}</div>
                  <p className="text-xs text-muted-foreground">
                    Average tokens per transaction
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        )}

        {/* Transaction History Table */}
        <Card className="shadow-lg border-none">
          <CardHeader className="bg-primary/5 border-b">
            <CardTitle>Transaction History</CardTitle>
            <CardDescription>
              Detailed record of all your token transactions
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[200px]">Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((transaction) => (
                    <TableRow key={transaction.id} className="hover:bg-primary/5">
                      <TableCell className="font-medium">
                        {format(new Date(transaction.timestamp), 'MMM d, yyyy h:mm a')}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                          ${transaction.type === 'purchase' ? 'bg-green-100 text-green-800' :
                          transaction.type === 'escrow' ? 'bg-yellow-100 text-yellow-800' :
                          transaction.type === 'release' ? 'bg-blue-100 text-blue-800' :
                          'bg-gray-100 text-gray-800'}`}>
                          {transaction.type}
                        </span>
                      </TableCell>
                      <TableCell>{transaction.amount} tokens</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
                          ${transaction.status === 'completed' ? 'bg-green-100 text-green-800' :
                          transaction.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'}`}>
                          {transaction.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                  {transactions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="h-32">
                        <div className="flex flex-col items-center justify-center text-center">
                          <History className="h-8 w-8 text-muted-foreground/50 mb-2" />
                          <p className="text-muted-foreground font-medium">No transactions found</p>
                          <p className="text-sm text-muted-foreground">Your transaction history will appear here</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}