import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RepoController } from '../src/modules/repo/repo.controller';
import { IntentGateController } from '../src/modules/intent-gate/intent-gate.controller';
import { OrchestratorController } from '../src/modules/orchestrator/orchestrator.controller';
import { RunnerController } from '../src/modules/runner/runner.controller';
import { RepoService } from '../src/modules/repo/repo.service';
import { RepoOnboardingService } from '../src/modules/repo/repo-onboarding.service';
import { IntentGateService } from '../src/modules/intent-gate/intent-gate.service';
import { OrchestratorService } from '../src/modules/orchestrator/orchestrator.service';
import { RunnerService } from '../src/modules/runner/runner.service';
import { OnboardRepoDto } from '../src/modules/repo/dto/onboard-repo.dto';
import { CreateTaskDto } from '../src/modules/intent-gate/dto/create-task.dto';
import { ApproveTaskDto } from '../src/modules/intent-gate/dto/approve-task.dto';
import { RejectTaskDto } from '../src/modules/intent-gate/dto/reject-task.dto';

type RepoRecord = {
  id: string;
  platform: string;
  owner: string;
  name: string;
  fullName: string;
  url: string;
  defaultBranch: string;
  languages: string[];
  createdAt: string;
};

type TaskRecord = {
  id: string;
  repoId: string;
  goal: string;
  status: string;
  preferredAgent?: string | null;
  createdAt: string;
  doneWhen: string[];
  constraints: string[];
  scope: { allowedPaths: string[]; forbiddenPaths: string[] };
  source: { type: string; url?: string; payload?: Record<string, unknown> };
};

type RunRecord = {
  id: string;
  taskId: string;
  agentName: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  filesChanged: string[];
  diffSummary: Record<string, unknown> | null;
};

type RunEventRecord = {
  id: string;
  runId: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
};

class InMemoryStore {
  repos: RepoRecord[] = [];
  tasks: TaskRecord[] = [];
  runs: RunRecord[] = [];
  events: RunEventRecord[] = [];
}

class RepoServiceFake {
  constructor(private readonly store: InMemoryStore) {}

  async findAll() {
    return [...this.store.repos].reverse();
  }

  async findOne(id: string) {
    return this.store.repos.find((repo) => repo.id === id) ?? null;
  }

  async findByFullName(fullName: string) {
    return this.store.repos.find((repo) => repo.fullName === fullName) ?? null;
  }
}

class RepoOnboardingServiceFake {
  constructor(private readonly store: InMemoryStore) {}

  async onboard(input: OnboardRepoDto) {
    const existing = this.store.repos.find((repo) => repo.fullName === `${input.owner}/${input.name}`);
    if (existing) {
      return existing;
    }

    const repo: RepoRecord = {
      id: `repo_${this.store.repos.length + 1}`,
      platform: input.platform,
      owner: input.owner,
      name: input.name,
      fullName: `${input.owner}/${input.name}`,
      url: input.url,
      defaultBranch: input.defaultBranch ?? 'main',
      languages: input.localPath ? ['typescript'] : ['unknown'],
      createdAt: new Date().toISOString(),
    };
    this.store.repos.push(repo);
    return repo;
  }
}

class IntentGateServiceFake {
  constructor(private readonly store: InMemoryStore) {}

  async processTask(input: {
    repoId: string;
    source: { type: string; url?: string; payload?: Record<string, unknown> };
    goal: string;
    scope: { allowedPaths: string[]; forbiddenPaths: string[] };
    doneWhen: string[];
    constraints?: string[];
    preferredAgent?: string;
  }) {
    const task: TaskRecord = {
      id: `task_${this.store.tasks.length + 1}`,
      repoId: input.repoId,
      goal: input.goal,
      status: 'pending',
      preferredAgent: input.preferredAgent ?? null,
      createdAt: new Date().toISOString(),
      doneWhen: input.doneWhen,
      constraints: input.constraints ?? [],
      scope: input.scope,
      source: input.source,
    };
    this.store.tasks.push(task);
    return task;
  }

  async listTasks() {
    return [...this.store.tasks].reverse();
  }

  async getTask(id: string) {
    return this.store.tasks.find((task) => task.id === id) ?? null;
  }

  async approveTask(id: string, approver: string, reason?: string) {
    const task = this.store.tasks.find((entry) => entry.id === id);
    if (!task) throw new Error('Task not found');
    task.status = 'approved';
    return { ...task, approver, reason };
  }

  async rejectTask(id: string, approver: string, reason: string) {
    const task = this.store.tasks.find((entry) => entry.id === id);
    if (!task) throw new Error('Task not found');
    task.status = 'rejected';
    return { ...task, approver, reason };
  }
}

class OrchestratorServiceFake {
  constructor(private readonly store: InMemoryStore) {}

