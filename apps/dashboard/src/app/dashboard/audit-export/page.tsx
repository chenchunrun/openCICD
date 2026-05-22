import Link from "next/link";
import {
  getEvidenceExportBundle,
  getEvidenceExportBundleUrl,
  type EvidenceExportBundleResponse,
} from "@/lib/api-client";

const COMBINED_SCAN_MODES = [
  {
    title: "Secret + Dependency",
    description: "Export evidence records that contain either secret exposure or dependency supply-chain findings.",
    scanTypes: ["secret_scan", "dependency_scan"],
    detailHref: "/dashboard/evidence?scanTypes=secret_scan,dependency_scan",
    tone: "fuchsia",
  },
  {
    title: "SAST + License",
    description: "Export evidence records that contain either dangerous code patterns or license/compliance findings.",
    scanTypes: ["sast_scan", "license_scan"],
    detailHref: "/dashboard/evidence?scanTypes=sast_scan,license_scan",
    tone: "cyan",
  },
  {
    title: "All Security",
    description: "Export evidence records that contain secret, SAST, or dependency findings across the main security lanes.",
    scanTypes: ["secret_scan", "sast_scan", "dependency_scan"],
    detailHref: "/dashboard/evidence?scanTypes=secret_scan,sast_scan,dependency_scan",
    tone: "red",
  },
] as const;

function getScanFindingCount(summary: EvidenceExportBundleResponse["summary"], scanType: string) {
  return summary.scanFindingTotals[scanType] ?? 0;
}

function getPreparationCount(summary: EvidenceExportBundleResponse["summary"], mode: string) {
  return summary.preparationModeTotals[mode] ?? 0;
}

function getGovernanceCount(summary: EvidenceExportBundleResponse["summary"], actionType: string) {
  return summary.governanceActionTotals[actionType] ?? 0;
}

function getDeliveryCount(summary: EvidenceExportBundleResponse["summary"], actionType: string) {
  return summary.deliveryActionTotals[actionType] ?? 0;
}

const FILTERED_VIEW_LINKS = [
  {
    label: "All Evidence",
    href: "/dashboard/evidence",
    description: "Browse every evidence record without export-specific filters.",
    tone: "slate",
  },
  {
    label: "Findings Only",
    href: "/dashboard/evidence?scanFindingsOnly=1",
    description: "Open the evidence list scoped to records with scan findings.",
    tone: "rose",
  },
  {
    label: "Approval Pending",
    href: "/dashboard/evidence?approvalPendingOnly=1",
    description: "Open evidence that still requires human or code owner approval.",
    tone: "amber",
  },
  {
    label: "All Security",
    href: "/dashboard/evidence?scanTypes=secret_scan,sast_scan,dependency_scan",
    description: "Open the list focused on the main security findings lanes.",
    tone: "red",
  },
] as const;

const ACTION_TYPE_META = [
  {
    label: "Approvals",
    actionTypes: ["task_approved"],
    tone: "emerald",
    description: "View approval actions recorded in the evidence trail.",
  },
  {
    label: "Rejections",
    actionTypes: ["task_rejected"],
    tone: "amber",
    description: "View rejection actions recorded in the evidence trail.",
  },
  {
    label: "Stops",
    actionTypes: ["run_stopped"],
    tone: "rose",
    description: "View operator stop actions recorded in the evidence trail.",
  },
  {
    label: "Deliveries",
    actionTypes: ["github_pull_request_created", "github_review_submitted", "github_release_dispatched"],
    tone: "sky",
    description: "View external GitHub-facing delivery actions across PRs, reviews, and releases.",
  },
] as const;

function formatActivityActor(actor: Record<string, unknown> | null) {
  if (!actor) {
    return "Unknown actor";
  }

  const name = typeof actor.name === "string" ? actor.name : null;
  const role = typeof actor.role === "string" ? actor.role : null;
  const source = typeof actor.source === "string" ? actor.source : null;
  const parts = [name, role, source].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "Unknown actor";
}

function formatActivityLabel(type: string) {
  return type.replaceAll("_", " ");
}

