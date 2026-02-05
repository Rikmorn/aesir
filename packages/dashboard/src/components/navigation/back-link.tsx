"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

// ─── BackLink ─────────────────────────────────────────────────────────────────

interface BackLinkProps {
  /** Fallback URL when there's no browser history to go back to */
  fallbackHref: string;
}

/**
 * Smart back link that uses browser history when available.
 *
 * If the user navigated from within the same site, uses browser history
 * to go back (preserving any URL state like filters).
 * Falls back to fallbackHref for direct navigation (no referrer).
 */
export function BackLink({ fallbackHref }: BackLinkProps) {
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    // Check if we have a referrer from our own site
    const referrer = document.referrer;
    const isFromSameSite =
      !!referrer && referrer.includes(window.location.origin);

    setCanGoBack(isFromSameSite);
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (canGoBack) {
        e.preventDefault();
        router.back();
      }
      // Otherwise, let the Link navigate normally
    },
    [canGoBack, router],
  );

  return (
    <Link
      href={fallbackHref}
      onClick={handleClick}
      className="text-sm text-muted-foreground hover:text-foreground"
    >
      &larr; Back
    </Link>
  );
}

// ─── Convenience exports for common pages ─────────────────────────────────────

export function BackToConversations() {
  return <BackLink fallbackHref="/conversations" />;
}

export function BackToAgents() {
  return <BackLink fallbackHref="/agents" />;
}
