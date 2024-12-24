import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useTasks } from '../hooks/use-tasks';
import { useToast } from '@/hooks/use-toast';
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
  const { verifyTask } = useTasks();
  const { toast } = useToast();

  const handleVerify = async (verified: boolean) => {
    try {
      await verifyTask({ taskId: task.id, verified });
      onOpenChange(false);
      toast({
        title: 'Success',
        description: verified ? 'Task verified successfully' : 'Task rejected',
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {task.status === 'pending_verification'
              ? 'Verify Task Completion'
              : 'Task Details'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <h3 className="font-semibold">Required Proof:</h3>
            <p className="text-sm">{task.proofRequired}</p>
          </div>

          {task.proofSubmitted && (
            <div>
              <h3 className="font-semibold">Submitted Proof:</h3>
              <p className="text-sm">{task.proofSubmitted}</p>
            </div>
          )}

          {task.status === 'pending_verification' && (
            <div className="flex gap-2">
              <Button
                variant="destructive"
                onClick={() => handleVerify(false)}
              >
                Reject
              </Button>
              <Button
                className="flex-1"
                onClick={() => handleVerify(true)}
              >
                Verify
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
