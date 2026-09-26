import { SiteHeader } from "@/components/SiteShell";

/* What a page looks like while its data is on the way: the shell, and the
 * shapes of what is coming, so nothing jumps when it lands. */
export function PageSkeleton({ tiles = 4, rows = 2 }: { tiles?: number; rows?: number }) {
  return (
    <>
      <SiteHeader />
      <main id="content" className="mx-auto max-w-6xl px-4 py-14 sm:px-6" aria-busy="true" aria-label="Loading">
        <div className="h-3 w-24 animate-pulse rounded bg-line" />
        <div className="mt-5 h-10 w-2/3 max-w-md animate-pulse rounded bg-line" />
        <div className="mt-4 h-5 w-full max-w-2xl animate-pulse rounded bg-line" />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: tiles }, (_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-line bg-card" />
          ))}
        </div>
        <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: rows * 3 }, (_, i) => (
            <div key={i} className="h-72 animate-pulse rounded-xl border border-line bg-card" />
          ))}
        </div>
      </main>
    </>
  );
}
