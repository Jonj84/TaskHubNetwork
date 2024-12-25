import { db } from '@db';
import { tasks, tokens } from '@db/schema';
import { eq } from 'drizzle-orm';
import { log } from '../vite';

interface WorkUnit {
  id: number;
  tokenId: string;
  workerId: number;
  status: 'pending' | 'in_progress' | 'completed' | 'verified';
  input: any;
  result?: any;
  startedAt?: string;
  completedAt?: string;
  verifiedAt?: string;
}

interface WorkProgress {
  total: number;
  completed: number;
  verified: number;
}

export class ComputationalTaskAgent {
  private static instance: ComputationalTaskAgent;

  private constructor() {
    log('[ComputationalTaskAgent] Initializing agent');
  }

  public static getInstance(): ComputationalTaskAgent {
    if (!ComputationalTaskAgent.instance) {
      ComputationalTaskAgent.instance = new ComputationalTaskAgent();
    }
    return ComputationalTaskAgent.instance;
  }

  async distributeWork(taskId: number): Promise<boolean> {
    try {
      const [task] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);

      if (!task || task.type !== 'computational') {
        log('[ComputationalTaskAgent] Invalid task or not computational');
        return false;
      }

      const { workUnitsTotal, workUnitsPerToken } = task;
      if (!workUnitsTotal || !workUnitsPerToken) {
        log('[ComputationalTaskAgent] Missing work unit configuration');
        return false;
      }

      // Get all active tokens for the task
      const availableTokens = await db
        .select()
        .from(tokens)
        .where(eq(tokens.status, 'active'));

      // Calculate work distribution
      const workUnits: WorkUnit[] = [];
      let unitId = 0;

      for (const token of availableTokens) {
        // Each token gets workUnitsPerToken units assigned
        for (let i = 0; i < workUnitsPerToken && unitId < workUnitsTotal; i++) {
          workUnits.push({
            id: unitId++,
            tokenId: token.id,
            workerId: 0, // Will be assigned when work is claimed
            status: 'pending',
            input: this.generateWorkUnitInput(task, unitId),
          });
        }
      }

      const progress: WorkProgress = {
        total: workUnits.length,
        completed: 0,
        verified: 0,
      };

      // Update task with work units
      await db
        .update(tasks)
        .set({
          workUnitResults: {
            units: workUnits,
            progress,
          },
          updated_at: new Date(),
        })
        .where(eq(tasks.id, taskId));

      log('[ComputationalTaskAgent] Work distributed:', {
        taskId,
        totalUnits: workUnits.length,
        tokensUsed: availableTokens.length,
      });

      return true;
    } catch (error) {
      log('[ComputationalTaskAgent] Distribution error:', error);
      return false;
    }
  }

  async claimWorkUnit(taskId: number, tokenId: string, workerId: number): Promise<WorkUnit | null> {
    try {
      const [task] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);

      if (!task?.workUnitResults) return null;

      const { units } = task.workUnitResults;
      const pendingUnit = units.find(
        unit => unit.tokenId === tokenId && unit.status === 'pending'
      );

      if (!pendingUnit) return null;

      // Update unit status
      pendingUnit.status = 'in_progress';
      pendingUnit.workerId = workerId;
      pendingUnit.startedAt = new Date().toISOString();

      await db
        .update(tasks)
        .set({
          workUnitResults: task.workUnitResults,
          updated_at: new Date(),
        })
        .where(eq(tasks.id, taskId));

      log('[ComputationalTaskAgent] Work unit claimed:', {
        taskId,
        unitId: pendingUnit.id,
        workerId,
        tokenId,
      });

      return pendingUnit;
    } catch (error) {
      log('[ComputationalTaskAgent] Claim error:', error);
      return null;
    }
  }

  async submitWorkResult(
    taskId: number,
    unitId: number,
    workerId: number,
    result: any
  ): Promise<boolean> {
    try {
      const [task] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);

      if (!task?.workUnitResults) return false;

      const { units, progress } = task.workUnitResults;
      const unit = units.find(u => u.id === unitId && u.workerId === workerId);

      if (!unit || unit.status !== 'in_progress') return false;

      // Update unit with result
      unit.status = 'completed';
      unit.result = result;
      unit.completedAt = new Date().toISOString();
      progress.completed++;

      await db
        .update(tasks)
        .set({
          workUnitResults: task.workUnitResults,
          updated_at: new Date(),
        })
        .where(eq(tasks.id, taskId));

      log('[ComputationalTaskAgent] Work unit completed:', {
        taskId,
        unitId,
        workerId,
        progress,
      });

      return true;
    } catch (error) {
      log('[ComputationalTaskAgent] Submission error:', error);
      return false;
    }
  }

  private generateWorkUnitInput(task: any, unitId: number): any {
    // Generate input based on task's computational metadata
    // This should be customized based on the specific computational task type
    const { computationalMetadata } = task;
    if (!computationalMetadata) return null;

    // Example: For a data processing task, might split input data into chunks
    return {
      unitId,
      format: computationalMetadata.inputFormat,
      // Add other task-specific input parameters
    };
  }

  async getTaskProgress(taskId: number): Promise<WorkProgress | null> {
    try {
      const [task] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);

      return task?.workUnitResults?.progress || null;
    } catch (error) {
      log('[ComputationalTaskAgent] Progress fetch error:', error);
      return null;
    }
  }
}

export const computationalTaskAgent = ComputationalTaskAgent.getInstance();
