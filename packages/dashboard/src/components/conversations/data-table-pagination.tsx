"use client";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { parseAsInteger, useQueryStates } from "nuqs";

import { Button } from "@/components/ui/button";

interface DataTablePaginationProps {
  page: number;
  pageSize: number;
  total: number;
}

export function DataTablePagination({
  pageSize,
  total,
}: DataTablePaginationProps) {
  const pageCount = Math.ceil(total / pageSize);
  const [{ page }, setParams] = useQueryStates(
    { page: parseAsInteger.withDefault(1) },
    { shallow: false },
  );

  const rangeStart = Math.min((page - 1) * pageSize + 1, total);
  const rangeEnd = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between px-2 py-4">
      <p className="text-sm text-muted-foreground">
        {total > 0
          ? `Showing ${rangeStart}-${rangeEnd} of ${total} results`
          : "No results"}
      </p>
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground">
          Page {page} of {Math.max(pageCount, 1)}
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-xs"
            onClick={() => setParams({ page: 1 })}
            disabled={page <= 1}
            aria-label="First page"
          >
            <ChevronsLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-xs"
            onClick={() => setParams({ page: page - 1 })}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-xs"
            onClick={() => setParams({ page: page + 1 })}
            disabled={page >= pageCount}
            aria-label="Next page"
          >
            <ChevronRight />
          </Button>
          <Button
            variant="outline"
            size="icon-xs"
            onClick={() => setParams({ page: pageCount })}
            disabled={page >= pageCount}
            aria-label="Last page"
          >
            <ChevronsRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