  async scheduleTask(taskId: string) {
    const task = this.store.tasks.find((entry) => entry.id === taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    const run: RunRecord = {
      id: `run_${this.store.runs.length + 1}`,
      taskId,
      agentName: task.preferredAgent ?? 'claude_code',
      status: 'queued',
      startedAt: null,
      finishedAt: null,
      filesChanged: [],
      diffSummary: null,
    };
    this.store.runs.push(run);
    this.store.events.push({
      id: `event_${this.store.events.length + 1}`,
      runId: run.id,
      type: 'status',
      data: { message: 'Task accepted for background execution' },
      timestamp: new Date().toISOString(),
    });
    task.status = 'queued';

    return { taskId, status: 'accepted' as const };
  }
}

class RunnerServiceFake {
  constructor(private readonly store: InMemoryStore) {}

  async listRuns() {
    return [...this.store.runs].reverse();
  }

  async getRun(id: string) {
    const run = this.store.runs.find((entry) => entry.id === id);
    if (!run) return null;
    return {
      ...run,
      events: this.store.events.filter((event) => event.runId === id),
      repairs: [],
      reviews: [],
    };
  }

  async getRunEvents(id: string) {
    return this.store.events.filter((event) => event.runId === id);
  }

  async getRunDiff(_id: string) {
    return {
      diff: '',
      summary: {},
    };
  }

  async createRun(taskId: string, agentName?: string) {
    return { id: `run_${this.store.runs.length + 1}`, taskId, agentName: agentName ?? 'claude_code' };
  }

  async stopRun(id: string) {
    const run = this.store.runs.find((entry) => entry.id === id);
    if (!run) throw new Error('Run not found');
    run.status = 'stopped';
    return run;
  }
}

describe('Control Plane API contracts (integration)', () => {
  let repoController: RepoController;
  let taskController: IntentGateController;
  let orchestratorController: OrchestratorController;
  let runnerController: RunnerController;
  let validationPipe: ValidationPipe;

  beforeAll(async () => {
    const store = new InMemoryStore();
    const moduleRef = await Test.createTestingModule({
      controllers: [RepoController, IntentGateController, OrchestratorController, RunnerController],
      providers: [
        { provide: RepoService, useValue: new RepoServiceFake(store) },
        { provide: RepoOnboardingService, useValue: new RepoOnboardingServiceFake(store) },
        { provide: IntentGateService, useValue: new IntentGateServiceFake(store) },
        { provide: OrchestratorService, useValue: new OrchestratorServiceFake(store) },
        { provide: RunnerService, useValue: new RunnerServiceFake(store) },
      ],
    }).compile();

    repoController = moduleRef.get(RepoController);
    taskController = moduleRef.get(IntentGateController);
    orchestratorController = moduleRef.get(OrchestratorController);
    runnerController = moduleRef.get(RunnerController);
    validationPipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
  });

  it('supports repo -> task -> execute -> runs flow', async () => {
    const repoBody = await validationPipe.transform(
      {
        platform: 'github',
        owner: 'acme',
        name: 'control-plane',
        url: 'https://github.com/acme/control-plane',
        defaultBranch: 'main',
      },
      { type: 'body', metatype: OnboardRepoDto },
    );
    const repo = await repoController.onboard(repoBody);

    const taskBody = await validationPipe.transform(
      {
        repoId: repo.id,
        source: { type: 'manual' },
        goal: 'Fix auth task flow',
        scope: {
          allowedPaths: ['apps/api/src/**'],
          forbiddenPaths: ['packages/db/**'],
        },
        doneWhen: ['Verification passes'],
        constraints: ['Do not modify CI config'],
        preferredAgent: 'codex',
      },
      { type: 'body', metatype: CreateTaskDto },
    );
    const task = await taskController.createTask(taskBody);

    const execution = await orchestratorController.executeTask(task.id);
    expect(execution).toMatchObject({
      taskId: task.id,
      status: 'accepted',
    });

    const runs = await runnerController.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      taskId: task.id,
      agentName: 'codex',
      status: 'queued',
    });

    const events = await runnerController.getRunEvents(runs[0].id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      runId: runs[0].id,
      type: 'status',
    });
  });

  it('rejects invalid task payloads via validation pipe', async () => {
    await expect(
      validationPipe.transform(
        {
          repoId: 'repo_1',
          source: { type: 'manual' },
          goal: '',
          scope: { allowedPaths: [] },
          doneWhen: [],
        },
        { type: 'body', metatype: CreateTaskDto },
      ),
    ).rejects.toBeDefined();
  });

  it('rejects invalid repo urls via validation pipe', async () => {
    await expect(
      validationPipe.transform(
        {
          platform: 'github',
          owner: 'acme',
          name: 'invalid-repo',
          url: 'not-a-url',
        },
        { type: 'body', metatype: OnboardRepoDto },
      ),
    ).rejects.toBeDefined();
  });

  it('validates approve and reject payloads', async () => {
    await expect(
      validationPipe.transform(
        { approver: '' } satisfies Partial<ApproveTaskDto>,
        { type: 'body', metatype: ApproveTaskDto },
      ),
    ).rejects.toBeDefined();

    await expect(
      validationPipe.transform(
        { approver: 'lead' } satisfies Partial<RejectTaskDto>,
        { type: 'body', metatype: RejectTaskDto },
      ),
    ).rejects.toBeDefined();
  });
});
