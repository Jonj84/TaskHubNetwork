import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, WifiOff, Wifi } from 'lucide-react';
import type { WebSocketStatus } from '@/lib/websocket/WebSocketService';

interface WebSocketStatusProps {
  status: WebSocketStatus;
  onReconnect: () => void;
}

export function WebSocketStatusIndicator({ status, onReconnect }: WebSocketStatusProps) {
  const [isReconnecting, setIsReconnecting] = useState(false);

  // Reset reconnecting state when status changes to connected
  useEffect(() => {
    if (status === 'connected') {
      setIsReconnecting(false);
    }
  }, [status]);

  const handleReconnect = async () => {
    setIsReconnecting(true);
    try {
      await onReconnect();
    } finally {
      // Reset after a timeout in case the connection attempt fails
      setTimeout(() => setIsReconnecting(false), 5000);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 flex items-center gap-2 bg-background/80 backdrop-blur-sm p-2 rounded-lg shadow-lg border">
      {status === 'connected' && (
        <>
          <Wifi className="h-4 w-4 text-green-500" />
          <span className="text-sm text-muted-foreground">Connected</span>
        </>
      )}

      {status === 'connecting' && (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm text-muted-foreground">Connecting...</span>
        </>
      )}

      {(status === 'disconnected' || status === 'error') && (
        <>
          <WifiOff className="h-4 w-4 text-destructive" />
          <span className="text-sm text-muted-foreground">Disconnected</span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReconnect}
            disabled={isReconnecting}
          >
            {isReconnecting ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                Reconnecting...
              </>
            ) : (
              'Reconnect'
            )}
          </Button>
        </>
      )}
    </div>
  );
}
