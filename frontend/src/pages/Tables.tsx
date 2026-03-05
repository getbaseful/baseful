import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import {
  TableIcon,
  CaretDown,
  CaretUp,
  CaretUpDown,
  ArrowClockwise,
  X,
} from "@phosphor-icons/react";
import { useDatabase } from "@/context/DatabaseContext";
import { DitherAvatar } from "@/components/ui/hash-avatar";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

interface TableInfo {
  name: string;
  row_count: string;
}

interface ColumnInfo {
  name: string;
  type: string;
  nullable: string;
}

interface TableData {
  name: string;
  columns: ColumnInfo[];
  relations?: RelationInfo[];
  rows: Record<string, unknown>[];
  count: number;
  totalCount?: number | string;
}

interface RelationInfo {
  sourceColumn: string;
  referencedTable: string;
  referencedColumn: string;
}

interface RelationSubview {
  relation: RelationInfo;
  sourceValue: string;
  loading: boolean;
  error: string | null;
  tableData: TableData | null;
}

export default function Tables() {
  const { id } = useParams<{ id: string }>();
  const { selectedDatabase } = useDatabase();
  const { token, logout } = useAuth();
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTableName, setSelectedTableName] = useState<string | null>(
    null,
  );
  const [selectedTable, setSelectedTable] = useState<TableData | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [editedCells, setEditedCells] = useState<Record<string, unknown>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(100);
  const [totalRows, setTotalRows] = useState(0);
  const [relationSubview, setRelationSubview] =
    useState<RelationSubview | null>(null);

  // Search filter state
  const [filterCol, setFilterCol] = useState<string>("");
  const [filterOp, setFilterOp] = useState<string>("equals");
  const [filterVal, setFilterVal] = useState<string>("");

  // Sort state
  const [sortBy, setSortBy] = useState<string>("id");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const hasChanges = Object.keys(editedCells).length > 0;

  const handleCellChange = (
    rowIndex: number,
    columnName: string,
    value: unknown,
  ) => {
    const cellKey = `${rowIndex}|||${columnName}`;
    setEditedCells((prev) => ({ ...prev, [cellKey]: value }));
  };

  const handleSave = async () => {
    if (!selectedTable || !id) return;
    setIsSaving(true);
    try {
      const primaryKey = selectedTable.columns[0]?.name;
      console.log("Primary key:", primaryKey);
      console.log("Edited cells:", editedCells);

      const updates = Object.entries(editedCells).map(([key, value]) => {
        const [rowIndexStr, columnName] = key.split("|||");
        const rowIndex = parseInt(rowIndexStr, 10);
        const row = selectedTable.rows[rowIndex];
        const rowId = primaryKey ? row[primaryKey] : null;
        console.log(
          `Update: row=${rowIndex}, column=${columnName}, value=${value}, rowId=${rowId}`,
        );
        return { rowId, columnName, value };
      });

      console.log("Sending updates:", { primaryKey, updates });

      const res = await authFetch(
        `/api/databases/${id}/tables/${selectedTable.name}/rows`,
        token,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ primaryKey, updates }),
        },
        logout,
      );

      if (!res.ok) throw new Error("Failed to save changes");

      setEditedCells({});
      if (selectedTable?.name) fetchTableData(selectedTable.name);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscard = () => {
    setEditedCells({});
  };

  useEffect(() => {
    if (id && selectedDatabase?.status === "active") {
      fetchTables();
    } else {
      setTables([]);
      setSelectedTableName(null);
      setSelectedTable(null);
      setEditedCells({});
      setTotalRows(0);
      setRelationSubview(null);
      setLoading(false);
    }
  }, [id, selectedDatabase]);

  const fetchTables = async () => {
    setLoading(true);
    setError(null);
    setSelectedTableName(null);
    setSelectedTable(null);
    setEditedCells({});
    setRelationSubview(null);
    try {
      const res = await authFetch(
        `/api/databases/${id}/tables`,
        token,
        {},
        logout,
      );
      if (!res.ok) throw new Error("Failed to fetch tables");
      const data = await res.json();
      setTables(data || []);
      // Auto-select the first table if available
      if (data && data.length > 0) {
        fetchTableData(data[0].name);
      } else {
        setSelectedTableName(null);
        setSelectedTable(null);
        setEditedCells({});
        setTotalRows(0);
        setCurrentPage(1);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch tables");
    } finally {
      setLoading(false);
    }
  };

  const fetchTableData = async (
    tableName: string,
    page: number = 1,
    limit: number = 100,
    fCol?: string,
    fOp?: string,
    fVal?: string,
    sBy?: string,
    sDir?: string,
  ) => {
    const isSwitchingTable = tableName !== selectedTableName;
    const nextFilterCol = fCol !== undefined ? fCol : "";
    const nextFilterOp = fOp !== undefined ? fOp : "equals";
    const nextFilterVal = fVal !== undefined ? fVal : "";
    const nextSortBy = sBy !== undefined ? sBy : "id";
    const nextSortOrder =
      (sDir !== undefined ? sDir : "asc") === "desc" ? "desc" : "asc";

    // Reset filters and sort if we are switching to a different table
    if (isSwitchingTable) {
      setFilterCol(nextFilterCol);
      setFilterOp(nextFilterOp);
      setFilterVal(nextFilterVal);
      setSortBy(nextSortBy);
      setSortOrder(nextSortOrder);
      setRelationSubview(null);
    } else {
      if (fCol !== undefined) setFilterCol(fCol);
      if (fOp !== undefined) setFilterOp(fOp);
      if (fVal !== undefined) setFilterVal(fVal);
      if (sBy !== undefined) setSortBy(sBy);
      if (sDir !== undefined) setSortOrder(sDir === "desc" ? "desc" : "asc");
    }

    setSelectedTableName(tableName);
    setTableLoading(true);
    // Only reset if we're switching tables
    if (isSwitchingTable) {
      setSelectedTable(null);
    }
    try {
      const offset = (page - 1) * limit;
      let url = `/api/databases/${id}/tables/${tableName}?offset=${offset}&limit=${limit}`;

      // Use computed "next" values on table switch to avoid stale state
      const col = isSwitchingTable
        ? nextFilterCol
        : fCol !== undefined
          ? fCol
          : filterCol;
      const op = isSwitchingTable
        ? nextFilterOp
        : fOp !== undefined
          ? fOp
          : filterOp;
      const val = isSwitchingTable
        ? nextFilterVal
        : fVal !== undefined
          ? fVal
          : filterVal;
      const sortByVal = isSwitchingTable
        ? nextSortBy
        : sBy !== undefined
          ? sBy
          : sortBy;
      const sortDirVal = isSwitchingTable
        ? nextSortOrder
        : sDir !== undefined
          ? sDir
          : sortOrder;

      if (col && op && val) {
        url += `&filterCol=${encodeURIComponent(col)}&filterOp=${encodeURIComponent(op)}&filterVal=${encodeURIComponent(val)}`;
      }

      url += `&sortBy=${encodeURIComponent(sortByVal)}&sortOrder=${encodeURIComponent(sortDirVal)}`;

      const res = await authFetch(url, token, {}, logout);
      if (!res.ok) throw new Error("Failed to fetch table data");
      const data = await res.json();
      setSelectedTable(data || null);
      setTotalRows(data.totalCount || 0);
      setCurrentPage(page);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch table data",
      );
    } finally {
      setTableLoading(false);
    }
  };

  const openRelationSubview = async (
    relation: RelationInfo,
    sourceValue: unknown,
  ) => {
    if (!id || sourceValue === null || sourceValue === undefined) return;

    const sourceValueText = String(sourceValue).trim();
    if (!sourceValueText) return;

    setRelationSubview({
      relation,
      sourceValue: sourceValueText,
      loading: true,
      error: null,
      tableData: null,
    });

    try {
      const url =
        `/api/databases/${id}/tables/${relation.referencedTable}` +
        `?offset=0&limit=1` +
        `&filterCol=${encodeURIComponent(relation.referencedColumn)}` +
        `&filterOp=equals` +
        `&filterVal=${encodeURIComponent(sourceValueText)}` +
        `&sortBy=${encodeURIComponent(relation.referencedColumn)}` +
        `&sortOrder=asc`;

      const res = await authFetch(url, token, {}, logout);
      if (!res.ok) throw new Error("Failed to fetch related row");
      const data = await res.json();

      setRelationSubview((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
              tableData: data || null,
            }
          : prev,
      );
    } catch (err: unknown) {
      setRelationSubview((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
              error:
                err instanceof Error ? err.message : "Failed to load relation",
            }
          : prev,
      );
    }
  };

  const handleSort = (columnName: string) => {
    let newOrder: "asc" | "desc" = "asc";
    if (sortBy === columnName) {
      newOrder = sortOrder === "asc" ? "desc" : "asc";
    }
    setSortBy(columnName);
    setSortOrder(newOrder);

    if (selectedTableName) {
      fetchTableData(
        selectedTableName,
        currentPage,
        rowsPerPage,
        filterCol,
        filterOp,
        filterVal,
        columnName,
        newOrder,
      );
    }
  };

  const handleRefresh = () => {
    if (!selectedTableName) return;

    fetchTableData(
      selectedTableName,
      currentPage,
      rowsPerPage,
      filterCol,
      filterOp,
      filterVal,
      sortBy,
      sortOrder,
    );
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-red-400">{error}</div>
        <Link to="/" className="text-blue-400 hover:text-blue-300">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-row border-b border-border p-4 items-center gap-3 w-full">
        <div className="flex flex-row items-center gap-3 flex-1">
          <DitherAvatar
            value={selectedDatabase?.name || "database"}
            size={32}
          />

          <div className="flex flex-row items-center gap-2">
            <h1 className="text-xl md:text-2xl font-medium text-neutral-100">
              Tables
            </h1>
          </div>
        </div>
      </div>

      {/* Main content */}
      {!selectedDatabase ? (
        <div className="flex-1 flex items-center justify-center bg-card border border-border rounded-lg">
          <p className="text-neutral-400">
            Select a database from the sidebar to view tables
          </p>
        </div>
      ) : selectedDatabase.status !== "active" ? (
        <div className="flex-1 flex items-center justify-center bg-card border border-border rounded-lg">
          <p className="text-amber-400">
            Database is not running. Start it to view tables.
          </p>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center bg-card border border-border rounded-lg">
          <p className="text-red-400">{error}</p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col md:flex-row min-h-0">
          {/* Tables sidebar */}
          <div className="hidden md:flex w-64 shrink-0 p-4 overflow-hidden flex-col">
            <div className="overflow-y-auto flex-1 flex flex-col gap-1">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex flex-row items-center gap-2 px-3 py-1.5"
                  >
                    <Skeleton className="h-4 w-4 shrink-0 rounded-sm" />
                    <Skeleton
                      className="h-4 rounded"
                      style={{ width: `${55 + ((i * 37) % 35)}%` }}
                    />
                  </div>
                ))
              ) : tables.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-neutral-400">No tables found</p>
                </div>
              ) : (
                tables?.map((table, i) => (
                  <button
                    key={i}
                    onClick={() => table.name && fetchTableData(table.name)}
                    className={`w-full rounded-md flex flex-row items-center justify-between text-left px-3 py-1.5  hover:bg-neutral-800/50 transition-colors ${
                      selectedTableName === table.name ? "bg-muted/75" : ""
                    }`}
                  >
                    <div className="flex flex-row items-center gap-2">
                      <TableIcon
                        size={16}
                        className={
                          selectedTableName === table.name
                            ? "text-neutral-100"
                            : "text-neutral-500"
                        }
                      />
                      <span
                        className={`text-base ${
                          selectedTableName === table.name
                            ? "text-neutral-100"
                            : "text-neutral-200"
                        }`}
                      >
                        {table.name}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Table content */}
          <div className="flex-1 flex flex-col min-h-0 md:border-l border-border overflow-hidden relative">
            {(loading || tableLoading) && !selectedTable ? (
              <TableSkeleton name={selectedTableName} />
            ) : !selectedTable ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <p className="text-neutral-400">
                    Select a table to view its contents
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Table header */}
                <div className="border-b border-border relative">
                  {tableLoading && (
                    <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-600/30 overflow-hidden z-10">
                      <div
                        className="h-full bg-blue-500 animate-[loading_1s_infinite_ease-in-out]"
                        style={{ width: "40%" }}
                      ></div>
                    </div>
                  )}
                  <div className="flex flex-row items-center justify-between gap-3 p-4">
                    <div>
                      <h2 className="hidden md:block text-2xl font-medium text-neutral-100">
                        {selectedTable.name}
                      </h2>
                      <div className="md:hidden">
                        <Select
                          value={selectedTableName ?? undefined}
                          onValueChange={(value) => fetchTableData(value)}
                          disabled={tables.length === 0}
                        >
                          <SelectTrigger
                            size="sm"
                            className="h-auto w-auto !border-0 !bg-transparent dark:!bg-transparent hover:!bg-transparent dark:hover:!bg-transparent active:!bg-transparent data-[state=open]:!bg-transparent !p-0 text-2xl font-medium text-neutral-100 !shadow-none !ring-0 !ring-offset-0 !outline-none focus:!ring-0 focus-visible:!ring-0 focus-visible:!border-0 focus-visible:!outline-none gap-1.5 [&>svg]:opacity-100 [&>svg]:text-neutral-400"
                          >
                            <SelectValue placeholder={selectedTable.name} />
                          </SelectTrigger>
                          <SelectContent>
                            {tables.length === 0 ? (
                              <SelectItem value="none" disabled>
                                No tables
                              </SelectItem>
                            ) : (
                              tables.map((table) => (
                                <SelectItem key={table.name} value={table.name}>
                                  {table.name}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <p className="text-sm text-neutral-400">
                        {selectedTable.count} rows,{" "}
                        {selectedTable.columns.length} columns
                        {selectedTable.relations?.length
                          ? `, ${selectedTable.relations.length} relations`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-row items-center gap-2">
                      <Button
                        onClick={handleRefresh}
                        disabled={tableLoading}
                        size={"sm"}
                        variant={"secondary"}
                      >
                        <ArrowClockwise
                          size={14}
                          className={tableLoading ? "animate-spin" : ""}
                        />
                        Refresh
                      </Button>
                      {hasChanges && (
                        <>
                          <Button
                            onClick={handleDiscard}
                            disabled={isSaving}
                            size={"sm"}
                            variant={"secondary"}
                          >
                            Discard
                          </Button>
                          <Button
                            onClick={handleSave}
                            disabled={isSaving}
                            size={"sm"}
                            variant={"default"}
                          >
                            {isSaving ? "Saving..." : "Save Changes"}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Filter UI */}
                  <div className="flex flex-row items-center border-t">
                    <div className="flex flex-col items-start gap-1.5 h-full">
                      <Select value={filterCol} onValueChange={setFilterCol}>
                        <SelectTrigger
                          size="sm"
                          className="w-[180px] h-8 bg-transparent! rounded-none! border-border border-y-0! border-r! border-l-0!"
                        >
                          <SelectValue placeholder="Column" />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedTable.columns.map((col) => (
                            <SelectItem key={col.name} value={col.name}>
                              {col.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col items-start gap-1.5">
                      <Select value={filterOp} onValueChange={setFilterOp}>
                        <SelectTrigger
                          size="sm"
                          className="w-[180px] h-8 bg-transparent! rounded-none! border-border border-y-0! border-r! border-l-0!"
                        >
                          <SelectValue placeholder="Operator" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="equals">Equals</SelectItem>
                          <SelectItem value="contains">Contains</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1 flex flex-row items-center border-none h-8 min-w-0">
                      <div className="flex-1 flex flex-row items-center px-1">
                        {(() => {
                          const col = selectedTable.columns.find(
                            (c) => c.name === filterCol,
                          );
                          const columnType = col?.type?.toLowerCase() || "";

                          const isBool =
                            columnType.includes("bool") ||
                            columnType.includes("boolean");

                          const isNumeric = [
                            "integer",
                            "int",
                            "int4",
                            "bigint",
                            "int8",
                            "smallint",
                            "int2",
                            "numeric",
                            "decimal",
                            "real",
                            "double precision",
                          ].some((t) => columnType.includes(t));

                          const isDate =
                            columnType.includes("date") ||
                            columnType.includes("timestamp");

                          if (isBool) {
                            return (
                              <Select
                                value={filterVal}
                                onValueChange={(val) => {
                                  setFilterVal(val);
                                  fetchTableData(
                                    selectedTable.name,
                                    1,
                                    rowsPerPage,
                                    filterCol,
                                    filterOp,
                                    val,
                                  );
                                }}
                              >
                                <SelectTrigger
                                  size="sm"
                                  className="h-8 bg-transparent! rounded-none! border-none! flex-1 text-left"
                                >
                                  <SelectValue placeholder="Select TRUE/FALSE" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="true">TRUE</SelectItem>
                                  <SelectItem value="false">FALSE</SelectItem>
                                </SelectContent>
                              </Select>
                            );
                          }

                          return (
                            <Input
                              type={
                                isNumeric
                                  ? "number"
                                  : isDate
                                    ? columnType.includes("timestamp")
                                      ? "datetime-local"
                                      : "date"
                                    : "text"
                              }
                              value={filterVal}
                              onChange={(e) => setFilterVal(e.target.value)}
                              placeholder="Value..."
                              className="h-8 bg-transparent! focus:ring-0! focus:border-border! focus:outline-none! rounded-none! border-none! text-xs flex-1"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  fetchTableData(
                                    selectedTable.name,
                                    1,
                                    rowsPerPage,
                                  );
                                }
                              }}
                            />
                          );
                        })()}
                      </div>
                      <div className="flex flex-row shrink-0 border-l border-border h-8">
                        <button
                          onClick={() =>
                            fetchTableData(selectedTable.name, 1, rowsPerPage)
                          }
                          className="h-full px-4 text-xs font-medium text-background bg-primary hover:bg-primary transition-colors shrink-0"
                        >
                          Search
                        </button>
                        {(filterCol || filterVal) && (
                          <button
                            onClick={() => {
                              setFilterCol("");
                              setFilterVal("");
                              fetchTableData(
                                selectedTable.name,
                                1,
                                rowsPerPage,
                                "",
                                "equals",
                                "",
                              );
                            }}
                            className="h-full px-4 bg-neutral-800! text-xs font-medium text-neutral-400 hover:text-neutral-200 transition-colors border-l border-border/50"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex-1 flex min-h-0 overflow-hidden">
                  <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                    {!selectedTable.rows || selectedTable.rows.length === 0 ? (
                      <div className="flex-1 flex items-center justify-center">
                        <div className="text-neutral-500">No data in table</div>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 overflow-auto">
                          <table className="w-full text-sm border-separate border-spacing-0">
                            <thead className="bg-transparent!">
                              <tr className="bg-transparent! sticky top-0 z-20">
                                {selectedTable.columns?.map((col, i) => (
                                  <th
                                    key={i}
                                    className="text-left bg-[#141414]! py-0 px-0 text-neutral-400 font-medium border-b border-r border-border last:border-r-0"
                                  >
                                    <button
                                      onClick={() => handleSort(col.name)}
                                      className="w-full h-full flex flex-row items-center justify-between gap-2 px-2 py-2 hover:bg-neutral-800 transition-colors group"
                                    >
                                      <span className="truncate">
                                        {col.name}
                                      </span>
                                      <div className="shrink-0 flex items-center">
                                        {sortBy === col.name ? (
                                          sortOrder === "asc" ? (
                                            <CaretUp
                                              size={12}
                                              weight="bold"
                                              className="text-foreground"
                                            />
                                          ) : (
                                            <CaretDown
                                              size={12}
                                              weight="bold"
                                              className="text-foreground"
                                            />
                                          )
                                        ) : (
                                          <CaretUpDown
                                            size={12}
                                            className="text-neutral-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                          />
                                        )}
                                      </div>
                                    </button>
                                  </th>
                                ))}
                                {selectedTable.relations?.map((relation, i) => (
                                  <th
                                    key={`relation-${i}`}
                                    className="text-left bg-[#141414]! py-0 px-0 text-neutral-400 font-medium border-b border-r border-border last:border-r-0 min-w-[170px]"
                                  >
                                    <div className="w-full h-full flex flex-row items-center justify-between gap-2 px-2 py-2">
                                      <span className="truncate">
                                        {relation.sourceColumn} →{" "}
                                        {relation.referencedTable}
                                      </span>
                                    </div>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {selectedTable.rows?.map((row, i) => (
                                <tr key={i} className="hover:bg-neutral-800/50">
                                  {selectedTable.columns?.map((col, j) => {
                                    const cellKey = `${i}|||${col.name}`;
                                    const value =
                                      editedCells[cellKey] ?? row[col.name];
                                    const isEdited = cellKey in editedCells;
                                    const columnType = col.type.toLowerCase();
                                    const isNullable = col.nullable === "YES";

                                    const renderInput = () => {
                                      const isBool =
                                        columnType === "boolean" ||
                                        columnType === "bool";

                                      if (isBool) {
                                        return (
                                          <Select
                                            value={
                                              value === null
                                                ? "NULL"
                                                : value === true ||
                                                    value === "true" ||
                                                    value === "t" ||
                                                    value === 1 ||
                                                    value === "1"
                                                  ? "true"
                                                  : "false"
                                            }
                                            onValueChange={(val) =>
                                              handleCellChange(
                                                i,
                                                col.name,
                                                val === "NULL"
                                                  ? null
                                                  : val === "true",
                                              )
                                            }
                                          >
                                            <SelectTrigger
                                              size="sm"
                                              className="h-fit! py-1! w-full! border-none bg-transparent! px-2 font-mono text-[10px] font-bold uppercase tracking-wider focus:ring-0 focus:ring-offset-0 shadow-none hover:bg-transparent! justify-start"
                                            >
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              <SelectItem value="true">
                                                TRUE
                                              </SelectItem>
                                              <SelectItem value="false">
                                                FALSE
                                              </SelectItem>
                                              {isNullable && (
                                                <SelectItem value="NULL">
                                                  NULL
                                                </SelectItem>
                                              )}
                                            </SelectContent>
                                          </Select>
                                        );
                                      }

                                      const isNumeric = [
                                        "integer",
                                        "int",
                                        "int4",
                                        "bigint",
                                        "int8",
                                        "smallint",
                                        "int2",
                                        "numeric",
                                        "decimal",
                                        "real",
                                        "double precision",
                                      ].some((t) => columnType.includes(t));

                                      const isDate =
                                        columnType.includes("date") ||
                                        columnType.includes("timestamp");

                                      return (
                                        <Popover>
                                          <PopoverTrigger asChild>
                                            <button
                                              className={`h-7 w-full border-none bg-transparent px-1 font-mono text-xs text-left truncate focus:outline-none hover:bg-neutral-800/30 rounded transition-colors ${
                                                isEdited
                                                  ? "text-blue-300"
                                                  : "text-neutral-200"
                                              }`}
                                            >
                                              {value === null ? (
                                                <span className="text-neutral-600 italic">
                                                  NULL
                                                </span>
                                              ) : (
                                                String(value)
                                              )}
                                            </button>
                                          </PopoverTrigger>
                                          <PopoverContent className="w-80 p-3 bg-neutral-900 border-neutral-700">
                                            <div className="flex flex-col gap-2">
                                              <div className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
                                                Edit {col.name} ({columnType})
                                              </div>
                                              {!isBool &&
                                              !isNumeric &&
                                              !isDate ? (
                                                <Textarea
                                                  value={
                                                    value === null
                                                      ? ""
                                                      : String(value)
                                                  }
                                                  onChange={(e) =>
                                                    handleCellChange(
                                                      i,
                                                      col.name,
                                                      e.target.value === "" &&
                                                        isNullable
                                                        ? null
                                                        : e.target.value,
                                                    )
                                                  }
                                                  className="font-mono text-xs bg-neutral-950 border-neutral-800 min-h-[100px]"
                                                  placeholder={
                                                    isNullable ? "NULL" : ""
                                                  }
                                                />
                                              ) : (
                                                <Input
                                                  type={
                                                    isNumeric
                                                      ? "number"
                                                      : isDate
                                                        ? columnType.includes(
                                                            "time",
                                                          )
                                                          ? "datetime-local"
                                                          : "date"
                                                        : "text"
                                                  }
                                                  value={
                                                    value === null
                                                      ? ""
                                                      : String(value)
                                                  }
                                                  onChange={(e) =>
                                                    handleCellChange(
                                                      i,
                                                      col.name,
                                                      e.target.value === "" &&
                                                        isNullable
                                                        ? null
                                                        : e.target.value,
                                                    )
                                                  }
                                                  className="font-mono text-xs bg-neutral-950 border-neutral-800"
                                                  autoFocus
                                                  placeholder={
                                                    isNullable ? "NULL" : ""
                                                  }
                                                />
                                              )}
                                              {isNullable && value !== null && (
                                                <button
                                                  onClick={() =>
                                                    handleCellChange(
                                                      i,
                                                      col.name,
                                                      null,
                                                    )
                                                  }
                                                  className="text-[10px] text-neutral-500 hover:text-red-400 text-left transition-colors"
                                                >
                                                  Set to NULL
                                                </button>
                                              )}
                                            </div>
                                          </PopoverContent>
                                        </Popover>
                                      );
                                    };

                                    return (
                                      <td
                                        key={j}
                                        className="py-0.5 px-0 font-mono text-xs border-b border-r border-border last:border-r-0 min-w-[60px] max-w-[200px] truncate"
                                      >
                                        {renderInput()}
                                      </td>
                                    );
                                  })}
                                  {selectedTable.relations?.map(
                                    (relation, relationIndex) => {
                                      const sourceValue =
                                        row[relation.sourceColumn];
                                      const hasLink =
                                        sourceValue !== null &&
                                        sourceValue !== undefined &&
                                        String(sourceValue).trim() !== "";

                                      const isCurrentRelation =
                                        relationSubview &&
                                        relationSubview.relation
                                          .sourceColumn ===
                                          relation.sourceColumn &&
                                        relationSubview.relation
                                          .referencedTable ===
                                          relation.referencedTable &&
                                        relationSubview.sourceValue ===
                                          String(sourceValue);

                                      return (
                                        <td
                                          key={`relation-cell-${relationIndex}`}
                                          className="py-0.5 px-0 font-mono text-xs border-b border-r border-border last:border-r-0 min-w-[170px] max-w-[250px]"
                                        >
                                          {hasLink ? (
                                            <button
                                              onClick={() =>
                                                openRelationSubview(
                                                  relation,
                                                  sourceValue,
                                                )
                                              }
                                              className={`w-fit ml-2 text-left truncate transition-colors `}
                                              title={`Open related ${relation.referencedTable} row`}
                                            >
                                              <div
                                                className={`rounded px-1 py-0.5 ${
                                                  isCurrentRelation
                                                    ? "bg-blue-500/75 text-blue-200"
                                                    : "bg-blue-500/20 text-blue-300 hover:bg-blue-800/40"
                                                }`}
                                              >
                                                {relation.referencedTable}
                                              </div>
                                            </button>
                                          ) : (
                                            <span className="px-2 text-neutral-600 italic">
                                              No link
                                            </span>
                                          )}
                                        </td>
                                      );
                                    },
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="p-3 border-t border-border flex items-center justify-between bg-[#141414] shrink-0">
                          <div className="flex items-center gap-4">
                            <span className="text-xs text-neutral-500">
                              Showing{" "}
                              {Math.min(
                                (currentPage - 1) * rowsPerPage + 1,
                                totalRows,
                              )}{" "}
                              to{" "}
                              {Math.min(currentPage * rowsPerPage, totalRows)}{" "}
                              of {totalRows} rows
                            </span>
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-neutral-500">
                                Rows per page:
                              </label>
                              <select
                                value={rowsPerPage}
                                onChange={(e) => {
                                  const newLimit = parseInt(e.target.value, 10);
                                  setRowsPerPage(newLimit);
                                  setCurrentPage(1);
                                  fetchTableData(
                                    selectedTable?.name,
                                    1,
                                    newLimit,
                                  );
                                }}
                                className="text-xs bg-neutral-700 text-neutral-200 border border-border rounded px-2 py-1 outline-none focus:border-blue-500"
                              >
                                <option value={25}>25</option>
                                <option value={50}>50</option>
                                <option value={100}>100</option>
                                <option value={250}>250</option>
                                <option value={500}>500</option>
                              </select>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                if (currentPage > 1) {
                                  fetchTableData(
                                    selectedTable.name,
                                    currentPage - 1,
                                    rowsPerPage,
                                  );
                                }
                              }}
                              disabled={currentPage === 1}
                              className="p-1.5 rounded hover:bg-neutral-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              title="Previous page"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="text-neutral-400"
                              >
                                <polyline points="15 18 9 12 15 6"></polyline>
                              </svg>
                            </button>
                            <span className="text-xs text-neutral-400 min-w-[60px] text-center">
                              Page {currentPage} of{" "}
                              {Math.ceil(totalRows / rowsPerPage) || 1}
                            </span>
                            <button
                              onClick={() => {
                                if (
                                  currentPage <
                                  Math.ceil(totalRows / rowsPerPage)
                                ) {
                                  fetchTableData(
                                    selectedTable.name,
                                    currentPage + 1,
                                    rowsPerPage,
                                  );
                                }
                              }}
                              disabled={
                                currentPage >=
                                Math.ceil(totalRows / rowsPerPage)
                              }
                              className="p-1.5 rounded hover:bg-neutral-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                              title="Next page"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="text-neutral-400"
                              >
                                <polyline points="9 18 15 12 9 6"></polyline>
                              </svg>
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  {relationSubview && (
                    <div className="w-105 border-l border-border bg-card shrink-0 flex flex-col min-h-0">
                      <div className="p-3 h-17.5 border-b border-border flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-base font-medium text-neutral-100 truncate">
                            {relationSubview.relation.referencedTable} subview
                          </p>
                          <p className="text-xs text-neutral-500 truncate">
                            {relationSubview.relation.sourceColumn} ={" "}
                            {relationSubview.sourceValue}
                          </p>
                        </div>
                        <button
                          onClick={() => setRelationSubview(null)}
                          className="p-1 rounded hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200"
                          title="Close subview"
                        >
                          <X size={14} />
                        </button>
                      </div>

                      <div className="flex-1 overflow-auto ">
                        {relationSubview.loading ? (
                          <p className="text-xs text-neutral-500">
                            Loading related row...
                          </p>
                        ) : relationSubview.error ? (
                          <p className="text-xs text-red-400">
                            {relationSubview.error}
                          </p>
                        ) : !relationSubview.tableData?.rows?.length ? (
                          <p className="text-xs text-neutral-500">
                            No related row found.
                          </p>
                        ) : (
                          <table className="w-full text-xs border-separate border-spacing-0">
                            <thead>
                              <tr>
                                {relationSubview.tableData.columns.map(
                                  (col, i) => (
                                    <th
                                      key={i}
                                      className="text-left py-1 px-2 text-neutral-400 border-b border-r border-border last:border-r-0 bg-card"
                                    >
                                      {col.name}
                                    </th>
                                  ),
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                {relationSubview.tableData.columns.map(
                                  (col, i) => (
                                    <td
                                      key={i}
                                      className="py-1 px-2 text-neutral-200 border-b border-r border-border last:border-r-0 font-mono"
                                    >
                                      {relationSubview.tableData?.rows?.[0]?.[
                                        col.name
                                      ] === null ||
                                      relationSubview.tableData?.rows?.[0]?.[
                                        col.name
                                      ] === undefined ? (
                                        <span className="text-neutral-600 italic">
                                          NULL
                                        </span>
                                      ) : (
                                        String(
                                          relationSubview.tableData.rows[0][
                                            col.name
                                          ],
                                        )
                                      )}
                                    </td>
                                  ),
                                )}
                              </tr>
                            </tbody>
                          </table>
                        )}
                      </div>

                      <div className="p-3 border-t border-border">
                        <button
                          onClick={() => {
                            const relation = relationSubview.relation;
                            fetchTableData(
                              relation.referencedTable,
                              1,
                              rowsPerPage,
                              relation.referencedColumn,
                              "equals",
                              relationSubview.sourceValue,
                              relation.referencedColumn,
                              "asc",
                            );
                            setRelationSubview(null);
                          }}
                          className="w-full text-xs px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors"
                        >
                          Open in Table
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const TableSkeleton = ({ name }: { name: string | null }) => (
  <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
    {/* Table Tool Bar Skeleton */}
    <div className="border-b border-border">
      <div className="flex flex-row items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-2xl font-medium text-neutral-100">{name}</h2>
          <Skeleton className="h-4 w-32 mt-1" />
        </div>
      </div>
      {/* Filter UI Skeleton */}
      <div className="flex flex-row items-center border-t border-border h-8 bg-transparent">
        <div className="w-[180px] h-full border-r border-border flex items-center px-4">
          <Skeleton className="h-3 w-20 opacity-30" />
        </div>
        <div className="w-[180px] h-full border-r border-border flex items-center px-4">
          <Skeleton className="h-3 w-20 opacity-30" />
        </div>
        <div className="flex-1 h-full flex items-center px-4">
          <Skeleton className="h-3 w-32 opacity-30" />
        </div>
      </div>
    </div>

    {/* Table Data Skeleton */}
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead className="bg-[#141414]!">
            <tr className="sticky top-0 z-20">
              {Array.from({ length: 6 }).map((_, i) => (
                <th
                  key={i}
                  className="text-left bg-[#141414]! py-[8px] px-2 border-b border-r border-border last:border-r-0"
                >
                  <Skeleton className="h-5 w-20" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 20 }).map((_, i) => (
              <tr key={i} className="">
                {Array.from({ length: 6 }).map((_, j) => (
                  <td
                    key={j}
                    className="py-[8px] px-2 border-b border-r border-border last:border-r-0"
                  >
                    <Skeleton className="h-5 w-full opacity-30" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Pagination Skeleton */}
      <div className="p-3 border-t border-border flex items-center justify-between bg-[#141414] shrink-0">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-6 w-32" />
      </div>
    </div>
  </div>
);
