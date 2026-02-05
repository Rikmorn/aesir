"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useRouter } from "next/navigation";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  /** IDs of recently-updated conversations for highlight animation */
  highlightedIds?: Set<string>;
}

export function ConversationsTable({
  data,
  total,
  page,
  pageSize,
  agentDefinitions,
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
    <div className="space-y-4">
      <DataTableToolbar agentDefinitions={agentDefinitions} />
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={`cursor-pointer hover:bg-muted/50 ${
                    highlightedIds?.has(row.original.id)
                      ? "bg-accent/30 transition-colors duration-[1500ms]"
                      : ""
                  }`}
                  onClick={() =>
                    router.push(`/conversations/${row.original.id}`)
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No conversations found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination page={page} pageSize={pageSize} total={total} />
    </div>
  );
}
