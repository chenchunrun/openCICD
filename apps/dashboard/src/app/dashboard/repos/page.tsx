import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createRepo, getRepoWorkflowFileUrl, getRepoWorkflows, getRepos } from "@/lib/api-client";
import { rethrowIfRedirectError } from "@/lib/server-action";

function getInstallationTone(status: "installed" | "missing" | "drifted" | "unknown") {
  switch (status) {
    case "installed":
      return {
        badge: "border-emerald-900/50 bg-emerald-950/30 text-emerald-200",
        text: "text-emerald-200",
      };
    case "missing":
      return {
        badge: "border-red-900/50 bg-red-950/30 text-red-200",
        text: "text-red-200",
      };
    case "drifted":
      return {
        badge: "border-amber-900/50 bg-amber-950/30 text-amber-200",
        text: "text-amber-200",
      };
    default:
      return {
        badge: "border-gray-800 bg-gray-900 text-gray-300",
        text: "text-gray-300",
      };
  }
}

function getNoticeContent(notice?: string) {
  switch (notice) {
    case "repo_created":
      return {
        tone: "success" as const,
        message: "Repository connected. You can create tasks against it now.",
      };
    default:
      return null;
  }
}

async function createRepoAction(formData: FormData) {
  "use server";

  try {
    const platform = formData.get("platform");
    const owner = formData.get("owner");
    const name = formData.get("name");
    const url = formData.get("url");
    const defaultBranch = formData.get("defaultBranch");
    const localPath = formData.get("localPath");

    if (typeof platform !== "string" || platform.length === 0) {
      throw new Error("platform is required");
    }
    if (typeof owner !== "string" || owner.length === 0) {
      throw new Error("owner is required");
    }
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("name is required");
    }
    if (typeof url !== "string" || url.length === 0) {
      throw new Error("url is required");
    }

    await createRepo({
      platform,
      owner,
      name,
      url,
      defaultBranch: typeof defaultBranch === "string" && defaultBranch.length > 0 ? defaultBranch : undefined,
      localPath: typeof localPath === "string" && localPath.length > 0 ? localPath : undefined,
    });

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/repos");
    revalidatePath("/dashboard/tasks");
    redirect("/dashboard/repos?notice=repo_created");
  } catch (error) {
    rethrowIfRedirectError(error);
    const message = error instanceof Error ? error.message : "Repository onboarding failed";
    redirect(`/dashboard/repos?error=${encodeURIComponent(message)}`);
  }
}

