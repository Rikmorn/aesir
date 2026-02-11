"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { DataTablePagination } from "@/components/conversations/data-table-pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RootTaskListItem, TreeHealth } from "@/services/tasks";
import { type TaskListRow, taskColumns } from "./task-list-columns";

interface TaskListTableProps {
  items: RootTaskListItem[];
  total: number;
  page: number;
  pageSize: number;
  healthMap: Record<string, TreeHealth>;
}

/**
 * Task list table with server-side pagination.
 *
 * Merges health data from healthMap into task rows for column rendering.
 * Reuses DataTablePagination from conversations for consistent pagination UX.
 */
export function TaskListTable({
  items,
  total,
  page,
  pageSize,
  healthMap,
}: TaskListTableProps) {
  const router = useRouter();

  // Merge health data into rows for column access
  const rows: TaskListRow[] = items.map((item) => ({
    ...item,
    health: healthMap[item.id],
  }));

  const table = useReactTable({
    data: rows,
    columns: taskColumns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: Math.ceil(total / pageSize),
  });

  return (
    <div className="space-y-4">
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
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`/tasks/${row.original.id}`)}
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
                  colSpan={taskColumns.length}
                  className="h-24 text-center"
                >
                  No tasks found.
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
