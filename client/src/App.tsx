import { Switch, Route } from 'wouter';
import { Loader2 } from 'lucide-react';
import { useUser } from './hooks/use-user';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import TasksPage from './pages/TasksPage';
import WalletPage from './pages/WalletPage';
import TransactionExplorer from './pages/TransactionExplorer';
import NavigationBar from './components/NavigationBar';
import ErrorDashboard from './components/ErrorDashboard';

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
      <div className="container mx-auto p-4">
        <Switch>
          <Route path="/" component={DashboardPage} />
          <Route path="/tasks" component={TasksPage} />
          <Route path="/wallet" component={WalletPage} />
          <Route path="/explorer" component={TransactionExplorer} />
          <Route>404 - Not Found</Route>
        </Switch>

        {/* Error Dashboard positioned at the bottom of the viewport */}
        <div className="fixed bottom-4 right-4 w-96 max-w-[90vw]">
          <ErrorDashboard />
        </div>
      </div>
    </div>
  );
}

export default App;