"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import type { ConversationListItem } from "@/services/conversations";
import { columns } from "./columns";
import { DataTablePagination } from "./data-table-pagination";
import { DataTableToolbar } from "./data-table-toolbar";

interface ConversationsTableProps {
  data: ConversationListItem[];
  total: number;
  page: number;
  pageSize: number;
  agentDefinitions: string[];
  statusCounts: Record<string, number>;
  /** IDs of recently-updated conversations for highlight animation */
  highlightedIds?: Set<string>;
}

export function ConversationsTable({
  data,
  total,
  page,
  pageSize,
  agentDefinitions,
  statusCounts,
  highlightedIds,
}: ConversationsTableProps) {
  const router = useRouter();
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: Math.ceil(total / pageSize),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="shrink-0">
        <DataTableToolbar
          agentDefinitions={agentDefinitions}
          statusCounts={statusCounts}
        />
      </div>

      {/* Table card — fills remaining space, scrolls internally */}
      <div className="flex min-h-0 flex-1 flex-col rounded-lg border bg-card">
        <div className="min-h-0 flex-1 overflow-auto overscroll-y-contain">
          <table className="w-full caption-bottom text-sm">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b">
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="sticky top-0 z-10 h-9 bg-card px-3 text-left align-middle text-xs font-medium uppercase tracking-wider text-muted-foreground whitespace-nowrap"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="[&_tr:last-child]:border-0">
              {table.getRowModel().rows.length > 0 ? (
                table.getRowModel().rows.map((row) => {
                  const { status } = row.original;
                  const isFailed = status === "failed";
                  const isRunning = status === "running";
                  const isWaiting = status === "waiting";

                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        "cursor-pointer border-b border-l-2 border-l-transparent transition-colors hover:bg-muted/50",
                        isFailed && "border-l-destructive",
                        isRunning && "border-l-indigo-500",
                        isWaiting && "border-l-amber-500",
                        highlightedIds?.has(row.original.id) &&
                          "bg-accent/30 transition-colors duration-[1500ms]",
                      )}
                      onClick={() =>
                        router.push(`/conversations/${row.original.id}`)
                      }
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          className="px-3 py-2.5 align-middle whitespace-nowrap"
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No conversations found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="shrink-0">
        <DataTablePagination page={page} pageSize={pageSize} total={total} />
      </div>
    </div>
  );
}
