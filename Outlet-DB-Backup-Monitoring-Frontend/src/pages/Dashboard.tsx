import React, { useState, useRef, useEffect } from "react";
import useFetch from "../hooks/useFetch";

type BackupMode = "d-drive" | "ibstorage";

interface DailySummary {
  scanDate: string;
  total: number;
  successful: number;
  failed: number;
}

const Dashboard: React.FC = () => {
  const [mode, setMode] = useState<BackupMode>("d-drive");

  const statsEndpoint = mode === "d-drive" ? "/backup-stats" : "/ibstorage-stats";
  const summaryEndpoint = mode === "d-drive" ? "/backup-stats/daily-summary" : "/ibstorage-stats/daily-summary";

  const { data, loading, error, refetch } = useFetch(statsEndpoint);
  const {
    data: summaryData,
    loading: summaryLoading,
    error: summaryError,
  } = useFetch(summaryEndpoint);

  const results = data?.data || [];
  const advancedDateCount = data?.advancedDateCount || 0;
  const totalServers = results.length;
  const successCount = results.filter(
    (r: any) => r.status === "Successful"
  ).length;
  const failedCount = totalServers - successCount;

  const advancedDateResults: any[] = data?.advancedDate || [];
  const [showAdvanced, setShowAdvanced] = useState(false);

  const dailySummary: DailySummary[] = summaryData?.data || [];
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const totalPages = Math.ceil(dailySummary.length / pageSize);
  const paginatedSummary = dailySummary.slice(
    (page - 1) * pageSize,
    page * pageSize
  );

  const modeLabel = mode === "d-drive" ? "D Drive" : "IBSTORAGE";
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
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

  const handleScan = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setScanning(true);
    setScanMsg(null);
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
          setScanMsg(
            `${modeLabel} scan completed: ${msg.success} successful, ${msg.failed} failed`
          );
        } else if (msg.type === "error") {
          es.close();
          eventSourceRef.current = null;
          setScanning(false);
          setScanProgress(null);
          setScanMsg(msg.message || `${modeLabel} scan failed.`);
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
      setScanMsg(`${modeLabel} scan connection failed. Please try again.`);
    };
  };

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">
            Overview of outlet backup status
          </p>
        </div>
        <div className="flex items-center gap-4">
          {data?.timestamp && (
            <span className="text-xs text-gray-400">
              Last updated:{" "}
              {new Date(data.timestamp).toLocaleString(undefined, {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "numeric",
                minute: "2-digit",
                second: "2-digit",
                hour12: true,
              })}
            </span>
          )}
        </div>
      </div>

      {/* D Drive / IBSTORAGE Toggle */}
      <div className="flex items-center gap-1 mb-6 bg-white rounded-lg shadow p-1 w-fit">
        <button
          onClick={() => { setMode("d-drive"); setPage(1); setShowAdvanced(false); setScanMsg(null); }}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${mode === "d-drive"
            ? "bg-blue-600 text-white"
            : "text-gray-600 hover:bg-gray-100"
            }`}
        >
          D Drive
        </button>
        <button
          onClick={() => { setMode("ibstorage"); setPage(1); setShowAdvanced(false); setScanMsg(null); }}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${mode === "ibstorage"
            ? "bg-blue-600 text-white"
            : "text-gray-600 hover:bg-gray-100"
            }`}
        >
          IBSTORAGE
        </button>
      </div>

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
          Loading {modeLabel} dashboard...
        </div>
      )}

      {error && (
        <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

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
                width: `${scanProgress.total > 0
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

      {/* Today's Summary Cards */}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-5">
            <p className="text-gray-500 text-sm">Total Servers</p>
            <p className="text-3xl font-bold text-gray-800 mt-1">
              {totalServers}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <p className="text-gray-500 text-sm">Successful Backups</p>
            <p className="text-3xl font-bold text-green-600 mt-1">
              {successCount}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <p className="text-gray-500 text-sm">Failed Backups</p>
            <p className="text-3xl font-bold text-red-600 mt-1">
              {failedCount}
            </p>
          </div>
          {advancedDateCount > 0 && (
            <div
              onClick={() => setShowAdvanced(!showAdvanced)}
              className={`bg-white rounded-lg shadow p-5 border-l-4 border-orange-400 cursor-pointer transition-all ${showAdvanced ? "ring-2 ring-orange-500" : "hover:shadow-md"
                }`}
            >
              <p className="text-gray-500 text-sm">Advanced Date</p>
              <p className="text-3xl font-bold text-orange-500 mt-1">
                {advancedDateCount}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {showAdvanced ? "Click to hide" : "Click to view"}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Advanced Date Records Table */}
      {showAdvanced && advancedDateResults.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-hidden mb-8 border-l-4 border-orange-400">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-orange-600">
              Backup in Advanced Date
            </h2>
            <p className="text-gray-500 text-xs mt-1">
              These outlets have backup dates beyond the current year. Their server dates may be incorrect.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-500 uppercase bg-orange-50">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Outlet</th>
                  <th className="px-4 py-3">Server</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Last Backup</th>
                  <th className="px-4 py-3">Backup File</th>
                  <th className="px-4 py-3">Size</th>
                  {mode === "ibstorage" && <th className="px-4 py-3">Drive</th>}
                </tr>
              </thead>
              <tbody>
                {advancedDateResults.map((r: any, i: number) => (
                  <tr key={r.outletCode} className="border-b hover:bg-orange-50">
                    <td className="px-4 py-3 text-gray-400">{i + 1}</td>
                    <td className="px-4 py-3 font-medium">{r.outletCode}</td>
                    <td className="px-4 py-3 text-gray-600">{r.server || "-"}</td>
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
                    <td className="px-4 py-3 text-gray-600">{r.file || "-"}</td>
                    <td className="px-4 py-3 text-gray-600 font-medium">
                      {r.backupsize || "-"}
                    </td>
                    {mode === "ibstorage" && (
                      <td className="px-4 py-3 text-gray-600">{r.driveLetter || "-"}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Success Rate Bar */}
      {!loading && totalServers > 0 && (
        <div className="bg-white rounded-lg shadow p-5 mb-8">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-700">
              Today's Success Rate ({modeLabel})
            </p>
            <p className="text-sm font-bold text-gray-800">
              {Math.round((successCount / totalServers) * 100)}%
            </p>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className="bg-green-500 h-3 rounded-full transition-all duration-500"
              style={{
                width: `${(successCount / totalServers) * 100}%`,
              }}
            />
          </div>
          <div className="flex justify-between mt-2 text-xs text-gray-500">
            <span>{successCount} successful</span>
            <span>{failedCount} failed</span>
          </div>
        </div>
      )}

      {/* Day-wise Summary */}
      {summaryError && (
        <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {summaryError}
        </div>
      )}

      {summaryLoading && (
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
          Loading daily summary...
        </div>
      )}

      {!summaryLoading && dailySummary.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-800">
              Day-wise Backup Summary ({modeLabel})
            </h2>
            <p className="text-gray-500 text-xs mt-1">
              Historical backup results by scan date
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-500 uppercase bg-gray-50">
                <tr>
                  <th className="px-5 py-3">#</th>
                  <th className="px-5 py-3">Scan Date</th>
                  <th className="px-5 py-3">Total</th>
                  <th className="px-5 py-3">Successful</th>
                  <th className="px-5 py-3">Failed</th>
                  <th className="px-5 py-3">Success Rate</th>
                </tr>
              </thead>
              <tbody>
                {paginatedSummary.map((day, i) => {
                  const rate =
                    day.total > 0
                      ? Math.round((day.successful / day.total) * 100)
                      : 0;
                  const isToday =
                    day.scanDate === new Date().toISOString().slice(0, 10);
                  return (
                    <tr
                      key={day.scanDate}
                      className={`border-b hover:bg-gray-50 ${isToday ? "bg-blue-50" : ""
                        }`}
                    >
                      <td className="px-5 py-3 text-gray-400">
                        {(page - 1) * pageSize + i + 1}
                      </td>
                      <td className="px-5 py-3 font-medium">
                        {new Date(day.scanDate + "T00:00:00").toLocaleDateString(
                          undefined,
                          {
                            weekday: "short",
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          }
                        )}
                        {isToday && (
                          <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
                            Today
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 font-medium text-gray-800">
                        {day.total}
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-green-600 font-medium">
                          {day.successful}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`font-medium ${day.failed > 0 ? "text-red-600" : "text-gray-400"
                            }`}
                        >
                          {day.failed}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-20 bg-gray-200 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full ${rate >= 90
                                ? "bg-green-500"
                                : rate >= 70
                                  ? "bg-yellow-500"
                                  : "bg-red-500"
                                }`}
                              style={{ width: `${rate}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-600 font-medium">
                            {rate}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50">
              <p className="text-xs text-gray-500">
                Showing {(page - 1) * pageSize + 1}-
                {Math.min(page * pageSize, dailySummary.length)} of{" "}
                {dailySummary.length} days
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
                        className={`px-2.5 py-1 text-xs rounded border ${page === item
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

      {/* Scan feedback message */}
      {scanMsg && (
        <div
          className={`mb-6 px-4 py-3 rounded-lg text-sm ${scanMsg.includes("failed")
            ? "bg-red-50 border border-red-200 text-red-700"
            : "bg-green-50 border border-green-200 text-green-700"
            }`}
        >
          {scanMsg}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && totalServers === 0 && (
        <div className="bg-white shadow rounded-lg p-8 text-center">
          <p className="text-gray-500 mb-4">
            No {modeLabel} backup records found. Run a scan to check all outlet servers.
          </p>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {scanning ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Scanning {modeLabel}...
              </>
            ) : (
              <>Scan All Outlets ({modeLabel})</>
            )}
          </button>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
