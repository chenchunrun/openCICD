import Link from "next/link";
import { getEvidenceExportBundleUrl, getEvidences, type Evidence } from "@/lib/api-client";

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

function buildExportPreview(evidences: Evidence[]) {
  return evidences.reduce(
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
}

function hasScanFindings(evidence: Evidence) {
  const scanCounts = countScanFindings(evidence.verificationSection);
  return scanCounts.secret + scanCounts.sast + scanCounts.dependency + scanCounts.license > 0;
}

function isApprovalPending(evidence: Evidence) {
  return (
    evidence.reviewSection?.humanReview === "required" ||
    evidence.reviewSection?.codeOwnerApproval === "pending"
  );
}

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

export default async function DashboardAuditExportPage() {
  const evidences = await getEvidences();
  const allPreview = buildExportPreview(evidences);
  const findingsOnly = evidences.filter(hasScanFindings);
  const findingsPreview = buildExportPreview(findingsOnly);
  const approvalPendingOnly = evidences.filter(isApprovalPending);
  const approvalPreview = buildExportPreview(approvalPendingOnly);
  const findingsAndApprovalPending = evidences.filter(
    (evidence) => hasScanFindings(evidence) && isApprovalPending(evidence),
  );
  const findingsAndApprovalPreview = buildExportPreview(findingsAndApprovalPending);
  const scanSpecificModes = [
    {
      title: "Secret Findings",
      description: "Export only evidence records that contain secret exposure findings.",
      scanType: "secret_scan",
      detailHref: "/dashboard/evidence?scanTypes=secret_scan",
      tone: "rose",
    },
    {
      title: "SAST Findings",
      description: "Export only evidence records that contain dangerous code-pattern findings.",
      scanType: "sast_scan",
      detailHref: "/dashboard/evidence?scanTypes=sast_scan",
      tone: "orange",
    },
    {
      title: "Dependency Findings",
      description: "Export only evidence records that contain supply-chain dependency findings.",
      scanType: "dependency_scan",
      detailHref: "/dashboard/evidence?scanTypes=dependency_scan",
      tone: "amber",
    },
    {
      title: "License Findings",
      description: "Export only evidence records that contain license or compliance findings.",
      scanType: "license_scan",
      detailHref: "/dashboard/evidence?scanTypes=license_scan",
      tone: "violet",
    },
  ].map((mode) => {
    const filtered = evidences.filter((evidence) => {
      const scanCounts = countScanFindings(evidence.verificationSection);
      const scanMap = {
        secret_scan: scanCounts.secret,
        sast_scan: scanCounts.sast,
        dependency_scan: scanCounts.dependency,
        license_scan: scanCounts.license,
      };
      return (scanMap[mode.scanType as keyof typeof scanMap] ?? 0) > 0;
    });

    return {
      ...mode,
      href: getEvidenceExportBundleUrl({ scanTypes: [mode.scanType] }),
      buttonLabel: `Export ${mode.title}`,
      preview: buildExportPreview(filtered),
    };
  });
  const combinedScanModes = COMBINED_SCAN_MODES.map((mode) => {
    const filtered = evidences.filter((evidence) => {
      const scanCounts = countScanFindings(evidence.verificationSection);
      const scanMap = {
        secret_scan: scanCounts.secret,
        sast_scan: scanCounts.sast,
        dependency_scan: scanCounts.dependency,
        license_scan: scanCounts.license,
      };
      return mode.scanTypes.some((scanType) => (scanMap[scanType as keyof typeof scanMap] ?? 0) > 0);
    });

    return {
      ...mode,
      href: getEvidenceExportBundleUrl({ scanTypes: [...mode.scanTypes] }),
      buttonLabel: `Export ${mode.title}`,
      preview: buildExportPreview(filtered),
    };
  });

  const exportModes = [
    {
      title: "Full Bundle",
      description: "Export every evidence record currently stored in the control plane.",
      href: getEvidenceExportBundleUrl(),
      detailHref: "/dashboard/evidence",
      buttonLabel: "Export Full",
      preview: allPreview,
      tone: "emerald",
    },
    {
      title: "Findings Only",
      description: "Export only evidence records that contain secret, SAST, dependency, or license findings.",
      href: getEvidenceExportBundleUrl({ scanFindingsOnly: true }),
      detailHref: "/dashboard/evidence?scanFindingsOnly=1",
      buttonLabel: "Export Findings",
      preview: findingsPreview,
      tone: "rose",
    },
    {
      title: "Approval Pending",
      description: "Export only evidence records that still require human review or code owner approval.",
      href: getEvidenceExportBundleUrl({ approvalPendingOnly: true }),
      detailHref: "/dashboard/evidence?approvalPendingOnly=1",
      buttonLabel: "Export Pending",
      preview: approvalPreview,
      tone: "amber",
    },
    {
      title: "Findings + Approval",
      description: "Export only evidence records that both contain scan findings and still require approval.",
      href: getEvidenceExportBundleUrl({ scanFindingsOnly: true, approvalPendingOnly: true }),
      detailHref: "/dashboard/evidence?scanFindingsOnly=1&approvalPendingOnly=1",
      buttonLabel: "Export Combined",
      preview: findingsAndApprovalPreview,
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
                  secret {mode.preview.secret} / sast {mode.preview.sast} / dependency {mode.preview.dependency} / license {mode.preview.license}
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
                    secret {mode.preview.secret} / sast {mode.preview.sast} / dependency {mode.preview.dependency} / license {mode.preview.license}
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
    </div>
  );
}
