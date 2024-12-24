import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useUser } from '../hooks/use-user';
import { useTasks } from '../hooks/use-tasks';
import { useToast } from '@/hooks/use-toast';
import VerificationModal from './VerificationModal';
import type { Task } from '../types';

interface TaskCardProps {
  task: Task;
}

export default function TaskCard({ task }: TaskCardProps) {
  const { user } = useUser();
  const { submitProof } = useTasks();
  const { toast } = useToast();
  const [proofText, setProofText] = useState('');
  const [verifyOpen, setVerifyOpen] = useState(false);

  const handleSubmitProof = async () => {
    try {
      await submitProof({ taskId: task.id, proof: proofText });
      toast({
        title: 'Success',
        description: 'Proof submitted successfully',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message,
      });
    }
  };

  const getStatusColor = (status: Task['status']) => {
    switch (status) {
      case 'open':
        return 'bg-green-500';
      case 'in_progress':
        return 'bg-blue-500';
      case 'pending_verification':
        return 'bg-yellow-500';
      case 'completed':
        return 'bg-purple-500';
      default:
        return 'bg-gray-500';
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-lg font-bold">{task.title}</CardTitle>
        <Badge className={getStatusColor(task.status)}>
          {task.status.replace('_', ' ')}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-500">{task.description}</p>
        <div className="flex justify-between items-center">
          <span className="text-sm">
            Reward: <strong>{task.reward} tokens</strong>
          </span>
          <span className="text-sm">Type: {task.type}</span>
        </div>
        
        {task.status === 'open' && task.creatorId !== user?.id && (
          <Button
            className="w-full"
            onClick={() => setVerifyOpen(true)}
          >
            Accept Task
          </Button>
        )}

        {task.status === 'in_progress' && task.workerId === user?.id && (
          <div className="space-y-2">
            <textarea
              className="w-full p-2 border rounded"
              placeholder={task.proofRequired}
              value={proofText}
              onChange={(e) => setProofText(e.target.value)}
            />
            <Button
              className="w-full"
              onClick={handleSubmitProof}
            >
              Submit Proof
            </Button>
          </div>
        )}

        {task.status === 'pending_verification' && task.creatorId === user?.id && (
          <Button
            className="w-full"
            onClick={() => setVerifyOpen(true)}
          >
            Verify Submission
          </Button>
        )}
      </CardContent>

      <VerificationModal
        task={task}
        open={verifyOpen}
        onOpenChange={setVerifyOpen}
      />
    </Card>
  );
}
