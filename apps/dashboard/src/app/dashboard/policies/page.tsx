import { getPolicies, getRepos } from "@/lib/api-client";

export default async function DashboardPoliciesPage() {
  const [policies, repos] = await Promise.all([getPolicies(), getRepos()]);
  const repoNameById = new Map(repos.map((repo) => [repo.id, repo.fullName]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Policies</h1>
        <p className="mt-1 text-sm text-gray-400">
          Inspect active policy layers and the source files that defined them.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
        <table className="min-w-full divide-y divide-gray-800 text-sm">
          <thead className="bg-gray-950/60 text-left text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">Repository</th>
              <th className="px-4 py-3 font-medium">Layer</th>
              <th className="px-4 py-3 font-medium">Path</th>
              <th className="px-4 py-3 font-medium">Priority</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {policies.map((policy) => (
              <tr key={policy.id}>
                <td className="px-4 py-3 text-white">{repoNameById.get(policy.repoId) ?? policy.repoId}</td>
                <td className="px-4 py-3 text-gray-300">{policy.layer}</td>
                <td className="px-4 py-3 text-gray-300">{policy.path ?? "-"}</td>
                <td className="px-4 py-3 text-gray-300">{policy.priority ?? 0}</td>
                <td className="px-4 py-3 text-gray-300">{policy.sourceFile ?? "-"}</td>
                <td className="px-4 py-3 text-gray-300">{policy.active ? "yes" : "no"}</td>
              </tr>
            ))}
            {policies.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No active policies found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
