import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createRepo, getRepos } from "@/lib/api-client";
import { rethrowIfRedirectError } from "@/lib/server-action";

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
  const repos = await getRepos();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const noticeParam = typeof resolvedSearchParams?.notice === "string" ? resolvedSearchParams.notice : undefined;
  const errorParam = typeof resolvedSearchParams?.error === "string" ? resolvedSearchParams.error : undefined;
  const notice = getNoticeContent(noticeParam);

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
              </tr>
            ))}
            {repos.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  No repositories connected yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
