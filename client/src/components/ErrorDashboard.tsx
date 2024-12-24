import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { XCircle, AlertCircle, Clock, ChevronUp, ChevronDown } from 'lucide-react';
import { useErrorStore, useErrorWebSocket } from '@/hooks/use-error-store';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

interface ErrorEvent {
  id: string;
  message: string;
  timestamp: string;
  type: 'error' | 'warning';
  source: string;
  stack?: string;
}

export default function ErrorDashboard() {
  const { errors } = useErrorStore();
  const [isExpanded, setIsExpanded] = useState(false);
  useErrorWebSocket();

  const getErrorIcon = (type: ErrorEvent['type']) => {
    return type === 'error' ? (
      <XCircle className="h-5 w-5 text-destructive" />
    ) : (
      <AlertCircle className="h-5 w-5 text-yellow-500" />
    );
  };

  return (
    <Card 
      className={cn(
        "w-full transition-all duration-300 cursor-pointer",
        !isExpanded && "hover:shadow-md"
      )}
      onClick={() => setIsExpanded(!isExpanded)}
    >
      <CardHeader className="py-3">
        <CardTitle className="text-lg font-bold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Error Tracking
            <Badge variant="outline" className="ml-2">
              {errors.length} Events
            </Badge>
          </div>
          {isExpanded ? (
            <ChevronDown className="h-5 w-5" />
          ) : (
            <ChevronUp className="h-5 w-5" />
          )}
        </CardTitle>
      </CardHeader>
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <CardContent>
              <ScrollArea className="h-[300px] w-full rounded-md border p-4">
                {errors.length === 0 ? (
                  <div className="text-center text-muted-foreground p-4">
                    No errors to display
                  </div>
                ) : (
                  <div className="space-y-4">
                    {errors.map((error: ErrorEvent) => (
                      <Card key={error.id} className="p-4">
                        <div className="flex items-start gap-2">
                          {getErrorIcon(error.type)}
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <h3 className="font-semibold">{error.message}</h3>
                              <div className="flex items-center text-sm text-muted-foreground">
                                <Clock className="h-4 w-4 mr-1" />
                                {new Date(error.timestamp).toLocaleTimeString()}
                              </div>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              Source: {error.source}
                            </p>
                            {error.stack && (
                              <pre className="mt-2 p-2 bg-muted rounded-md text-xs overflow-x-auto">
                                {error.stack}
                              </pre>
                            )}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}