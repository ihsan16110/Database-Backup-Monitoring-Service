import React, { useState, useRef, useEffect } from "react";
import useFetch from "../hooks/useFetch";
import { syncOutlets, syncIBStorageOutlets } from "../services/apiServices";

type BackupMode = "d-drive" | "ibstorage";

interface BackupRecord {
  outletCode: string;
  server: string;
  status: string;
  lastModified: string | null;
  file: string | null;
  backupsize: string | null;
  scanDate?: string | null;
  errorDetails?: string | null;
  driveLetter?: string | null;
}

const getStatusBadge = (record: BackupRecord) => {
  if (record.status === "Successful") {
    return { label: "Successful", className: "bg-green-100 text-green-700", tooltip: "" };
  }

  const details = record.errorDetails || "";

  if (details.includes("Server not Reachable")) {
    return { label: "Unreachable", className: "bg-gray-200 text-gray-700", tooltip: "Server is not reachable or offline" };
  }
  if (details.includes("Folder not found") || details.includes("No such file or directory")) {
    return { label: "No Directory", className: "bg-orange-100 text-orange-700", tooltip: "Backup directory does not exist on this server" };
  }
  if (details.includes("IBSTORAGE drive not found")) {
    return { label: "No Drive", className: "bg-orange-100 text-orange-700", tooltip: "IBSTORAGE drive not found on this server (checked e$-i$)" };
  }
  if (details.includes("No Valid Backup Files")) {
    return { label: "No Backup", className: "bg-yellow-100 text-yellow-700", tooltip: "Backup directory exists but no valid backup files found" };
  }
  if (details.includes("SMB Protocol Error") || details.includes("SMBConnectionClosed")) {
    return { label: "Connection Error", className: "bg-red-100 text-red-700", tooltip: details };
  }

  return { label: "Error", className: "bg-red-100 text-red-700", tooltip: details || "Unknown error" };
};

