"use client";

import { useEffect, useState } from "react";

import { formatDuration } from "@/lib/format";

interface LiveDurationProps {
  createdAt: Date;
}

/**
 * Self-ticking duration display for active conversations.
 * Updates every second to show elapsed time since creation.
 */
export function LiveDuration({ createdAt }: LiveDurationProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="font-mono tabular-nums text-indigo-600 dark:text-indigo-400">
      {formatDuration(createdAt, now)}
    </span>
  );
}
