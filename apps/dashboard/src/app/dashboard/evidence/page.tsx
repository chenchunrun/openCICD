import Link from "next/link";
import { getEvidenceExportBundleUrl, getEvidences, type Evidence } from "@/lib/api-client";

function summarizeVerification(section?: Record<string, unknown> | null) {
  if (!section || Object.keys(section).length === 0) {
    return "No checks";
  }

  const counts = {
    passed: 0,
    failed: 0,
    skipped: 0,
  };

  for (const status of Object.values(section)) {
    if (status === "passed" || status === "failed" || status === "skipped") {
      counts[status] += 1;
    }
  }

  const parts = [];
  if (counts.passed > 0) parts.push(`${counts.passed} passed`);
  if (counts.failed > 0) parts.push(`${counts.failed} failed`);
  if (counts.skipped > 0) parts.push(`${counts.skipped} skipped`);
  return parts.join(", ") || "No checks";
}

function summarizeEvidenceScans(section?: Evidence["verificationSection"]) {
  const scanFindings =
    section?.scanFindings && typeof section.scanFindings === "object"
      ? (section.scanFindings as Record<string, unknown>)
      : null;

  if (!scanFindings) {
    return "No scan findings";
  }

  const parts = [
    Array.isArray(scanFindings.secret_scan) && scanFindings.secret_scan.length > 0
      ? `secret ${scanFindings.secret_scan.length}`
      : null,
    Array.isArray(scanFindings.sast_scan) && scanFindings.sast_scan.length > 0
      ? `sast ${scanFindings.sast_scan.length}`
      : null,
    Array.isArray(scanFindings.dependency_scan) && scanFindings.dependency_scan.length > 0
      ? `dependency ${scanFindings.dependency_scan.length}`
      : null,
    Array.isArray(scanFindings.license_scan) && scanFindings.license_scan.length > 0
      ? `license ${scanFindings.license_scan.length}`
      : null,
  ].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(" / ") : "No scan findings";
}

function summarizeReview(section?: {
  aiReview?: string;
  humanReview?: string;
  codeOwnerApproval?: string;
} | null) {
  if (!section) {
    return "No review";
  }

  return [section.aiReview, section.humanReview, section.codeOwnerApproval]
    .filter((value): value is string => Boolean(value))
    .join(" / ") || "No review";
}

function summarizeScans(section?: Record<string, unknown> | null) {
  if (!section) {
    return null;
  }

  const blocked = [
    section.secret_scan === "failed" ? "secret" : null,
    section.sast_scan === "failed" ? "sast" : null,
    section.dependency_scan === "failed" ? "dependency" : null,
    section.license_scan === "failed" ? "license" : null,
  ].filter((value): value is string => Boolean(value));

  if (blocked.length === 0) {
    return "No scan blocks";
  }

  return `${blocked.join(" / ")} blocked`;
}

function countScanFindings(section?: Evidence["verificationSection"]) {
  const scanFindings =
    section?.scanFindings && typeof section.scanFindings === "object"
      ? (section.scanFindings as Record<string, unknown>)
      : null;

  if (!scanFindings) {
    return {
      secret: 0,
      sast: 0,
      dependency: 0,
      license: 0,
    };
  }

  return {
    secret: Array.isArray(scanFindings.secret_scan) ? scanFindings.secret_scan.length : 0,
    sast: Array.isArray(scanFindings.sast_scan) ? scanFindings.sast_scan.length : 0,
    dependency: Array.isArray(scanFindings.dependency_scan) ? scanFindings.dependency_scan.length : 0,
    license: Array.isArray(scanFindings.license_scan) ? scanFindings.license_scan.length : 0,
  };
}

const SCAN_TYPE_META = {
  secret_scan: {
    label: "Secret",
    buttonLabel: "Export Secret Findings",
    buttonClass:
      "inline-flex rounded-md border border-rose-800 px-3 py-2 text-sm font-medium text-rose-200 transition hover:border-rose-700 hover:bg-rose-950/30",
  },
  sast_scan: {
    label: "SAST",
    buttonLabel: "Export SAST Findings",
    buttonClass:
      "inline-flex rounded-md border border-orange-800 px-3 py-2 text-sm font-medium text-orange-200 transition hover:border-orange-700 hover:bg-orange-950/30",
  },
  dependency_scan: {
    label: "Dependency",
    buttonLabel: "Export Dependency Findings",
    buttonClass:
      "inline-flex rounded-md border border-amber-800 px-3 py-2 text-sm font-medium text-amber-200 transition hover:border-amber-700 hover:bg-amber-950/30",
  },
  license_scan: {
    label: "License",
    buttonLabel: "Export License Findings",
    buttonClass:
      "inline-flex rounded-md border border-violet-800 px-3 py-2 text-sm font-medium text-violet-200 transition hover:border-violet-700 hover:bg-violet-950/30",
  },
} as const;

