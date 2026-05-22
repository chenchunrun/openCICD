import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AICP_ACTOR_NAME,
  AICP_ACTOR_ROLE,
  approveTask,
  canPerformRole,
  createTask,
  executeTask,
  getRepos,
  getRuns,
  getTasks,
  rejectTask,
  type Run,
} from "@/lib/api-client";
import { rethrowIfRedirectError } from "@/lib/server-action";

function parseMultiline(value: string | File | null): string[] {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getNoticeContent(notice?: string, taskId?: string) {
  switch (notice) {
    case "task_created":
      return {
        tone: "success" as const,
        message: "Task created. Review the row below and execute it when ready.",
      };
    case "accepted":
      return {
        tone: "success" as const,
        message: `Task ${taskId ?? ""} was accepted and is now running in the background.`.trim(),
      };
    case "task_approved":
      return {
        tone: "success" as const,
        message: `Approval recorded for task ${taskId ?? ""}.`.trim(),
      };
    case "task_rejected":
      return {
        tone: "info" as const,
        message: `Rejection recorded for task ${taskId ?? ""}.`.trim(),
      };
    case "already_running":
      return {
        tone: "info" as const,
        message: `Task ${taskId ?? ""} is already running.`.trim(),
      };
    default:
      return null;
  }
}

function getLatestRunByTaskId(runs: Run[]): Map<string, Run> {
  const latestRunByTaskId = new Map<string, Run>();
  for (const run of runs) {
    if (!latestRunByTaskId.has(run.taskId)) {
      latestRunByTaskId.set(run.taskId, run);
    }
  }
  return latestRunByTaskId;
}

function getRunErrorMessage(run?: Run): string | null {
  const errorEvent = run?.events?.[0];
  if (!errorEvent) {
    return null;
  }

  return typeof errorEvent.data?.message === "string"
    ? errorEvent.data.message
    : JSON.stringify(errorEvent.data);
}

async function createTaskAction(formData: FormData) {
  "use server";

  try {
    const repoId = formData.get("repoId");
    const goal = formData.get("goal");
    const allowedPaths = parseMultiline(formData.get("allowedPaths"));
    const forbiddenPaths = parseMultiline(formData.get("forbiddenPaths"));
    const doneWhen = parseMultiline(formData.get("doneWhen"));
    const constraints = parseMultiline(formData.get("constraints"));
    const preferredAgent = formData.get("preferredAgent");

    if (typeof repoId !== "string" || repoId.length === 0) {
      throw new Error("repoId is required");
    }

    if (typeof goal !== "string" || goal.trim().length === 0) {
      throw new Error("goal is required");
    }

    await createTask({
      repoId,
      goal,
      allowedPaths: allowedPaths.length > 0 ? allowedPaths : ["apps/**"],
      forbiddenPaths,
      doneWhen: doneWhen.length > 0 ? doneWhen : ["Verification passes", "Changes stay within allowed scope"],
      constraints,
      preferredAgent: typeof preferredAgent === "string" && preferredAgent.length > 0 ? preferredAgent : undefined,
    });

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/tasks");
    redirect("/dashboard/tasks?notice=task_created");
  } catch (error) {
    rethrowIfRedirectError(error);
    const message = error instanceof Error ? error.message : "Task creation failed";
    redirect(`/dashboard/tasks?error=${encodeURIComponent(message)}`);
  }
}

async function runTaskAction(formData: FormData) {
  "use server";

  try {
    const taskId = formData.get("taskId");
    if (typeof taskId !== "string" || taskId.length === 0) {
      throw new Error("taskId is required");
    }

    const result = await executeTask(taskId);
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/tasks");
    revalidatePath("/dashboard/runs");
    redirect(`/dashboard/tasks?notice=${encodeURIComponent(result.status)}&taskId=${encodeURIComponent(taskId)}`);
  } catch (error) {
    rethrowIfRedirectError(error);
    const message = error instanceof Error ? error.message : "Task execution failed";
    redirect(`/dashboard/tasks?error=${encodeURIComponent(message)}`);
  }
}

async function approveTaskAction(formData: FormData) {
  "use server";

  try {
    const taskId = formData.get("taskId");
    const reason = formData.get("reason");
    if (typeof taskId !== "string" || taskId.length === 0) {
      throw new Error("taskId is required");
    }

    await approveTask(taskId, typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : undefined);
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/tasks");
    revalidatePath("/dashboard/failures");
    revalidatePath("/dashboard/release");
    redirect(`/dashboard/tasks?notice=task_approved&taskId=${encodeURIComponent(taskId)}`);
  } catch (error) {
    rethrowIfRedirectError(error);
    const message = error instanceof Error ? error.message : "Task approval failed";
    redirect(`/dashboard/tasks?error=${encodeURIComponent(message)}`);
  }
}

async function rejectTaskAction(formData: FormData) {
  "use server";

  try {
    const taskId = formData.get("taskId");
    const reason = formData.get("reason");
    if (typeof taskId !== "string" || taskId.length === 0) {
      throw new Error("taskId is required");
    }
    if (typeof reason !== "string" || reason.trim().length === 0) {
      throw new Error("Rejection reason is required");
    }

    await rejectTask(taskId, reason.trim());
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/tasks");
    revalidatePath("/dashboard/failures");
    revalidatePath("/dashboard/release");
    redirect(`/dashboard/tasks?notice=task_rejected&taskId=${encodeURIComponent(taskId)}`);
  } catch (error) {
    rethrowIfRedirectError(error);
    const message = error instanceof Error ? error.message : "Task rejection failed";
    redirect(`/dashboard/tasks?error=${encodeURIComponent(message)}`);
  }
}

export default async function DashboardTasksPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [tasks, repos, runs] = await Promise.all([getTasks(), getRepos(), getRuns()]);
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const noticeParam = typeof resolvedSearchParams?.notice === "string" ? resolvedSearchParams.notice : undefined;
  const taskIdParam = typeof resolvedSearchParams?.taskId === "string" ? resolvedSearchParams.taskId : undefined;
  const errorParam = typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : undefined;
  const notice = getNoticeContent(noticeParam, taskIdParam);
  const latestRunByTaskId = getLatestRunByTaskId(runs);
  const canApproveOrReject = canPerformRole("releaser");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Tasks</h1>
        <p className="mt-1 text-sm text-gray-400">
          Review normalized tasks and trigger execution through the orchestrator.
        </p>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-gray-300">
        Actor: <span className="font-medium text-white">{AICP_ACTOR_NAME}</span> · role{" "}
        <span className="font-medium text-white">{AICP_ACTOR_ROLE}</span>. Task approval and rejection require{" "}
        <span className="font-medium text-amber-200">releaser</span> or higher.
      </div>

      {notice ? (
        <div
          className={
            notice.tone === "success"
              ? "rounded-lg border border-emerald-800 bg-emerald-950/50 px-4 py-3 text-sm text-emerald-200"
              : "rounded-lg border border-sky-800 bg-sky-950/50 px-4 py-3 text-sm text-sky-200"
          }
        >
          {notice.message}
        </div>
      ) : null}

      {errorParam ? (
        <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {errorParam}
        </div>
      ) : null}

      <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-white">Create Task</h2>
          <p className="mt-1 text-sm text-gray-400">
            Define a scoped task for a connected repository, then execute it from the table below.
          </p>
        </div>

        {repos.length === 0 ? (
          <div className="rounded-md border border-dashed border-gray-700 bg-gray-950 p-4 text-sm text-gray-500">
            No repositories are connected yet. Onboard a repository first, then create tasks here.
          </div>
        ) : (
          <form action={createTaskAction} className="grid gap-4 lg:grid-cols-2">
            <label className="grid gap-2 text-sm text-gray-300">
              Repository
              <select
                name="repoId"
                className="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none"
                required
                defaultValue={repos[0]?.id}
              >
                {repos.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.fullName}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2 text-sm text-gray-300">
              Preferred Agent
              <select
                name="preferredAgent"
                className="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none"
                defaultValue="claude_code"
              >
                <option value="claude_code">claude_code</option>
                <option value="codex">codex</option>
              </select>
            </label>

            <label className="grid gap-2 text-sm text-gray-300 lg:col-span-2">
              Goal
              <input
                name="goal"
                type="text"
                required
                placeholder="Fix flaky auth test without changing production behavior"
                className="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none"
              />
            </label>

            <label className="grid gap-2 text-sm text-gray-300">
              Allowed Paths
              <textarea
                name="allowedPaths"
                rows={5}
                defaultValue={"apps/api/src/**"}
                className="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none"
              />
            </label>

            <label className="grid gap-2 text-sm text-gray-300">
              Forbidden Paths
              <textarea
                name="forbiddenPaths"
                rows={5}
                placeholder=".github/workflows/**&#10;packages/db/prisma/migrations/**"
                className="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none"
              />
            </label>

            <label className="grid gap-2 text-sm text-gray-300">
              Done When
              <textarea
                name="doneWhen"
                rows={4}
                defaultValue={"Verification passes\nOnly allowed files are changed"}
                className="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none"
              />
            </label>

            <label className="grid gap-2 text-sm text-gray-300">
              Constraints
              <textarea
                name="constraints"
                rows={4}
                placeholder={"Do not modify CI config\nDo not weaken tests"}
                className="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none"
              />
            </label>

            <div className="lg:col-span-2">
              <button
                type="submit"
                className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-gray-950 transition hover:bg-gray-200"
              >
                Create Task
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
        <table className="min-w-full divide-y divide-gray-800 text-sm">
          <thead className="bg-gray-950/60 text-left text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">Goal</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Agent</th>
              <th className="px-4 py-3 font-medium">Latest Run</th>
              <th className="px-4 py-3 font-medium">Last Error</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {tasks.map((task) => {
              const latestRun = latestRunByTaskId.get(task.id);
              const latestError = getRunErrorMessage(latestRun);

              return (
              <tr key={task.id}>
                <td className="px-4 py-3 text-white">{task.goal}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      task.status === "failed"
                        ? "rounded-full border border-red-800 bg-red-950/40 px-2 py-1 text-xs font-medium text-red-200"
                        : task.status === "rejected"
                          ? "rounded-full border border-amber-800 bg-amber-950/40 px-2 py-1 text-xs font-medium text-amber-200"
                          : task.status === "approved"
                            ? "rounded-full border border-sky-800 bg-sky-950/40 px-2 py-1 text-xs font-medium text-sky-200"
                        : task.status === "completed"
                          ? "rounded-full border border-emerald-800 bg-emerald-950/40 px-2 py-1 text-xs font-medium text-emerald-200"
                          : "rounded-full border border-gray-700 bg-gray-950 px-2 py-1 text-xs font-medium text-gray-300"
                    }
                  >
                    {task.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-300">{task.preferredAgent ?? "default"}</td>
                <td className="px-4 py-3 text-gray-300">
                  {latestRun ? (
                    <div>
                      <div>{latestRun.id.slice(0, 8)}</div>
                      <div className="mt-1 text-xs text-gray-500">{latestRun.status}</div>
                    </div>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="max-w-xs px-4 py-3 text-sm text-red-300">
                  {latestError ? (
                    <span className="line-clamp-2">{latestError}</span>
                  ) : (
                    <span className="text-gray-500">-</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-400">
                  {task.createdAt
                    ? new Date(task.createdAt).toLocaleString()
                    : "-"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex min-w-[220px] flex-col gap-2">
                    <form action={runTaskAction}>
                      <input type="hidden" name="taskId" value={task.id} />
                      <button
                        type="submit"
                        disabled={["queued", "in_progress"].includes(task.status)}
                        className="w-full rounded-md bg-white px-3 py-2 text-xs font-semibold text-gray-950 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-300"
                      >
                        {["queued", "in_progress"].includes(task.status)
                          ? "Running"
                          : task.status === "failed"
                            ? "Retry"
                            : "Execute"}
                      </button>
                    </form>
                    <form action={approveTaskAction} className="flex gap-2">
                      <input type="hidden" name="taskId" value={task.id} />
                      <input
                        type="text"
                        name="reason"
                        placeholder="Approval note"
                        className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-950 px-2 py-2 text-xs text-white placeholder:text-gray-500"
                      />
                      <button
                        type="submit"
                        disabled={!canApproveOrReject || task.status === "approved"}
                        className={
                          canApproveOrReject && task.status !== "approved"
                            ? "rounded-md border border-emerald-800 px-3 py-2 text-xs font-medium text-emerald-200 transition hover:border-emerald-700 hover:bg-emerald-950/30"
                            : "rounded-md border border-gray-800 px-3 py-2 text-xs font-medium text-gray-500"
                        }
                      >
                        {task.status === "approved" ? "Approved" : "Approve"}
                      </button>
                    </form>
                    <form action={rejectTaskAction} className="flex gap-2">
                      <input type="hidden" name="taskId" value={task.id} />
                      <input
                        type="text"
                        name="reason"
                        placeholder="Rejection reason"
                        className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-950 px-2 py-2 text-xs text-white placeholder:text-gray-500"
                      />
                      <button
                        type="submit"
                        disabled={!canApproveOrReject || task.status === "rejected"}
                        className={
                          canApproveOrReject && task.status !== "rejected"
                            ? "rounded-md border border-amber-800 px-3 py-2 text-xs font-medium text-amber-200 transition hover:border-amber-700 hover:bg-amber-950/30"
                            : "rounded-md border border-gray-800 px-3 py-2 text-xs font-medium text-gray-500"
                        }
                      >
                        {task.status === "rejected" ? "Rejected" : "Reject"}
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            )})}
            {tasks.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  No tasks available.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
