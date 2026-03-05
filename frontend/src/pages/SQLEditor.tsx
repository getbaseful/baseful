import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  PlayIcon,
  TableIcon,
  TrashIcon,
  ClockCounterClockwise,
  CheckIcon,
  CopyIcon,
} from "@phosphor-icons/react";
import { useDatabase } from "@/context/DatabaseContext";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import Editor from "react-simple-code-editor";
import { highlight, languages } from "prismjs";
import "prismjs/components/prism-sql";
import "prismjs/themes/prism-tomorrow.css";
import { DitherAvatar } from "@/components/ui/hash-avatar";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/lib/api";

interface QueryResult {
  result: string;
  is_select: boolean;
}

interface QueryHistory {
  id: number;
  query: string;
  timestamp: Date;
  success: boolean;
}

interface AssistantMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
}

export default function SQLEditor() {
  const { id } = useParams<{ id: string }>();
  const { selectedDatabase } = useDatabase();
  const { token, logout } = useAuth();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<QueryHistory[]>([]);
  const [copied, setCopied] = useState(false);
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>(
    [],
  );

  const runQuery = async () => {
    if (!query.trim()) return;
    if (!selectedDatabase || selectedDatabase.status !== "active") {
      setError("Database is not running");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await authFetch(`/api/databases/${id}/query`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      }, logout);

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Query failed");
      }

      setResult(data);

      setHistory((prev) => [
        {
          id: Date.now(),
          query,
          timestamp: new Date(),
          success: true,
        },
        ...prev.slice(0, 49),
      ]);
    } catch (err: any) {
      setError(err.message);
      setHistory((prev) => [
        {
          id: Date.now(),
          query,
          timestamp: new Date(),
          success: false,
        },
        ...prev.slice(0, 49),
      ]);
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = () => setHistory([]);

  const generateSQLWithAssistant = async () => {
    if (!assistantPrompt.trim()) return;
    if (!selectedDatabase || selectedDatabase.status !== "active") {
      setAssistantError("Database is not running");
      return;
    }

    setAssistantLoading(true);
    setAssistantError(null);
    try {
      const prompt = assistantPrompt.trim();
      const res = await authFetch(
        `/api/databases/${id}/sql-assistant`,
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, currentQuery: query }),
        },
        logout,
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Assistant failed");
      }

      const sql = String(data.sql || "").trim();
      if (!sql) {
        throw new Error("Assistant returned empty SQL");
      }

      setAssistantMessages((prev) => [
        ...prev,
        { id: Date.now(), role: "user", content: prompt },
        { id: Date.now() + 1, role: "assistant", content: sql },
      ]);
      setQuery(sql);
      setAssistantPrompt("");
    } catch (err: any) {
      setAssistantError(err.message || "Failed to generate SQL");
    } finally {
      setAssistantLoading(false);
    }
  };

  const copyResults = () => {
    if (!result?.result) return;
    navigator.clipboard.writeText(result.result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatResult = (
    output: string,
  ): { headers: string[]; rows: string[][] } | null => {
    const lines = output.trim().split("\n");
    if (lines.length < 2) return null;

    if (lines[0].includes("|") || lines[1]?.startsWith("-")) {
      let headers: string[] = [];
      const rows: string[][] = [];

      let headerIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("|") && !lines[i].startsWith("(")) {
          headerIndex = i;
          break;
        }
      }

      if (headerIndex === -1) return null;

      headers = lines[headerIndex]
        .split("|")
        .map((h) => h.trim())
        .filter((h) => h);

      for (let i = headerIndex + 1; i < lines.length; i++) {
        if (
          lines[i].includes("|") &&
          !lines[i].startsWith("(") &&
          !lines[i].startsWith("-")
        ) {
          const cells = lines[i].split("|").map((c) => c.trim());
          if (cells.length === headers.length) {
            rows.push(cells);
          }
        }
      }

      return { headers, rows };
    }

    return null;
  };

  const tableData = result ? formatResult(result.result) : null;

  return (
    <div className="flex flex-col h-full max-w-full overflow-x-hidden">
      {/* Refined Header */}
      <div className="flex flex-row border-b border-border p-4 items-center justify-between sticky top-0 z-10">
        <div className="flex flex-row items-center gap-3 flex-1">
          <DitherAvatar value={selectedDatabase?.name || "database"} size={32} />

          <div className="flex flex-row items-center gap-2">
            <h1 className="text-2xl font-medium text-neutral-100">
              SQL Editor
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs border-border bg-neutral-900/50 hover:bg-neutral-800"
              >
                <ClockCounterClockwise size={14} />
                History
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-80 p-0 overflow-hidden bg-card border-border"
              align="end"
            >
              <div className="p-3 border-b border-border flex items-center justify-between">
                <span className="text-xs font-semibold text-neutral-400">
                  Query History
                </span>
                <button
                  onClick={clearHistory}
                  className="text-[10px] text-neutral-500 hover:text-red-400 transition-colors uppercase font-bold tracking-wider"
                >
                  Clear
                </button>
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                {history.length === 0 ? (
                  <div className="p-8 text-center">
                    <p className="text-xs text-neutral-600 font-medium">
                      No recent queries
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col divide-y divide-border/50">
                    {history.map((h) => (
                      <button
                        key={h.id}
                        onClick={() => setQuery(h.query)}
                        className="p-3 text-left hover:bg-neutral-800/50 transition-colors group"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className={cn(
                              "text-[10px] px-1 rounded-sm border",
                              h.success
                                ? "text-green-400 border-green-500/20 bg-green-500/5"
                                : "text-red-400 border-red-500/20 bg-red-500/5",
                            )}
                          >
                            {h.success ? "SUCCESS" : "FAILED"}
                          </span>
                          <span className="text-[9px] text-neutral-600 font-mono">
                            {h.timestamp.toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-400 font-mono line-clamp-2 leading-relaxed group-hover:text-neutral-200">
                          {h.query}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs border-border bg-neutral-900/50 hover:bg-neutral-800"
              >
                <TableIcon size={14} />
                Templates
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-64 p-2 bg-card border-border"
              align="end"
            >
              <div className="flex flex-col gap-1">
                <button
                  onClick={() =>
                    setQuery(
                      "SELECT * FROM information_schema.tables WHERE table_schema = 'public';",
                    )
                  }
                  className="p-2 text-left text-xs text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded transition-colors"
                >
                  List all tables
                </button>
                <button
                  onClick={() =>
                    setQuery(
                      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users';",
                    )
                  }
                  className="p-2 text-left text-xs text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded transition-colors"
                >
                  List table columns
                </button>
                <button
                  onClick={() =>
                    setQuery(
                      "SELECT pg_size_pretty(pg_database_size(current_database()));",
                    )
                  }
                  className="p-2 text-left text-xs text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded transition-colors"
                >
                  Database size
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 max-w-full overflow-hidden divide-y divide-border">
        {/* Editor Area */}
        <div className="flex-[0.4] flex flex-col min-h-[200px]">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">
              Editor
            </span>
            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className="text-[10px] text-neutral-500 hover:text-neutral-300 font-semibold flex items-center gap-1 transition-colors"
                    disabled={assistantLoading}
                  >
                    ASSISTANT
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-[420px] p-0 bg-card border-border"
                >
                  <div className="px-3 py-2 border-b border-border">
                    <p className="text-xs font-semibold text-neutral-300">
                      SQL Assistant
                    </p>
                    <p className="text-[10px] text-neutral-500">
                      Describe what you need in plain English. Generated SQL is
                      inserted into the editor.
                    </p>
                  </div>

                  <div className="max-h-64 overflow-y-auto p-3 space-y-2">
                    {assistantMessages.length === 0 ? (
                      <p className="text-[11px] text-neutral-500">
                        No messages yet.
                      </p>
                    ) : (
                      assistantMessages.map((message) => (
                        <div
                          key={message.id}
                          className={cn(
                            "rounded border p-2 text-[11px] whitespace-pre-wrap font-mono",
                            message.role === "assistant"
                              ? "border-blue-500/20 bg-blue-500/5 text-blue-200"
                              : "border-border bg-neutral-900/60 text-neutral-300",
                          )}
                        >
                          {message.content}
                        </div>
                      ))
                    )}
                  </div>

                  <div className="p-3 border-t border-border space-y-2">
                    <input
                      type="text"
                      value={assistantPrompt}
                      onChange={(e) => setAssistantPrompt(e.target.value)}
                      placeholder="e.g. Show top 10 users by number of jobs this month"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !assistantLoading) {
                          e.preventDefault();
                          generateSQLWithAssistant();
                        }
                      }}
                      className="w-full h-9 rounded border border-border bg-neutral-900/70 px-2 py-1.5 text-xs text-neutral-200 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                    />
                    {assistantError && (
                      <p className="text-[11px] text-red-400">{assistantError}</p>
                    )}
                    <div className="flex justify-end">
                      <button
                        onClick={generateSQLWithAssistant}
                        disabled={assistantLoading || !assistantPrompt.trim()}
                        className="px-3 py-1.5 rounded text-[10px] font-bold text-neutral-200 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50"
                      >
                        {assistantLoading ? "GENERATING..." : "GENERATE SQL"}
                      </button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <button
                onClick={() => setQuery("")}
                className="text-[10px] text-neutral-500 hover:text-neutral-300 font-semibold flex items-center gap-1 transition-colors"
              >
                <TrashIcon size={12} />
                CLEAR
              </button>
              <div className="w-[1px] h-3 bg-border mx-1" />
              <button
                onClick={runQuery}
                disabled={
                  loading ||
                  !selectedDatabase ||
                  selectedDatabase.status !== "active"
                }
                className="text-[10px] text-neutral-500 hover:text-neutral-400 font-bold flex items-center gap-1 transition-colors disabled:opacity-50"
              >
                <PlayIcon size={12} weight="fill" />
                {loading ? "RUNNING..." : "EXECUTE"}
              </button>
            </div>
          </div>
          <div className="flex-1 relative group overflow-auto">
            <Editor
              value={query}
              onValueChange={setQuery}
              highlight={(code) => highlight(code, languages.sql, "sql")}
              padding={16}
              placeholder="Write your SQL here..."
              className="w-full h-full bg-transparent text-neutral-200 font-mono text-sm outline-none leading-relaxed"
              style={{
                fontFamily: '"Fira Code", "Courier New", monospace',
                minHeight: "100%",
              }}
              textareaClassName="outline-none"
            />
          </div>
        </div>

        {/* Results Area */}
        <div className="flex-[0.6] flex flex-col min-h-0">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">
                Result
              </span>
              {tableData && (
                <span className="text-[10px] text-neutral-600 font-medium">
                  {tableData.rows.length} row
                  {tableData.rows.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            {result && (
              <button
                onClick={copyResults}
                className="text-[10px] text-neutral-500 hover:text-neutral-300 font-semibold flex items-center gap-1 transition-colors"
                title="Copy raw output"
              >
                {copied ? (
                  <CheckIcon size={12} className="text-green-500" />
                ) : (
                  <CopyIcon size={12} />
                )}
                {copied ? "COPIED" : "COPY"}
              </button>
            )}
          </div>

          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 opacity-50">
                <div className="w-5 h-5 border-2 border-neutral-700 border-t-neutral-400 rounded-full animate-spin" />
                <span className="text-xs text-neutral-500 font-medium animate-pulse">
                  Executing query...
                </span>
              </div>
            ) : error ? (
              <div className="p-8">
                <div className="bg-red-500/5 border border-red-500/10 rounded-lg p-6 max-w-2xl mx-auto">
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-red-500/10 rounded border border-red-500/20 text-red-500">
                      <TrashIcon size={20} />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-red-400 mb-1">
                        Query Failed
                      </h3>
                      <p className="text-xs text-red-400/70 font-mono break-all leading-relaxed">
                        {error}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : tableData ? (
              <div className="overflow-x-auto h-full">
                <table className="w-full text-left border-separate border-spacing-0">
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr>
                      {tableData.headers.map((header, i) => (
                        <th
                          key={i}
                          className="px-4 py-2 border-b border-border text-[11px] font-bold text-neutral-500 uppercase tracking-wider whitespace-nowrap bg-neutral-900/80 backdrop-blur-sm"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-neutral-800/30 group">
                        {row.map((cell, j) => (
                          <td
                            key={j}
                            className="px-4 py-2 border-b border-border/30 text-xs font-mono text-neutral-300 whitespace-nowrap transition-colors"
                          >
                            {cell === "" || cell === null ? (
                              <span className="text-neutral-700 italic">
                                NULL
                              </span>
                            ) : (
                              cell
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : result ? (
              <div className="p-4">
                <pre className="text-xs font-mono text-neutral-400 whitespace-pre-wrap leading-relaxed bg-card p-4 rounded border border-border/50">
                  {result.result}
                </pre>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full px-12 text-center gap-4">
                <div className="max-w-[240px]">
                  <p className="text-sm font-semibold text-neutral-400 mb-1">
                    No output yet
                  </p>
                  <p className="text-xs text-neutral-600 leading-relaxed">
                    Write a query in the editor above and press execute to see
                    results.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {!selectedDatabase && (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center">
          <div className="bg-card border border-border rounded-xl p-8 max-w-sm text-center shadow-2xl">
            <div className="w-12 h-12 bg-neutral-900 rounded-lg border border-border mx-auto mb-4 flex items-center justify-center">
              <DitherAvatar value={"database"} size={24} />
            </div>
            <h3 className="text-base font-semibold text-neutral-100 mb-2">
              No database selected
            </h3>
            <p className="text-xs text-neutral-500 leading-relaxed mb-6">
              Please select a database from the sidebar to start writing and
              executing SQL queries.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs font-bold border-border"
              onClick={() => window.history.back()}
            >
              Go Back
            </Button>
          </div>
        </div>
      )}

      {selectedDatabase && selectedDatabase.status !== "active" && (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center">
          <div className="bg-card border border-border rounded-xl p-8 max-w-sm text-center shadow-2xl">
            <div className="w-12 h-12 bg-amber-500/10 rounded-lg border border-amber-500/20 mx-auto mb-4 flex items-center justify-center">
              <PlayIcon size={24} className="text-amber-500" />
            </div>
            <h3 className="text-base font-semibold text-neutral-100 mb-2">
              Database is offline
            </h3>
            <p className="text-xs text-neutral-500 leading-relaxed mb-6">
              The database "{selectedDatabase.name}" is currently{" "}
              {selectedDatabase.status}. Start it to use the SQL editor.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs font-bold border-border"
              onClick={() => window.history.back()}
            >
              Go Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
