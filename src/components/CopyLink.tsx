"use client";

import { useState } from "react";

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() =>
        navigator.clipboard.writeText(url).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2_000);
          },
          () => setCopied(false),
        )
      }
      className="rounded-full border border-line px-4 py-2 text-sm font-medium hover:border-ink"
    >
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}
