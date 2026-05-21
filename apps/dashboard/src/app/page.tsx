import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-950 text-white">
      <main className="flex flex-col items-center gap-8 px-4 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          AI-Native CI/CD Control Plane
        </h1>
        <p className="max-w-2xl text-lg text-gray-400">
          Orchestrate autonomous agents, manage tasks, review evidence, and
          enforce policies across your delivery pipeline.
        </p>
        <Link
          href="/dashboard"
          className="rounded-md bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 transition-colors"
        >
          Open Dashboard
        </Link>
      </main>
    </div>
  );
}