const COMBINED_SCAN_EXPORTS = [
  {
    label: "Export Secret + Dependency",
    scanTypes: ["secret_scan", "dependency_scan"],
    buttonClass:
      "inline-flex rounded-md border border-fuchsia-800 px-3 py-2 text-sm font-medium text-fuchsia-200 transition hover:border-fuchsia-700 hover:bg-fuchsia-950/30",
  },
  {
    label: "Export SAST + License",
    scanTypes: ["sast_scan", "license_scan"],
    buttonClass:
      "inline-flex rounded-md border border-cyan-800 px-3 py-2 text-sm font-medium text-cyan-200 transition hover:border-cyan-700 hover:bg-cyan-950/30",
  },
  {
    label: "Export All Security",
    scanTypes: ["secret_scan", "sast_scan", "dependency_scan"],
    buttonClass:
      "inline-flex rounded-md border border-red-800 px-3 py-2 text-sm font-medium text-red-200 transition hover:border-red-700 hover:bg-red-950/30",
  },
] as const;

const FILTER_CHIPS = [
  { label: "All Evidence", href: "/dashboard/evidence", tone: "slate" },
  { label: "Findings Only", href: "/dashboard/evidence?scanFindingsOnly=1", tone: "rose" },
  { label: "Approval Pending", href: "/dashboard/evidence?approvalPendingOnly=1", tone: "amber" },
  { label: "Secret", href: "/dashboard/evidence?scanTypes=secret_scan", tone: "rose" },
  { label: "SAST", href: "/dashboard/evidence?scanTypes=sast_scan", tone: "orange" },
  { label: "Dependency", href: "/dashboard/evidence?scanTypes=dependency_scan", tone: "amber" },
  { label: "License", href: "/dashboard/evidence?scanTypes=license_scan", tone: "violet" },
  {
    label: "Secret + Dependency",
    href: "/dashboard/evidence?scanTypes=secret_scan,dependency_scan",
    tone: "fuchsia",
  },
  {
    label: "SAST + License",
    href: "/dashboard/evidence?scanTypes=sast_scan,license_scan",
    tone: "cyan",
  },
  {
    label: "All Security",
    href: "/dashboard/evidence?scanTypes=secret_scan,sast_scan,dependency_scan",
    tone: "red",
  },
] as const;

