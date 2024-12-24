import { Link } from 'wouter';
import { useUser } from '../hooks/use-user';
import { Button } from '@/components/ui/button';
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuList,
  NavigationMenuLink,
} from '@/components/ui/navigation-menu';
import { useToast } from '@/hooks/use-toast';
import { Coins } from 'lucide-react';

export default function NavigationBar() {
  const { user, logout } = useUser();
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

  return (
    <div className="border-b">
      <div className="container mx-auto px-4 py-2 flex justify-between items-center">
        <NavigationMenu>
          <NavigationMenuList>
            <NavigationMenuItem>
              <Link href="/">
                <NavigationMenuLink className="font-bold">
                  Task Platform
                </NavigationMenuLink>
              </Link>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <Link href="/tasks">
                <NavigationMenuLink>Tasks</NavigationMenuLink>
              </Link>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <Link href="/wallet">
                <NavigationMenuLink>Wallet</NavigationMenuLink>
              </Link>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <Link href="/explorer">
                <NavigationMenuLink>Explorer</NavigationMenuLink>
              </Link>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            <Coins className="h-4 w-4" />
            <span>{user?.tokenBalance || 0} tokens</span>
          </div>
          <Link href="/marketplace">
            <Button variant="default" className="gap-2">
              <Coins className="h-4 w-4" />
              Purchase Tokens
            </Button>
          </Link>
          <span className="text-sm text-muted-foreground">{user?.username}</span>
          <Button variant="outline" onClick={handleLogout}>
            Logout
          </Button>
        </div>
      </div>
    </div>
  );
}