const Backups: React.FC = () => {
  const [mode, setMode] = useState<BackupMode>("d-drive");

  const statsEndpoint = mode === "d-drive" ? "/backup-stats" : "/ibstorage-stats";

  const { data, loading, error, refetch } = useFetch(statsEndpoint);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "success" | "failed"
  >("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [scanDate, setScanDate] = useState("");
  const [scanProgress, setScanProgress] = useState<{
    total: number;
    completed: number;
    success: number;
    failed: number;
    current?: string;
  } | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const results: BackupRecord[] = data?.data || [];
  const advancedDateResults: BackupRecord[] = data?.advancedDate || [];

  const searchFiltered = results.filter(
    (r) =>
      r.outletCode?.toLowerCase().includes(search.toLowerCase()) ||
      r.server?.toLowerCase().includes(search.toLowerCase())
  );
  const successCount = searchFiltered.filter(
    (r) => r.status === "Successful"
  ).length;
  const errorCount = searchFiltered.filter(
    (r) => r.status !== "Successful"
  ).length;

  const filtered = searchFiltered.filter((r) => {
    if (statusFilter === "success") return r.status === "Successful";
    if (statusFilter === "failed") return r.status !== "Successful";
    return true;
  });

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginatedFiltered = filtered.slice((page - 1) * pageSize, page * pageSize);

  const isIB = mode === "ibstorage";
  const modeLabel = isIB ? "IBSTORAGE" : "D Drive";

  // --- Selection helpers ---
  const toggleSelect = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const toggleSelectPage = () => {
    const pageItems = paginatedFiltered.map((r) => r.outletCode);
    const allPageSelected = pageItems.every((code) => selected.has(code));
    if (allPageSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        pageItems.forEach((code) => next.delete(code));
        return next;
      });
    } else {
      setSelected((prev) => new Set([...Array.from(prev), ...pageItems]));
    }
  };

  const selectAllFiltered = () => {
    const allCodes = filtered.map((r) => r.outletCode);
    setSelected((prev: Set<string>) => new Set([...Array.from(prev), ...allCodes]));
  };

  const selectAllAdvanced = () => {
    const allCodes = advancedDateResults.map((r) => r.outletCode);
    setSelected((prev: Set<string>) => new Set([...Array.from(prev), ...allCodes]));
  };

  // Check if all items on current page are selected (for the banner)
  const allPageSelected = paginatedFiltered.length > 0 && paginatedFiltered.every((r) => selected.has(r.outletCode));
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.outletCode));
  const showSelectAllBanner = allPageSelected && !allFilteredSelected && filtered.length > pageSize;

  const handleSync = async () => {
    if (selected.size === 0) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const syncFn = isIB ? syncIBStorageOutlets : syncOutlets;
      const res = await syncFn(Array.from(selected)) as {
        syncedCount: number;
        syncSuccessCount: number;
        syncFailedCount: number;
      };
      if (res.syncFailedCount === 0) {
        setSyncMsg(`Synced ${res.syncSuccessCount} outlet(s) successfully`);
      } else if (res.syncSuccessCount === 0) {
        setSyncMsg(`Sync completed: all ${res.syncFailedCount} outlet(s) still failed`);
      } else {
        setSyncMsg(
          `Sync completed: ${res.syncSuccessCount} successful, ${res.syncFailedCount} still failed`
        );
      }
      setSelected(new Set());
      refetch();
    } catch {
      setSyncMsg("Sync failed. Please try again.");
    } finally {
      setSyncing(false);
    }
  };

  const handleModeSwitch = (newMode: BackupMode) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setMode(newMode);
    setSearch("");
    setStatusFilter("all");
    setSelected(new Set());
    setSyncMsg(null);
    setShowAdvanced(false);
    setScanDate("");
    setScanProgress(null);
    setScanning(false);
    setPage(1);
  };

  const handleScan = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setScanning(true);
    setSyncMsg(null);
    setScanProgress(null);

    const base = mode === "d-drive" ? "/backup-status/scan" : "/ibstorage-status/scan";
    const apiBase = "/api/v1";
    const url = scanDate ? `${apiBase}${base}?scan_date=${scanDate}` : `${apiBase}${base}`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "start") {
          setScanProgress({ total: msg.total, completed: 0, success: 0, failed: 0 });
        } else if (msg.type === "progress") {
          setScanProgress({
            total: msg.total,
            completed: msg.completed,
            success: msg.success,
            failed: msg.failed,
            current: msg.current,
          });
        } else if (msg.type === "complete") {
          setScanProgress({
            total: msg.total,
            completed: msg.total,
            success: msg.success,
            failed: msg.failed,
          });
          es.close();
          eventSourceRef.current = null;
          setScanning(false);
          refetch();
          setSyncMsg(
            `${modeLabel} scan completed: ${msg.success} successful, ${msg.failed} failed`
          );
        } else if (msg.type === "error") {
          es.close();
          eventSourceRef.current = null;
          setScanning(false);
          setScanProgress(null);
          setSyncMsg(msg.message || `${modeLabel} scan failed.`);
        }
      } catch {
        // ignore malformed SSE data
      }
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      setScanning(false);
      setScanProgress(null);
      setSyncMsg(`${modeLabel} scan connection failed. Please try again.`);
    };
  };

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Backups</h1>
          <p className="text-gray-600 mt-1">
            Detailed backup status for all outlets
          </p>
        </div>
        {data?.timestamp && (
          <span className="text-xs text-gray-400">
            Last checked: {new Date(data.timestamp).toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true })}
          </span>
        )}
      </div>

      {/* D Drive / IBSTORAGE Toggle */}
      <div className="flex items-center gap-1 mb-6 bg-white rounded-lg shadow p-1 w-fit">
        <button
          onClick={() => handleModeSwitch("d-drive")}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            mode === "d-drive"
              ? "bg-blue-600 text-white"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          D Drive
        </button>
        <button
          onClick={() => handleModeSwitch("ibstorage")}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            mode === "ibstorage"
              ? "bg-blue-600 text-white"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          IBSTORAGE
        </button>
      </div>

      {/* Scan toolbar: date picker + scan button */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 font-medium">Scan Date:</label>
          <input
            type="date"
            value={scanDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setScanDate(e.target.value)}
            max={new Date().toISOString().split("T")[0]}
            disabled={scanning}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          {scanDate && (
            <button
              onClick={() => setScanDate("")}
              disabled={scanning}
              className="text-gray-400 hover:text-gray-600 text-lg leading-none disabled:opacity-50"
              title="Clear date"
            >
              &times;
            </button>
          )}
        </div>

        <button
          onClick={handleScan}
          disabled={scanning}
          className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {scanning ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              Scanning...
            </>
          ) : scanDate ? (
            <>Scan for {scanDate}</>
          ) : (
            <>Scan All (Today)</>
          )}
        </button>
      </div>

      {/* Progress bar */}
      {scanProgress && (
        <div className="mb-6 bg-white shadow rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">
              Scanning {modeLabel}...{" "}
              {scanProgress.completed}/{scanProgress.total}{" "}
              ({scanProgress.total > 0
                ? Math.round((scanProgress.completed / scanProgress.total) * 100)
                : 0}%)
            </span>
            {scanProgress.current && (
              <span className="text-xs text-gray-500">
                Current: {scanProgress.current}
              </span>
            )}
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className="h-3 rounded-full bg-blue-600 transition-all duration-300 ease-out"
              style={{
                width: `${
                  scanProgress.total > 0
                    ? (scanProgress.completed / scanProgress.total) * 100
                    : 0
                }%`,
              }}
            />
          </div>
          <div className="flex items-center gap-4 mt-2 text-sm">
            <span className="text-green-600 font-medium">
              {scanProgress.success} Successful
            </span>
            <span className="text-red-600 font-medium">
              {scanProgress.failed} Failed
            </span>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-blue-600 mb-6">
          <svg
            className="animate-spin h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
          Loading {modeLabel} backups...
        </div>
      )}

      {error && (
        <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        <div
          onClick={() => {
            setStatusFilter(statusFilter === "success" ? "all" : "success");
            setShowAdvanced(false);
            setPage(1);
          }}
          className={`bg-white shadow rounded-lg p-4 cursor-pointer transition-all ${
            statusFilter === "success"
              ? "ring-2 ring-green-500"
              : "hover:shadow-md"
          }`}
        >
          <span className="text-gray-500 text-sm">Successful</span>
          <p className="text-2xl font-bold text-green-600">{successCount}</p>
        </div>
        <div
          onClick={() => {
            setStatusFilter(statusFilter === "failed" ? "all" : "failed");
            setShowAdvanced(false);
            setPage(1);
          }}
          className={`bg-white shadow rounded-lg p-4 cursor-pointer transition-all ${
            statusFilter === "failed"
              ? "ring-2 ring-red-500"
              : "hover:shadow-md"
          }`}
        >
          <span className="text-gray-500 text-sm">Failed</span>
          <p className="text-2xl font-bold text-red-600">{errorCount}</p>
        </div>
        <div
          onClick={() => { setStatusFilter("all"); setShowAdvanced(false); setPage(1); }}
          className={`bg-white shadow rounded-lg p-4 cursor-pointer transition-all ${
            statusFilter === "all"
              ? "ring-2 ring-blue-500"
              : "hover:shadow-md"
          }`}
        >
          <span className="text-gray-500 text-sm">Total</span>
          <p className="text-2xl font-bold text-blue-600">
            {searchFiltered.length}
          </p>
        </div>

        {/* Advanced Date Card */}
        {advancedDateResults.length > 0 && (
          <div
            onClick={() => { setShowAdvanced(!showAdvanced); setStatusFilter("all"); setPage(1); }}
            className={`bg-white shadow rounded-lg p-4 border-l-4 border-orange-400 cursor-pointer transition-all ${
              showAdvanced ? "ring-2 ring-orange-500" : "hover:shadow-md"
            }`}
          >
            <span className="text-gray-500 text-sm">
              Backup in Advanced Date
            </span>
            <p className="text-2xl font-bold text-orange-500">
              {advancedDateResults.length}
            </p>
          </div>
        )}
      </div>

      {/* Search + Sync bar */}
      {!loading && !showAdvanced && results.length > 0 && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <input
            type="text"
            placeholder="Search by outlet or server..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full md:w-72 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {selected.size > 0 && (
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {syncing ? (
                <>
                  <svg
                    className="animate-spin h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                    />
                  </svg>
                  Syncing...
                </>
              ) : (
                <>Sync Selected ({selected.size})</>
              )}
            </button>
          )}

          {selected.size > 0 && (
            <button
              onClick={() => setSelected(new Set())}
              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
            >
              Clear selection
            </button>
          )}
        </div>
      )}

      {/* Sync feedback message */}
      {syncMsg && (
        <div
          className={`mb-4 px-4 py-3 rounded-lg text-sm ${
            syncMsg.includes("failed")
              ? "bg-red-50 border border-red-200 text-red-700"
              : "bg-green-50 border border-green-200 text-green-700"
          }`}
        >
          {syncMsg}
        </div>
      )}

      {/* Backup Table */}
      {!loading && !showAdvanced && filtered.length > 0 && (
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-500 uppercase bg-gray-50">
                <tr>
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={
                        paginatedFiltered.length > 0 &&
                        paginatedFiltered.every((r) => selected.has(r.outletCode))
                      }
                      onChange={toggleSelectPage}
                      className="rounded border-gray-300"
                    />
                  </th>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Outlet</th>
                  <th className="px-4 py-3">Server</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Last Backup</th>
                  <th className="px-4 py-3">Backup File</th>
                  <th className="px-4 py-3">Size</th>
                  {isIB && <th className="px-4 py-3">Drive</th>}
                </tr>
              </thead>
              <tbody>
                {showSelectAllBanner && (
                  <tr>
                    <td colSpan={isIB ? 9 : 8} className="bg-blue-50 px-4 py-2 text-sm text-center text-blue-700">
                      All {paginatedFiltered.length} outlets on this page are selected.{" "}
                      <button onClick={selectAllFiltered} className="font-semibold underline hover:text-blue-900">
                        Select all {filtered.length} {statusFilter === "failed" ? "failed " : ""}outlets
                      </button>
                    </td>
                  </tr>
                )}
                {allFilteredSelected && filtered.length > pageSize && (
                  <tr>
                    <td colSpan={isIB ? 9 : 8} className="bg-blue-50 px-4 py-2 text-sm text-center text-blue-700">
                      All {filtered.length} {statusFilter === "failed" ? "failed " : ""}outlets are selected.{" "}
                      <button onClick={() => setSelected(new Set())} className="font-semibold underline hover:text-blue-900">
                        Clear selection
                      </button>
                    </td>
                  </tr>
                )}
                {paginatedFiltered.map((r, i) => (
                  <tr
                    key={r.outletCode}
                    className={`border-b hover:bg-gray-50 ${
                      selected.has(r.outletCode) ? "bg-blue-50" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(r.outletCode)}
                        onChange={() => toggleSelect(r.outletCode)}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-400">{(page - 1) * pageSize + i + 1}</td>
                    <td className="px-4 py-3 font-medium">{r.outletCode}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {r.server || "-"}
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const badge = getStatusBadge(r);
                        return (
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium ${badge.className}`}
                            title={badge.tooltip}
                          >
                            {badge.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {r.lastModified
                        ? new Date(r.lastModified).toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true })
                        : "-"}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {r.file || "-"}
                    </td>
                    <td className="px-4 py-3 text-gray-600 font-medium">
                      {r.backupsize || "-"}
                    </td>
                    {isIB && (
                      <td className="px-4 py-3 text-gray-600">
                        {r.driveLetter || "-"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50">
              <p className="text-xs text-gray-500">
                Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, filtered.length)} of{" "}
                {filtered.length} entries
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(1)}
                  disabled={page === 1}
                  className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  First
                </button>
                <button
                  onClick={() => setPage(page - 1)}
                  disabled={page === 1}
                  className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Prev
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(
                    (p) =>
                      p === 1 ||
                      p === totalPages ||
                      (p >= page - 1 && p <= page + 1)
                  )
                  .reduce<(number | string)[]>((acc, p, idx, arr) => {
                    if (idx > 0 && p - (arr[idx - 1] as number) > 1)
                      acc.push("...");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((item, idx) =>
                    typeof item === "string" ? (
                      <span key={`dots-${idx}`} className="px-1 text-xs text-gray-400">
                        ...
                      </span>
                    ) : (
                      <button
                        key={item}
                        onClick={() => setPage(item)}
                        className={`px-2.5 py-1 text-xs rounded border ${
                          page === item
                            ? "bg-blue-600 text-white border-blue-600"
                            : "border-gray-300 bg-white hover:bg-gray-100"
                        }`}
                      >
                        {item}
                      </button>
                    )
                  )}
                <button
                  onClick={() => setPage(page + 1)}
                  disabled={page === totalPages}
                  className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
                <button
                  onClick={() => setPage(totalPages)}
                  disabled={page === totalPages}
                  className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Last
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Advanced Date Table */}
      {!loading && showAdvanced && advancedDateResults.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-bold text-orange-600 mb-3">
            Backup in Advanced Date
          </h2>
          <p className="text-gray-500 text-sm mb-4">
            These outlets have backup dates beyond the current year. Their
            server dates may be incorrect.
          </p>

          {/* Sync bar for advanced date */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <button
              onClick={selectAllAdvanced}
              className="px-3 py-2 text-sm font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors"
            >
              Select All ({advancedDateResults.length})
            </button>

            {selected.size > 0 && (
              <button
                onClick={handleSync}
                disabled={syncing}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {syncing ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    Syncing...
                  </>
                ) : (
                  <>Sync Selected ({selected.size})</>
                )}
              </button>
            )}

            {selected.size > 0 && (
              <button
                onClick={() => setSelected(new Set())}
                className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
              >
                Clear selection
              </button>
            )}
          </div>

          <div className="bg-white shadow rounded-lg overflow-hidden border-l-4 border-orange-400">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-500 uppercase bg-orange-50">
                  <tr>
                    <th className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={advancedDateResults.length > 0 && advancedDateResults.every((r) => selected.has(r.outletCode))}
                        onChange={() => {
                          const allSelected = advancedDateResults.every((r) => selected.has(r.outletCode));
                          if (allSelected) {
                            setSelected((prev: Set<string>) => {
                              const next = new Set(prev);
                              advancedDateResults.forEach((r) => next.delete(r.outletCode));
                              return next;
                            });
                          } else {
                            selectAllAdvanced();
                          }
                        }}
                        className="rounded border-gray-300"
                      />
                    </th>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Outlet</th>
                    <th className="px-4 py-3">Server</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Last Backup</th>
                    <th className="px-4 py-3">Backup File</th>
                    <th className="px-4 py-3">Size</th>
                    {isIB && <th className="px-4 py-3">Drive</th>}
                  </tr>
                </thead>
                <tbody>
                  {advancedDateResults.map((r, i) => (
                    <tr key={r.outletCode} className={`border-b hover:bg-orange-50 ${selected.has(r.outletCode) ? "bg-blue-50" : ""}`}>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(r.outletCode)}
                          onChange={() => toggleSelect(r.outletCode)}
                          className="rounded border-gray-300"
                        />
                      </td>
                      <td className="px-4 py-3 text-gray-400">{i + 1}</td>
                      <td className="px-4 py-3 font-medium">{r.outletCode}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {r.server || "-"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                          Advanced Date
                        </span>
                      </td>
                      <td className="px-4 py-3 text-orange-600 font-medium">
                        {r.lastModified
                          ? new Date(r.lastModified).toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true })
                          : "-"}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {r.file || "-"}
                      </td>
                      <td className="px-4 py-3 text-gray-600 font-medium">
                        {r.backupsize || "-"}
                      </td>
                      {isIB && (
                        <td className="px-4 py-3 text-gray-600">
                          {r.driveLetter || "-"}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !scanning && !showAdvanced && !error && filtered.length === 0 && (
        <div className="bg-white shadow rounded-lg p-8 text-center">
          <p className="text-gray-500">
            {search
              ? "No outlets match your search."
              : `No ${modeLabel} backup records found. Use the scan button above to check all outlet servers.`}
          </p>
        </div>
      )}
    </div>
  );
};

export default Backups;
