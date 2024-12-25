import { useBlockchain } from '../hooks/use-blockchain';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Coins } from 'lucide-react';

export function TokenBalanceCard() {
  const { balance, isLoading, transactions = [] } = useBlockchain();
  const recentTransactions = transactions.slice(0, 4);

  return (
    <Card className="bg-white shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-medium flex items-center gap-2">
          <Coins className="h-5 w-5 text-primary" />
          Token Balance
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex flex-col">
            <span className="text-3xl font-bold">
              {isLoading ? (
                <span className="text-muted-foreground">Loading...</span>
              ) : (
                balance.toLocaleString()
              )}
            </span>
            <span className="text-sm text-muted-foreground">Available tokens</span>
          </div>
          
          <div className="flex flex-wrap gap-2">
            {recentTransactions.map((tx) => (
              <div
                key={tx.id}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  tx.amount > 0 ? 'text-green-700 bg-green-100' : 'text-red-700 bg-red-100'
                }`}
              >
                {tx.amount > 0 ? '+' : '-'} {Math.abs(tx.amount)}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