export default async function DashboardReposPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const noticeParam = typeof resolvedSearchParams?.notice === "string" ? resolvedSearchParams.notice : undefined;
  const errorParam = typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : undefined;
  const repoIdParam = typeof resolvedSearchParams?.repoId === "string" ? resolvedSearchParams.repoId : undefined;
  const repos = await getRepos();
  const notice = getNoticeContent(noticeParam);
  const selectedRepo =
    repos.find((repo) => repo.id === repoIdParam) ??
    repos[0] ??
    null;
  const workflowBundle = selectedRepo ? await getRepoWorkflows(selectedRepo.id) : null;
  const workflowEntries = workflowBundle?.workflows ?? [];
  const highlightedWorkflowNames = ["ai-release.yml", "ai-review.yml", "ai-agent-run.yml"];
  const highlightedWorkflows = highlightedWorkflowNames
    .map((workflowName) => workflowEntries.find((workflow) => workflow.filename === workflowName) ?? null)
    .filter((workflow): workflow is NonNullable<typeof workflow> => workflow !== null);
  const requiredSecrets = Array.from(new Set(workflowEntries.flatMap((workflow) => workflow.requiredSecrets)));
  const installationSummary = workflowEntries.reduce(
    (summary, workflow) => {
      summary[workflow.installation.status] += 1;
      return summary;
    },
    {
      installed: 0,
      missing: 0,
      drifted: 0,
      unknown: 0,
    } as Record<"installed" | "missing" | "drifted" | "unknown", number>,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Repositories</h1>
        <p className="mt-1 text-sm text-gray-400">
          Connect a repository, optionally point at a local checkout, and let the control plane infer a baseline.
        </p>
      </div>

      {notice ? (
        <div className="rounded-lg border border-emerald-800 bg-emerald-950/50 px-4 py-3 text-sm text-emerald-200">
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
          <h2 className="text-base font-semibold text-white">Onboard Repository</h2>
          <p className="mt-1 text-sm text-gray-400">
            Minimal setup is enough. Add `localPath` if you want command detection and local file scanning.
          </p>
        </div>

        <form action={createRepoAction} className="grid gap-4 lg:grid-cols-2">
          <label className="grid gap-2 text-sm text-gray-300">
            Platform
            <select
              name="platform"
              defaultValue="github"
              className="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none"
            >
              <option value="github">github</option>
              <option value="gitlab">gitlab</option>
              <option value="bitbucket">bitbucket</option>
            </select>
          </label>

          <label className="grid gap-2 text-sm text-gray-300">
            Default Branch
            <input
              name="defaultBranch"
              type="text"
              defaultValue="main"
              className="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none"
            />
          </label>

          <label className="grid gap-2 text-sm text-gray-300">
            Owner
            <input
              name="owner"
              type="text"
              required
              placeholder="acme"
              className="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none"
            />
          </label>

          <label className="grid gap-2 text-sm text-gray-300">
            Name
            <input
              name="name"
              type="text"
              required
              placeholder="ai-cicd-control-plane"
              className="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none"
            />
          </label>

          <label className="grid gap-2 text-sm text-gray-300 lg:col-span-2">
            Repository URL
            <input
              name="url"
              type="url"
              required
              placeholder="https://github.com/acme/ai-cicd-control-plane"
              className="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none"
            />
          </label>

          <label className="grid gap-2 text-sm text-gray-300 lg:col-span-2">
            Local Path
            <input
              name="localPath"
              type="text"
              placeholder="/Users/you/src/ai-cicd-control-plane"
              className="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-white outline-none"
            />
          </label>

          <div className="lg:col-span-2">
            <button
              type="submit"
              className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-gray-950 transition hover:bg-gray-200"
            >
              Connect Repository
            </button>
          </div>
        </form>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
        <table className="min-w-full divide-y divide-gray-800 text-sm">
          <thead className="bg-gray-950/60 text-left text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">Repository</th>
              <th className="px-4 py-3 font-medium">Platform</th>
              <th className="px-4 py-3 font-medium">Branch</th>
              <th className="px-4 py-3 font-medium">Languages</th>
              <th className="px-4 py-3 font-medium">Signals</th>
              <th className="px-4 py-3 font-medium">Workflow Pack</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {repos.map((repo) => (
              <tr key={repo.id}>
                <td className="px-4 py-3">
                  <div className="text-white">{repo.fullName}</div>
                  <div className="mt-1 text-xs text-gray-500">{repo.url ?? "-"}</div>
                </td>
                <td className="px-4 py-3 text-gray-300">{repo.platform}</td>
                <td className="px-4 py-3 text-gray-300">{repo.defaultBranch}</td>
                <td className="px-4 py-3 text-gray-300">
                  {(repo.languages ?? []).length > 0 ? (repo.languages ?? []).join(", ") : "unknown"}
                </td>
                <td className="px-4 py-3 text-gray-300">
                  {[
                    repo.packageManager ? `pkg:${repo.packageManager}` : null,
                    repo.hasAgentsMd ? "AGENTS.md" : null,
                    repo.hasClaudeMd ? "CLAUDE.md" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "-"}
                </td>
                <td className="px-4 py-3 text-gray-300">
                  <Link
                    href={`/dashboard/repos?repoId=${encodeURIComponent(repo.id)}`}
                    className="inline-flex rounded-md border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-950"
                  >
                    View Workflows
                  </Link>
                </td>
              </tr>
            ))}
            {repos.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No repositories connected yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">Workflow Pack</h2>
            <p className="mt-1 text-sm text-gray-400">
              Review the generated GitHub workflow set that the control plane expects to exist in the repository.
            </p>
          </div>
          {selectedRepo ? (
            <span className="rounded-full border border-sky-900/50 bg-sky-950/30 px-3 py-1 text-xs font-medium text-sky-200">
              {selectedRepo.fullName}
            </span>
          ) : null}
        </div>

        {selectedRepo && workflowBundle ? (
          <div className="mt-5 space-y-5">
            <div className="grid gap-3 lg:grid-cols-4">
              {(["installed", "missing", "drifted", "unknown"] as const).map((status) => {
                const tone = getInstallationTone(status);
                return (
                  <div key={status} className="rounded-md border border-gray-800 bg-gray-950 p-4">
                    <p className="text-xs uppercase tracking-wide text-gray-500">{status}</p>
                    <p className={`mt-2 text-2xl font-semibold ${tone.text}`}>{installationSummary[status]}</p>
                  </div>
                );
              })}
            </div>

            {workflowBundle.localPath ? (
              <div className="rounded-md border border-gray-800 bg-gray-950 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500">Connected Local Checkout</p>
                <p className="mt-2 text-sm text-gray-300">{workflowBundle.localPath}</p>
              </div>
            ) : (
              <div className="rounded-md border border-amber-900 bg-amber-950/20 p-4">
                <p className="text-xs uppercase tracking-wide text-amber-300">Verification Gap</p>
                <p className="mt-2 text-sm text-amber-100">
                  This repository has no connected local checkout, so the control plane cannot verify whether the expected workflow files are installed.
                </p>
              </div>
            )}

            <div className="grid gap-4 xl:grid-cols-3">
              {highlightedWorkflows.map((workflow) => {
                const tone = getInstallationTone(workflow.installation.status);
                return (
                  <div key={workflow.filename} className="rounded-lg border border-gray-800 bg-gray-950 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{workflow.displayName}</p>
                        <p className="mt-1 text-xs text-gray-500">{workflow.filename}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className="rounded-full border border-sky-900/50 bg-sky-950/30 px-2.5 py-1 text-[11px] font-medium text-sky-200">
                          {workflow.triggers[0] ?? "workflow_dispatch"}
                        </span>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${tone.badge}`}>
                          {workflow.installation.status}
                        </span>
                      </div>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-gray-400">{workflow.purpose}</p>
                    <dl className="mt-4 space-y-3 text-xs">
                      <div>
                        <dt className="text-gray-500">Installation Status</dt>
                        <dd className={`mt-1 ${tone.text}`}>{workflow.installation.detail}</dd>
                      </div>
                      <div>
                        <dt className="text-gray-500">Install Path</dt>
                        <dd className="mt-1 font-medium text-white">{workflow.installPath}</dd>
                      </div>
                      <div>
                        <dt className="text-gray-500">Required Secrets</dt>
                        <dd className="mt-1 text-gray-200">
                          {workflow.requiredSecrets.length > 0 ? workflow.requiredSecrets.join(", ") : "None"}
                        </dd>
                        {workflow.secrets.length > 0 ? (
                          <p className="mt-1 text-gray-500">{workflow.secrets[0]?.detail}</p>
                        ) : null}
                      </div>
                      <div>
                        <dt className="text-gray-500">Triggers</dt>
                        <dd className="mt-1 text-gray-200">{workflow.triggers.join(" · ")}</dd>
                      </div>
                    </dl>
                    <pre className="mt-4 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-gray-800 bg-gray-900 p-3 text-xs text-gray-300">
                      {workflow.content}
                    </pre>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        href={getRepoWorkflowFileUrl(selectedRepo.id, workflow.filename)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex rounded-md border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-900"
                      >
                        Open Raw
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-950 p-4">
              <p className="text-sm font-semibold text-white">Full Workflow Set</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {workflowEntries.map((workflow) => (
                  <span
                    key={workflow.filename}
                    className={`rounded-full border px-3 py-1 text-xs ${getInstallationTone(workflow.installation.status).badge}`}
                  >
                    {workflow.filename}
                  </span>
                ))}
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <div className="rounded-md border border-gray-800 bg-gray-900 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Install Convention</p>
                  <p className="mt-2 text-sm text-gray-300">
                    Commit the generated files under <span className="font-medium text-white">.github/workflows/</span>
                    {" "}in the target repository so release, review, and agent dispatch can be triggered from GitHub.
                  </p>
                </div>
                <div className="rounded-md border border-gray-800 bg-gray-900 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Shared Secret Requirement</p>
                  <p className="mt-2 text-sm text-gray-300">
                    {requiredSecrets.length > 0
                      ? `Configure ${requiredSecrets.join(", ")} in the repository or org secrets before dispatching these workflows.`
                      : "No shared secrets are required for the generated workflow set."}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-md border border-dashed border-gray-800 bg-gray-950 p-4 text-sm text-gray-500">
            {repos.length === 0
              ? "Connect a repository to inspect its generated workflow pack."
              : "No workflow pack is available for the selected repository."}
          </div>
        )}
      </section>
    </div>
  );
}
