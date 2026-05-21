import Link from "next/link";

const navItems = [
  { label: "Overview", href: "/dashboard" },
  { label: "Failures", href: "/dashboard/failures" },
  { label: "Repos", href: "/dashboard/repos" },
  { label: "Tasks", href: "/dashboard/tasks" },
  { label: "Runs", href: "/dashboard/runs" },
  { label: "Release", href: "/dashboard/release" },
  { label: "Evidence", href: "/dashboard/evidence" },
  { label: "Audit Export", href: "/dashboard/audit-export" },
  { label: "Policies", href: "/dashboard/policies" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-gray-950 text-gray-100">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-gray-800 bg-gray-900">
        <div className="flex h-16 items-center border-b border-gray-800 px-6">
          <Link href="/dashboard" className="text-lg font-semibold text-white">
            AICP
          </Link>
        </div>
        <nav className="mt-4 flex flex-col gap-1 px-3">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