export default async function DashboardEvidencePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const evidences = await getEvidences();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const runIdFilter = typeof resolvedSearchParams?.runId === "string" ? resolvedSearchParams.runId : undefined;
  const scanFindingsOnly =
    typeof resolvedSearchParams?.scanFindingsOnly === "string" &&
    (resolvedSearchParams.scanFindingsOnly === "1" || resolvedSearchParams.scanFindingsOnly === "true");
  const approvalPendingOnly =
    typeof resolvedSearchParams?.approvalPendingOnly === "string" &&
    (resolvedSearchParams.approvalPendingOnly === "1" || resolvedSearchParams.approvalPendingOnly === "true");
  const scanTypesFilter =
    typeof resolvedSearchParams?.scanTypes === "string"
      ? resolvedSearchParams.scanTypes.split(",").map((value) => value.trim()).filter(Boolean)
      : [];
  const runScopedEvidences = runIdFilter
    ? evidences.filter((evidence) => evidence.runId === runIdFilter)
    : evidences;
  const filteredEvidences = runScopedEvidences.filter((evidence) => {
    const scanCounts = countScanFindings(evidence.verificationSection);
    const hasScanFindings =
      scanCounts.secret + scanCounts.sast + scanCounts.dependency + scanCounts.license > 0;
    const isApprovalPending =
      evidence.reviewSection?.humanReview === "required" ||
      evidence.reviewSection?.codeOwnerApproval === "pending";

    if (scanFindingsOnly && !hasScanFindings) {
      return false;
    }
    if (approvalPendingOnly && !isApprovalPending) {
      return false;
    }
    if (scanTypesFilter.length > 0) {
      const scanMap = {
        secret_scan: scanCounts.secret,
        sast_scan: scanCounts.sast,
        dependency_scan: scanCounts.dependency,
        license_scan: scanCounts.license,
      };
      return scanTypesFilter.some((scanType) => (scanMap[scanType as keyof typeof scanMap] ?? 0) > 0);
    }
    return true;
  });
  const exportAllBundleUrl = getEvidenceExportBundleUrl(
    runIdFilter ? { runIds: [runIdFilter] } : undefined,
  );
  const exportFindingsBundleUrl = getEvidenceExportBundleUrl(
    runIdFilter
      ? { runIds: [runIdFilter], scanFindingsOnly: true }
      : { scanFindingsOnly: true },
  );
  const exportApprovalPendingBundleUrl = getEvidenceExportBundleUrl(
    runIdFilter
      ? { runIds: [runIdFilter], approvalPendingOnly: true }
      : { approvalPendingOnly: true },
  );
  const scanTypeExports = Object.entries(SCAN_TYPE_META).map(([scanType, meta]) => ({
    scanType,
    ...meta,
    href: getEvidenceExportBundleUrl(
      runIdFilter
        ? { runIds: [runIdFilter], scanTypes: [scanType] }
        : { scanTypes: [scanType] },
    ),
  }));
  const combinedScanExports = COMBINED_SCAN_EXPORTS.map((combo) => ({
    ...combo,
    href: getEvidenceExportBundleUrl(
      runIdFilter
        ? { runIds: [runIdFilter], scanTypes: [...combo.scanTypes] }
        : { scanTypes: [...combo.scanTypes] },
    ),
  }));
  const activeScanTypeLabels = scanTypesFilter
    .map((scanType) => SCAN_TYPE_META[scanType as keyof typeof SCAN_TYPE_META]?.label)
    .filter(Boolean);
  const exportPreview = filteredEvidences.reduce(
    (acc, evidence) => {
      const scanCounts = countScanFindings(evidence.verificationSection);
      const verificationFailed = Object.values(evidence.verificationSection ?? {}).includes("failed");
      const approvalPending =
        evidence.reviewSection?.humanReview === "required" ||
        evidence.reviewSection?.codeOwnerApproval === "pending";

      return {
        evidenceCount: acc.evidenceCount + 1,
        failedVerificationCount: acc.failedVerificationCount + (verificationFailed ? 1 : 0),
        approvalPendingCount: acc.approvalPendingCount + (approvalPending ? 1 : 0),
        secret: acc.secret + scanCounts.secret,
        sast: acc.sast + scanCounts.sast,
        dependency: acc.dependency + scanCounts.dependency,
        license: acc.license + scanCounts.license,
      };
    },
    {
      evidenceCount: 0,
      failedVerificationCount: 0,
      approvalPendingCount: 0,
      secret: 0,
      sast: 0,
      dependency: 0,
      license: 0,
    },
  );
  const activeFilterKey = runIdFilter
    ? `run:${runIdFilter}`
    : `${scanFindingsOnly ? "findings" : ""}|${approvalPendingOnly ? "approval" : ""}|${scanTypesFilter.join(",")}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
        <h1 className="text-2xl font-bold text-white">Evidence</h1>
        <p className="mt-1 text-sm text-gray-400">
          Review generated evidence bundles and jump back to their associated runs.
        </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={exportAllBundleUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-md border border-emerald-800 px-3 py-2 text-sm font-medium text-emerald-200 transition hover:border-emerald-700 hover:bg-emerald-950/30"
          >
            Export Bundle
          </Link>
          <Link
            href={exportFindingsBundleUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-md border border-rose-800 px-3 py-2 text-sm font-medium text-rose-200 transition hover:border-rose-700 hover:bg-rose-950/30"
          >
            Export Findings Only
          </Link>
          <Link
            href={exportApprovalPendingBundleUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-md border border-amber-800 px-3 py-2 text-sm font-medium text-amber-200 transition hover:border-amber-700 hover:bg-amber-950/30"
          >
            Export Approval Pending
          </Link>
          {scanTypeExports.map((scanExport) => (
            <Link
              key={scanExport.scanType}
              href={scanExport.href}
              target="_blank"
              rel="noreferrer"
              className={scanExport.buttonClass}
            >
              {scanExport.buttonLabel}
            </Link>
          ))}
          {combinedScanExports.map((scanExport) => (
            <Link
              key={scanExport.label}
              href={scanExport.href}
              target="_blank"
              rel="noreferrer"
              className={scanExport.buttonClass}
            >
              {scanExport.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Quick Filters</h2>
            <p className="mt-1 text-sm text-gray-500">
              Jump the evidence list to common scan and approval views.
            </p>
          </div>
          <span className="rounded-full border border-sky-900/50 bg-sky-950/30 px-3 py-1 text-xs font-medium text-sky-200">
            {filteredEvidences.length} matching
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {FILTER_CHIPS.map((chip) => {
            const isActive =
              (!runIdFilter &&
                ((chip.href === "/dashboard/evidence" && activeFilterKey === "||") ||
                  (chip.href.includes("scanFindingsOnly=1") && scanFindingsOnly && scanTypesFilter.length === 0 && !approvalPendingOnly) ||
                  (chip.href.includes("approvalPendingOnly=1") && approvalPendingOnly && scanTypesFilter.length === 0 && !scanFindingsOnly) ||
                  (chip.href.includes("scanTypes=") &&
                    chip.href.split("scanTypes=")[1] === scanTypesFilter.join(",")))) ||
              false;

            const className =
              chip.tone === "rose"
                ? isActive
                  ? "inline-flex rounded-full border border-rose-700 bg-rose-950/40 px-3 py-1.5 text-sm font-medium text-rose-100"
                  : "inline-flex rounded-full border border-rose-900/50 bg-rose-950/20 px-3 py-1.5 text-sm font-medium text-rose-200 transition hover:border-rose-700 hover:bg-rose-950/30"
                : chip.tone === "orange"
                  ? isActive
                    ? "inline-flex rounded-full border border-orange-700 bg-orange-950/40 px-3 py-1.5 text-sm font-medium text-orange-100"
                    : "inline-flex rounded-full border border-orange-900/50 bg-orange-950/20 px-3 py-1.5 text-sm font-medium text-orange-200 transition hover:border-orange-700 hover:bg-orange-950/30"
                  : chip.tone === "amber"
                    ? isActive
                      ? "inline-flex rounded-full border border-amber-700 bg-amber-950/40 px-3 py-1.5 text-sm font-medium text-amber-100"
                      : "inline-flex rounded-full border border-amber-900/50 bg-amber-950/20 px-3 py-1.5 text-sm font-medium text-amber-200 transition hover:border-amber-700 hover:bg-amber-950/30"
                    : chip.tone === "violet"
                      ? isActive
                        ? "inline-flex rounded-full border border-violet-700 bg-violet-950/40 px-3 py-1.5 text-sm font-medium text-violet-100"
                        : "inline-flex rounded-full border border-violet-900/50 bg-violet-950/20 px-3 py-1.5 text-sm font-medium text-violet-200 transition hover:border-violet-700 hover:bg-violet-950/30"
                      : chip.tone === "fuchsia"
                        ? isActive
                          ? "inline-flex rounded-full border border-fuchsia-700 bg-fuchsia-950/40 px-3 py-1.5 text-sm font-medium text-fuchsia-100"
                          : "inline-flex rounded-full border border-fuchsia-900/50 bg-fuchsia-950/20 px-3 py-1.5 text-sm font-medium text-fuchsia-200 transition hover:border-fuchsia-700 hover:bg-fuchsia-950/30"
                        : chip.tone === "cyan"
                          ? isActive
                            ? "inline-flex rounded-full border border-cyan-700 bg-cyan-950/40 px-3 py-1.5 text-sm font-medium text-cyan-100"
                            : "inline-flex rounded-full border border-cyan-900/50 bg-cyan-950/20 px-3 py-1.5 text-sm font-medium text-cyan-200 transition hover:border-cyan-700 hover:bg-cyan-950/30"
                          : chip.tone === "red"
                            ? isActive
                              ? "inline-flex rounded-full border border-red-700 bg-red-950/40 px-3 py-1.5 text-sm font-medium text-red-100"
                              : "inline-flex rounded-full border border-red-900/50 bg-red-950/20 px-3 py-1.5 text-sm font-medium text-red-200 transition hover:border-red-700 hover:bg-red-950/30"
                            : isActive
                              ? "inline-flex rounded-full border border-slate-600 bg-slate-900/70 px-3 py-1.5 text-sm font-medium text-white"
                              : "inline-flex rounded-full border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm font-medium text-gray-200 transition hover:border-gray-600 hover:bg-gray-900";

            return (
              <Link key={chip.label} href={chip.href} className={className}>
                {chip.label}
              </Link>
            );
          })}
        </div>
      </div>

      {runIdFilter || scanFindingsOnly || approvalPendingOnly || scanTypesFilter.length > 0 ? (
        <div className="rounded-lg border border-sky-800 bg-sky-950/50 px-4 py-3 text-sm text-sky-200">
          Showing
          {runIdFilter ? ` evidence for run ${runIdFilter}` : " evidence"} 
          {scanFindingsOnly ? " with scan findings only" : ""}
          {approvalPendingOnly ? `${scanFindingsOnly ? " and" : " with"} approval pending only` : ""}.{" "}
          {activeScanTypeLabels.length > 0
            ? `${scanFindingsOnly || approvalPendingOnly ? " Filtered to" : " with"} ${activeScanTypeLabels.join(", ")} findings only. `
            : ""}
          <Link href="/dashboard/evidence" className="underline decoration-sky-500/60 underline-offset-4">
            Clear filter
          </Link>
        </div>
      ) : null}

      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Export Preview</h2>
            <p className="mt-1 text-sm text-gray-500">
              Summary for the bundle that will be exported from the current view.
            </p>
          </div>
          <span className="rounded-full border border-emerald-900/50 bg-emerald-950/30 px-3 py-1 text-xs font-medium text-emerald-200">
            {exportPreview.evidenceCount} evidence
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Verification</p>
            <p className="mt-2 text-sm font-medium text-white">
              {exportPreview.failedVerificationCount} failed
            </p>
          </div>
          <div className="rounded-md border border-gray-800 bg-gray-950 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500">Approval Pending</p>
            <p className="mt-2 text-sm font-medium text-white">
              {exportPreview.approvalPendingCount}
            </p>
          </div>
          <div className="rounded-md border border-gray-800 bg-gray-950 p-3 sm:col-span-2">
            <p className="text-xs uppercase tracking-wide text-gray-500">Scan Findings</p>
            <p className="mt-2 text-sm font-medium text-white">
              secret {exportPreview.secret} / sast {exportPreview.sast} / dependency {exportPreview.dependency} / license {exportPreview.license}
            </p>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
        <table className="min-w-full divide-y divide-gray-800 text-sm">
          <thead className="bg-gray-950/60 text-left text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">Evidence ID</th>
              <th className="px-4 py-3 font-medium">Task</th>
              <th className="px-4 py-3 font-medium">Run</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Execution</th>
              <th className="px-4 py-3 font-medium">Verification</th>
              <th className="px-4 py-3 font-medium">Review</th>
              <th className="px-4 py-3 font-medium">Schema</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {filteredEvidences.map((evidence) => (
              <tr
                key={evidence.id}
                className={runIdFilter === evidence.runId ? "bg-sky-950/20" : undefined}
              >
                <td className="px-4 py-3 text-white">{evidence.id.slice(0, 8)}</td>
                <td className="px-4 py-3 text-gray-300">{evidence.taskId ?? "-"}</td>
                <td className="px-4 py-3 text-gray-300">
                  {evidence.runId ? (
                    <Link
                      href={`/dashboard/runs/${evidence.runId}`}
                      className="text-sky-300 transition hover:text-sky-200"
                    >
                      {evidence.runId.slice(0, 8)}
                    </Link>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-4 py-3 text-gray-300">{evidence.status}</td>
                <td className="px-4 py-3 text-gray-300">
                  <div>
                    <div>{evidence.executionSection?.filesChanged?.length ?? 0} files</div>
                    <div className="mt-1 text-xs text-gray-500">
                      {evidence.executionSection?.commandsRun?.length ?? 0} commands
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-300">
                  <span
                    className={
                      Object.values(evidence.verificationSection ?? {}).includes("failed")
                        ? "text-red-300"
                        : "text-gray-300"
                    }
                  >
                    {summarizeVerification(evidence.verificationSection)}
                  </span>
                  <div
                    className={
                      summarizeScans(evidence.verificationSection)?.includes("blocked")
                        ? "mt-1 text-xs text-rose-300"
                        : "mt-1 text-xs text-gray-500"
                    }
                  >
                    {summarizeScans(evidence.verificationSection) ?? "No scan data"}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {summarizeEvidenceScans(evidence.verificationSection)}
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-300">
                  <span
                    className={
                      evidence.reviewSection?.codeOwnerApproval === "rejected"
                        ? "text-red-300"
                        : evidence.reviewSection?.codeOwnerApproval === "approved"
                          ? "text-emerald-300"
                          : "text-gray-300"
                    }
                  >
                    {summarizeReview(evidence.reviewSection)}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-300">{evidence.schemaVersion ?? "1.0"}</td>
                <td className="px-4 py-3 text-gray-400">
                  {new Date(evidence.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
            {filteredEvidences.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                  {runIdFilter
                    ? "No evidence records found for this run."
                    : "No evidence records generated yet."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
