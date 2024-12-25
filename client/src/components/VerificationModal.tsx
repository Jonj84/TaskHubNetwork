import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useTasks } from '../hooks/use-tasks';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '../hooks/use-user';
import type { Task } from '../types';

interface VerificationModalProps {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function VerificationModal({
  task,
  open,
  onOpenChange,
}: VerificationModalProps) {
  const { acceptTask } = useTasks();
  const { user } = useUser();
  const { toast } = useToast();

  const handleAccept = async () => {
    try {
      await acceptTask(task.id);
      onOpenChange(false);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to accept task',
      });
    }
  };

  const canAccept = task.status === 'open' && task.creatorId !== user?.id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Task Details</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <h3 className="font-semibold">Description:</h3>
            <p className="text-sm">{task.description}</p>
          </div>

          <div>
            <h3 className="font-semibold">Required Proof:</h3>
            <p className="text-sm">{task.proofRequired}</p>
          </div>

          <div>
            <h3 className="font-semibold">Reward:</h3>
            <p className="text-sm">{task.reward} tokens</p>
          </div>

          {canAccept && (
            <Button 
              className="w-full"
              onClick={handleAccept}
            >
              Accept Task
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}