export default async function DashboardAuditExportPage() {
  const [
    allBundle,
    findingsBundle,
    approvalPendingBundle,
    findingsAndApprovalBundle,
    secretBundle,
    sastBundle,
    dependencyBundle,
    licenseBundle,
    secretDependencyBundle,
    sastLicenseBundle,
    allSecurityBundle,
    approvalsBundle,
    rejectionsBundle,
    stopsBundle,
    deliveriesBundle,
  ] = await Promise.all([
    getEvidenceExportBundle(),
    getEvidenceExportBundle({ scanFindingsOnly: true }),
    getEvidenceExportBundle({ approvalPendingOnly: true }),
    getEvidenceExportBundle({ scanFindingsOnly: true, approvalPendingOnly: true }),
    getEvidenceExportBundle({ scanTypes: ["secret_scan"] }),
    getEvidenceExportBundle({ scanTypes: ["sast_scan"] }),
    getEvidenceExportBundle({ scanTypes: ["dependency_scan"] }),
    getEvidenceExportBundle({ scanTypes: ["license_scan"] }),
    getEvidenceExportBundle({ scanTypes: ["secret_scan", "dependency_scan"] }),
    getEvidenceExportBundle({ scanTypes: ["sast_scan", "license_scan"] }),
    getEvidenceExportBundle({ scanTypes: ["secret_scan", "sast_scan", "dependency_scan"] }),
    getEvidenceExportBundle({ actionTypes: ["task_approved"] }),
    getEvidenceExportBundle({ actionTypes: ["task_rejected"] }),
    getEvidenceExportBundle({ actionTypes: ["run_stopped"] }),
    getEvidenceExportBundle({
      actionTypes: ["github_pull_request_created", "github_review_submitted", "github_release_dispatched"],
    }),
  ]);
  const scanSpecificModes = [
    {
      title: "Secret Findings",
      description: "Export only evidence records that contain secret exposure findings.",
      scanType: "secret_scan",
      detailHref: "/dashboard/evidence?scanTypes=secret_scan",
      tone: "rose",
      preview: secretBundle.summary,
    },
    {
      title: "SAST Findings",
      description: "Export only evidence records that contain dangerous code-pattern findings.",
      scanType: "sast_scan",
      detailHref: "/dashboard/evidence?scanTypes=sast_scan",
      tone: "orange",
      preview: sastBundle.summary,
    },
    {
      title: "Dependency Findings",
      description: "Export only evidence records that contain supply-chain dependency findings.",
      scanType: "dependency_scan",
      detailHref: "/dashboard/evidence?scanTypes=dependency_scan",
      tone: "amber",
      preview: dependencyBundle.summary,
    },
    {
      title: "License Findings",
      description: "Export only evidence records that contain license or compliance findings.",
      scanType: "license_scan",
      detailHref: "/dashboard/evidence?scanTypes=license_scan",
      tone: "violet",
      preview: licenseBundle.summary,
    },
  ].map((mode) => ({
    ...mode,
    href: getEvidenceExportBundleUrl({ scanTypes: [mode.scanType] }),
    buttonLabel: `Export ${mode.title}`,
  }));
  const combinedScanModes = COMBINED_SCAN_MODES.map((mode) => ({
    ...mode,
    href: getEvidenceExportBundleUrl({ scanTypes: [...mode.scanTypes] }),
    buttonLabel: `Export ${mode.title}`,
    preview:
      mode.title === "Secret + Dependency"
        ? secretDependencyBundle.summary
        : mode.title === "SAST + License"
          ? sastLicenseBundle.summary
          : allSecurityBundle.summary,
  }));
  const actionModes = ACTION_TYPE_META.map((mode) => ({
    ...mode,
    href: getEvidenceExportBundleUrl({ actionTypes: [...mode.actionTypes] }),
    preview:
      mode.label === "Approvals"
        ? approvalsBundle.summary
        : mode.label === "Rejections"
          ? rejectionsBundle.summary
          : mode.label === "Stops"
            ? stopsBundle.summary
            : deliveriesBundle.summary,
  }));

  const exportModes = [
    {
      title: "Full Bundle",
      description: "Export every evidence record currently stored in the control plane.",
      href: getEvidenceExportBundleUrl(),
      detailHref: "/dashboard/evidence",
      buttonLabel: "Export Full",
      preview: allBundle.summary,
      tone: "emerald",
    },
    {
      title: "Findings Only",
      description: "Export only evidence records that contain secret, SAST, dependency, or license findings.",
      href: getEvidenceExportBundleUrl({ scanFindingsOnly: true }),
      detailHref: "/dashboard/evidence?scanFindingsOnly=1",
      buttonLabel: "Export Findings",
      preview: findingsBundle.summary,
      tone: "rose",
    },
    {
      title: "Approval Pending",
      description: "Export only evidence records that still require human review or code owner approval.",
      href: getEvidenceExportBundleUrl({ approvalPendingOnly: true }),
      detailHref: "/dashboard/evidence?approvalPendingOnly=1",
      buttonLabel: "Export Pending",
      preview: approvalPendingBundle.summary,
      tone: "amber",
    },
    {
      title: "Findings + Approval",
      description: "Export only evidence records that both contain scan findings and still require approval.",
      href: getEvidenceExportBundleUrl({ scanFindingsOnly: true, approvalPendingOnly: true }),
      detailHref: "/dashboard/evidence?scanFindingsOnly=1&approvalPendingOnly=1",
      buttonLabel: "Export Combined",
      preview: findingsAndApprovalBundle.summary,
      tone: "violet",
    },
  ] as const;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Audit Export</h1>
        <p className="mt-1 text-sm text-gray-400">
          Prepare structured audit bundles for security, compliance, and approval workflows.
        </p>
      </div>

      <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Open Filtered Views</h2>
            <p className="mt-1 text-sm text-gray-400">
              Switch into the evidence browser when you want to inspect matching records before exporting.
            </p>
          </div>
          <Link
            href="/dashboard/evidence"
            className="inline-flex rounded-md border border-gray-700 px-3 py-2 text-sm font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-950"
          >
            Open Evidence
          </Link>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-4">
          {FILTERED_VIEW_LINKS.map((view) => (
            <Link
              key={view.label}
              href={view.href}
              className={
                view.tone === "rose"
                  ? "rounded-lg border border-rose-900/50 bg-rose-950/20 p-4 transition hover:border-rose-700 hover:bg-rose-950/30"
                  : view.tone === "amber"
                    ? "rounded-lg border border-amber-900/50 bg-amber-950/20 p-4 transition hover:border-amber-700 hover:bg-amber-950/30"
                    : view.tone === "red"
                      ? "rounded-lg border border-red-900/50 bg-red-950/20 p-4 transition hover:border-red-700 hover:bg-red-950/30"
                      : "rounded-lg border border-gray-800 bg-gray-950 p-4 transition hover:border-gray-700 hover:bg-gray-900"
              }
            >
              <p className="text-sm font-semibold text-white">{view.label}</p>
              <p className="mt-2 text-sm text-gray-400">{view.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        {exportModes.map((mode) => (
          <section key={mode.title} className="rounded-lg border border-gray-800 bg-gray-900 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-white">{mode.title}</h2>
                <p className="mt-2 text-sm text-gray-400">{mode.description}</p>
              </div>
              <span
                className={
                  mode.tone === "emerald"
                    ? "rounded-full border border-emerald-900/50 bg-emerald-950/30 px-3 py-1 text-xs font-medium text-emerald-200"
                    : mode.tone === "rose"
                      ? "rounded-full border border-rose-900/50 bg-rose-950/30 px-3 py-1 text-xs font-medium text-rose-200"
                      : mode.tone === "amber"
                        ? "rounded-full border border-amber-900/50 bg-amber-950/30 px-3 py-1 text-xs font-medium text-amber-200"
                        : "rounded-full border border-violet-900/50 bg-violet-950/30 px-3 py-1 text-xs font-medium text-violet-200"
                }
              >
                {mode.preview.evidenceCount} evidence
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Failed Verification</p>
                <p className="mt-2 text-sm font-medium text-white">{mode.preview.failedVerificationCount}</p>
              </div>
              <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Approval Pending</p>
                <p className="mt-2 text-sm font-medium text-white">{mode.preview.approvalPendingCount}</p>
              </div>
              <div className="rounded-md border border-gray-800 bg-gray-950 p-3 sm:col-span-2">
                <p className="text-xs uppercase tracking-wide text-gray-500">Scan Findings</p>
                <p className="mt-2 text-sm font-medium text-white">
                  secret {getScanFindingCount(mode.preview, "secret_scan")} / sast {getScanFindingCount(mode.preview, "sast_scan")} / dependency {getScanFindingCount(mode.preview, "dependency_scan")} / license {getScanFindingCount(mode.preview, "license_scan")}
                </p>
              </div>
              <div className="rounded-md border border-gray-800 bg-gray-950 p-3 sm:col-span-2">
                <p className="text-xs uppercase tracking-wide text-gray-500">Preparation Modes</p>
                <p className="mt-2 text-sm font-medium text-white">
                  worktree {getPreparationCount(mode.preview, "git_worktree")} / synthetic {getPreparationCount(mode.preview, "synthetic_git")} / snapshot {getPreparationCount(mode.preview, "snapshot_copy")} / direct {getPreparationCount(mode.preview, "direct")}
                </p>
              </div>
              <div className="rounded-md border border-gray-800 bg-gray-950 p-3 sm:col-span-2">
                <p className="text-xs uppercase tracking-wide text-gray-500">Governance Actions</p>
                <p className="mt-2 text-sm font-medium text-white">
                  approved {getGovernanceCount(mode.preview, "approved")} / rejected {getGovernanceCount(mode.preview, "rejected")} / stopped {getGovernanceCount(mode.preview, "stopped")} / PR {getDeliveryCount(mode.preview, "github_pull_request_created")} / review {getDeliveryCount(mode.preview, "github_review_submitted")} / release {getDeliveryCount(mode.preview, "github_release_dispatched")}
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                href={mode.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex rounded-md border border-emerald-800 px-3 py-2 text-sm font-medium text-emerald-200 transition hover:border-emerald-700 hover:bg-emerald-950/30"
              >
                {mode.buttonLabel}
              </Link>
              <Link
                href={mode.detailHref}
                className="inline-flex rounded-md border border-gray-700 px-3 py-2 text-sm font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-950"
              >
                View Matching Evidence
              </Link>
            </div>
          </section>
        ))}
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Scan-Type Exports</h2>
          <p className="mt-1 text-sm text-gray-400">
            Export focused bundles for a single security or compliance signal.
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          {scanSpecificModes.map((mode) => (
            <section key={mode.title} className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">{mode.title}</h3>
                  <p className="mt-2 text-sm text-gray-400">{mode.description}</p>
                </div>
                <span
                  className={
                    mode.tone === "rose"
                      ? "rounded-full border border-rose-900/50 bg-rose-950/30 px-3 py-1 text-xs font-medium text-rose-200"
                      : mode.tone === "orange"
                        ? "rounded-full border border-orange-900/50 bg-orange-950/30 px-3 py-1 text-xs font-medium text-orange-200"
                        : mode.tone === "amber"
                          ? "rounded-full border border-amber-900/50 bg-amber-950/30 px-3 py-1 text-xs font-medium text-amber-200"
                          : "rounded-full border border-violet-900/50 bg-violet-950/30 px-3 py-1 text-xs font-medium text-violet-200"
                  }
                >
                  {mode.preview.evidenceCount} evidence
                </span>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Failed Verification</p>
                  <p className="mt-2 text-sm font-medium text-white">{mode.preview.failedVerificationCount}</p>
                </div>
                <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Approval Pending</p>
                  <p className="mt-2 text-sm font-medium text-white">{mode.preview.approvalPendingCount}</p>
                </div>
                <div className="rounded-md border border-gray-800 bg-gray-950 p-3 sm:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Preparation Modes</p>
                  <p className="mt-2 text-sm font-medium text-white">
                    worktree {getPreparationCount(mode.preview, "git_worktree")} / synthetic {getPreparationCount(mode.preview, "synthetic_git")} / snapshot {getPreparationCount(mode.preview, "snapshot_copy")} / direct {getPreparationCount(mode.preview, "direct")}
                  </p>
                </div>
                <div className="rounded-md border border-gray-800 bg-gray-950 p-3 sm:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Governance Actions</p>
                  <p className="mt-2 text-sm font-medium text-white">
                    approved {getGovernanceCount(mode.preview, "approved")} / rejected {getGovernanceCount(mode.preview, "rejected")} / stopped {getGovernanceCount(mode.preview, "stopped")} / PR {getDeliveryCount(mode.preview, "github_pull_request_created")} / review {getDeliveryCount(mode.preview, "github_review_submitted")} / release {getDeliveryCount(mode.preview, "github_release_dispatched")}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  href={mode.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex rounded-md border border-gray-700 px-3 py-2 text-sm font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-950"
                >
                  {mode.buttonLabel}
                </Link>
                <Link
                  href={mode.detailHref}
                  className="inline-flex rounded-md border border-gray-700 px-3 py-2 text-sm font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-950"
                >
                  View Matching Evidence
                </Link>
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Combined Scan Exports</h2>
          <p className="mt-1 text-sm text-gray-400">
            Export focused bundles for the most common cross-scan audit combinations.
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          {combinedScanModes.map((mode) => (
            <section key={mode.title} className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">{mode.title}</h3>
                  <p className="mt-2 text-sm text-gray-400">{mode.description}</p>
                </div>
                <span
                  className={
                    mode.tone === "fuchsia"
                      ? "rounded-full border border-fuchsia-900/50 bg-fuchsia-950/30 px-3 py-1 text-xs font-medium text-fuchsia-200"
                      : mode.tone === "cyan"
                        ? "rounded-full border border-cyan-900/50 bg-cyan-950/30 px-3 py-1 text-xs font-medium text-cyan-200"
                        : "rounded-full border border-red-900/50 bg-red-950/30 px-3 py-1 text-xs font-medium text-red-200"
                  }
                >
                  {mode.preview.evidenceCount} evidence
                </span>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Failed Verification</p>
                  <p className="mt-2 text-sm font-medium text-white">{mode.preview.failedVerificationCount}</p>
                </div>
                <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Approval Pending</p>
                  <p className="mt-2 text-sm font-medium text-white">{mode.preview.approvalPendingCount}</p>
                </div>
                <div className="rounded-md border border-gray-800 bg-gray-950 p-3 sm:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Scan Findings</p>
                  <p className="mt-2 text-sm font-medium text-white">
                    secret {getScanFindingCount(mode.preview, "secret_scan")} / sast {getScanFindingCount(mode.preview, "sast_scan")} / dependency {getScanFindingCount(mode.preview, "dependency_scan")} / license {getScanFindingCount(mode.preview, "license_scan")}
                  </p>
                </div>
                <div className="rounded-md border border-gray-800 bg-gray-950 p-3 sm:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Preparation Modes</p>
                  <p className="mt-2 text-sm font-medium text-white">
                    worktree {getPreparationCount(mode.preview, "git_worktree")} / synthetic {getPreparationCount(mode.preview, "synthetic_git")} / snapshot {getPreparationCount(mode.preview, "snapshot_copy")} / direct {getPreparationCount(mode.preview, "direct")}
                  </p>
                </div>
                <div className="rounded-md border border-gray-800 bg-gray-950 p-3 sm:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Governance Actions</p>
                  <p className="mt-2 text-sm font-medium text-white">
                    approved {getGovernanceCount(mode.preview, "approved")} / rejected {getGovernanceCount(mode.preview, "rejected")} / stopped {getGovernanceCount(mode.preview, "stopped")} / PR {getDeliveryCount(mode.preview, "github_pull_request_created")} / review {getDeliveryCount(mode.preview, "github_review_submitted")} / release {getDeliveryCount(mode.preview, "github_release_dispatched")}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  href={mode.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex rounded-md border border-gray-700 px-3 py-2 text-sm font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-950"
                >
                  {mode.buttonLabel}
                </Link>
                <Link
                  href={mode.detailHref}
                  className="inline-flex rounded-md border border-gray-700 px-3 py-2 text-sm font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-950"
                >
                  View Matching Evidence
                </Link>
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Action-Type Exports</h2>
          <p className="mt-1 text-sm text-gray-400">
            Export governance and delivery evidence by action class instead of by scan lane.
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          {actionModes.map((mode) => (
            <section key={mode.label} className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">{mode.label}</h3>
                  <p className="mt-2 text-sm text-gray-400">{mode.description}</p>
                </div>
                <span
                  className={
                    mode.tone === "emerald"
                      ? "rounded-full border border-emerald-900/50 bg-emerald-950/30 px-3 py-1 text-xs font-medium text-emerald-200"
                      : mode.tone === "amber"
                        ? "rounded-full border border-amber-900/50 bg-amber-950/30 px-3 py-1 text-xs font-medium text-amber-200"
                        : mode.tone === "rose"
                          ? "rounded-full border border-rose-900/50 bg-rose-950/30 px-3 py-1 text-xs font-medium text-rose-200"
                          : "rounded-full border border-sky-900/50 bg-sky-950/30 px-3 py-1 text-xs font-medium text-sky-200"
                  }
                >
                  {mode.preview.evidenceCount} evidence
                </span>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Failed Verification</p>
                  <p className="mt-2 text-sm font-medium text-white">{mode.preview.failedVerificationCount}</p>
                </div>
                <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Approval Pending</p>
                  <p className="mt-2 text-sm font-medium text-white">{mode.preview.approvalPendingCount}</p>
                </div>
                <div className="rounded-md border border-gray-800 bg-gray-950 p-3 sm:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Governance Actions</p>
                  <p className="mt-2 text-sm font-medium text-white">
                    approved {getGovernanceCount(mode.preview, "approved")} / rejected {getGovernanceCount(mode.preview, "rejected")} / stopped {getGovernanceCount(mode.preview, "stopped")}
                  </p>
                </div>
                <div className="rounded-md border border-gray-800 bg-gray-950 p-3 sm:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Delivery Actions</p>
                  <p className="mt-2 text-sm font-medium text-white">
                    PR {getDeliveryCount(mode.preview, "github_pull_request_created")} / review {getDeliveryCount(mode.preview, "github_review_submitted")} / release {getDeliveryCount(mode.preview, "github_release_dispatched")} / sync {getDeliveryCount(mode.preview, "github_release_status_synced")}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  href={mode.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex rounded-md border border-gray-700 px-3 py-2 text-sm font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-950"
                >
                  Export {mode.label}
                </Link>
                <Link
                  href="/dashboard/evidence"
                  className="inline-flex rounded-md border border-gray-700 px-3 py-2 text-sm font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-950"
                >
                  View Evidence
                </Link>
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Recent Audit Activity</h2>
            <p className="mt-1 text-sm text-gray-400">
              Time-ordered governance and delivery actions extracted from evidence bundles.
            </p>
          </div>
          <Link
            href={getEvidenceExportBundleUrl()}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-md border border-gray-700 px-3 py-2 text-sm font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-950"
          >
            Export Full Activity
          </Link>
        </div>

        <div className="mt-5 space-y-3">
          {allBundle.activity.length > 0 ? (
            allBundle.activity.slice(0, 12).map((activity, index) => (
              <div
                key={`${activity.evidenceId}-${activity.type}-${activity.timestamp ?? index}`}
                className="rounded-md border border-gray-800 bg-gray-950 p-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">{formatActivityLabel(activity.type)}</p>
                    <p className="mt-2 text-sm font-medium text-white">{activity.repo ?? "Unknown repo"}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      Actor: {formatActivityActor(activity.actor)}{activity.runId ? ` · Run ${activity.runId.slice(0, 8)}` : ""}{activity.taskId ? ` · Task ${activity.taskId.slice(0, 8)}` : ""}
                    </p>
                  </div>
                  <div className="text-left lg:text-right">
                    <p className="text-xs text-gray-500">
                      {activity.timestamp ? new Date(activity.timestamp).toLocaleString() : "No timestamp"}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 lg:justify-end">
                      {activity.runId ? (
                        <Link
                          href={`/dashboard/runs/${activity.runId}`}
                          className="inline-flex rounded-md border border-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-900"
                        >
                          Open Run
                        </Link>
                      ) : null}
                      {activity.targetUrl ? (
                        <Link
                          href={activity.targetUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex rounded-md border border-sky-800 px-3 py-2 text-xs font-medium text-sky-200 transition hover:border-sky-700 hover:bg-sky-950/30"
                        >
                          Open Target
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-md border border-dashed border-gray-800 bg-gray-950 p-4 text-sm text-gray-500">
              No governance or delivery actions have been captured in evidence yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
