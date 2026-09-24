/* The mark is a receipt slip with a tick: a record that something was paid. */
export function Mark({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M5.5 2h13A1.5 1.5 0 0 1 20 3.5V22l-2.67-1.6L14.67 22 12 20.4 9.33 22l-2.66-1.6L4 22V3.5A1.5 1.5 0 0 1 5.5 2Z"
        fill="currentColor"
      />
      <path
        d="m8.25 11.25 2.5 2.5 5-5"
        fill="none"
        stroke="var(--paper)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <Mark />
      <span className="text-lg">earnout</span>
    </span>
  );
}
