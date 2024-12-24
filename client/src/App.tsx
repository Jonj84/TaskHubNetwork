import { Switch, Route } from 'wouter';
import { Loader2 } from 'lucide-react';
import { useUser } from './hooks/use-user';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import TasksPage from './pages/TasksPage';
import WalletPage from './pages/WalletPage';
import NavigationBar from './components/NavigationBar';

function App() {
  const { user, isLoading } = useUser();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <div className="min-h-screen bg-background">
      <NavigationBar />
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/tasks" component={TasksPage} />
        <Route path="/wallet" component={WalletPage} />
        <Route>404 - Not Found</Route>
      </Switch>
    </div>
  );
}

export default App;
