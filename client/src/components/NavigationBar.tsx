import { Link } from 'wouter';
import { useUser } from '../hooks/use-user';
import { useBlockchain } from '../hooks/use-blockchain';
import { Button } from '@/components/ui/button';
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuLink,
} from '@/components/ui/navigation-menu';
import { useToast } from '@/hooks/use-toast';
import { Coins } from 'lucide-react';
import { format } from 'date-fns';

export default function NavigationBar() {
  const { user, logout } = useUser();
  const { balance, isLoading, transactions = [] } = useBlockchain();
  const { toast } = useToast();

  const handleLogout = async () => {
    try {
      await logout();
      toast({
        title: 'Success',
        description: 'Logged out successfully',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message,
      });
    }
  };

  const recentTransactions = transactions.slice(0, 4);

  return (
    <div className="border-b">
      <div className="container mx-auto px-4 py-2 flex justify-between items-center">
        <NavigationMenu>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Link href="/" className="font-bold">
                  Task Platform
                </Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Link href="/tasks">Tasks</Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Link href="/wallet">Wallet</Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink asChild>
                <Link href="/explorer">Explorer</Link>
              </NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="px-3 py-1.5 bg-primary/5 rounded-full flex items-center gap-2">
              <Coins className="h-4 w-4 text-primary" />
              <span className="font-medium">
                {isLoading ? (
                  <span className="text-muted-foreground">Loading...</span>
                ) : (
                  `${balance.toLocaleString()} tokens`
                )}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {recentTransactions.map((tx) => (
                <div 
                  key={tx.id} 
                  className={`px-2 py-1 rounded text-xs font-medium ${
                    tx.amount > 0 ? 'text-green-700 bg-green-100' : 'text-red-700 bg-red-100'
                  }`}
                >
                  {tx.amount > 0 ? '+' : '-'} {Math.abs(tx.amount)}
                </div>
              ))}
            </div>
          </div>

          <Button variant="default" asChild className="gap-2">
            <Link href="/marketplace">
              <Coins className="h-4 w-4" />
              Purchase Tokens
            </Link>
          </Button>
          <span className="text-sm text-muted-foreground">{user?.username}</span>
          <Button variant="outline" onClick={handleLogout}>
            Logout
          </Button>
        </div>
      </div>
    </div>
  );
}