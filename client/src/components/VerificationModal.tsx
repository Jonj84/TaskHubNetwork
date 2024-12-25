import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useTasks } from '../hooks/use-tasks';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '../hooks/use-user';
import { useState } from 'react';
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
  const { acceptTask, submitProof, verifyTask } = useTasks();
  const { user } = useUser();
  const { toast } = useToast();
  const [proof, setProof] = useState('');

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

  const handleSubmitProof = async () => {
    try {
      if (!proof) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Please provide proof of completion',
        });
        return;
      }
      await submitProof({ taskId: task.id, proof });
      onOpenChange(false);
      setProof('');
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to submit proof',
      });
    }
  };

  const handleVerify = async (verified: boolean) => {
    try {
      await verifyTask({ taskId: task.id, verified });
      onOpenChange(false);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to verify task',
      });
    }
  };

  const canAccept = task.status === 'open' && task.creatorId !== user?.id;
  const canSubmitProof = task.status === 'in_progress' && task.workerId === user?.id;
  const canVerify = task.status === 'pending_verification' && task.creatorId === user?.id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {canVerify ? 'Verify Task Completion' : 'Task Details'}
          </DialogTitle>
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

          {task.proofSubmitted && (
            <div>
              <h3 className="font-semibold">Submitted Proof:</h3>
              <p className="text-sm">{task.proofSubmitted}</p>
            </div>
          )}

          {canSubmitProof && (
            <div className="space-y-2">
              <h3 className="font-semibold">Submit Proof:</h3>
              {task.proofType === 'text_submission' ? (
                <Textarea
                  value={proof}
                  onChange={(e) => setProof(e.target.value)}
                  placeholder="Enter your proof of completion..."
                  className="min-h-[100px]"
                />
              ) : (
                <Input
                  type="text"
                  value={proof}
                  onChange={(e) => setProof(e.target.value)}
                  placeholder={
                    task.proofType === 'image_upload'
                      ? 'Enter image URL...'
                      : task.proofType === 'code_submission'
                      ? 'Enter code or repository URL...'
                      : 'Enter proof...'
                  }
                />
              )}
              <Button 
                className="w-full"
                onClick={handleSubmitProof}
              >
                Submit Proof
              </Button>
            </div>
          )}

          {canAccept && (
            <Button 
              className="w-full"
              onClick={handleAccept}
            >
              Accept Task
            </Button>
          )}

          {canVerify && (
            <div className="flex gap-2">
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => handleVerify(false)}
              >
                Reject
              </Button>
              <Button
                className="flex-1"
                onClick={() => handleVerify(true)}
              >
                Approve
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}