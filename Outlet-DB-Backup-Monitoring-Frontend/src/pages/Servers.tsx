import React, { useState, useRef, useEffect, useCallback } from "react";
import { fetchData } from "../services/apiServices";

type BackupMode = "d-drive" | "ibstorage";

const Servers: React.FC = () => {
  const [mode, setMode] = useState<BackupMode>("d-drive");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<{
    total: number;
    completed: number;
    success: number;
    failed: number;
    current?: string;
  } | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const modeLabel = mode === "d-drive" ? "D Drive" : "IBSTORAGE";

  const startScan = useCallback((activeMode: BackupMode) => {
    // Close any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setLoading(true);
    setError(null);
    setResults([]);
    setScanProgress(null);

    const base = activeMode === "d-drive" ? "/backup-status/scan" : "/ibstorage-status/scan";
    const apiBase = "/api/v1";
    const url = `${apiBase}${base}`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    const label = activeMode === "d-drive" ? "D Drive" : "IBSTORAGE";

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

          // Fetch saved results from read-only endpoint
          const statsEndpoint = activeMode === "d-drive" ? "/backup-stats" : "/ibstorage-stats";
          fetchData(statsEndpoint)
            .then((res: any) => {
              setResults(res.data || []);
            })
            .catch(() => {
              setError(`Failed to load ${label} results.`);
            })
            .finally(() => {
              setLoading(false);
            });
        } else if (msg.type === "error") {
          es.close();
          eventSourceRef.current = null;
          setLoading(false);
          setScanProgress(null);
          setError(msg.message || `${label} scan failed.`);
        }
      } catch {
        // ignore malformed SSE data
      }
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      setLoading(false);
      setScanProgress(null);
      setError(`${label} scan connection failed. Please try again.`);
    };
  }, []);

  // Auto-scan on mount and mode switch
  useEffect(() => {
    startScan(mode);
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [mode, startScan]);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Servers</h1>
        <p className="text-gray-500 text-sm mt-1">All outlet servers and their status</p>
      </div>

      {/* D Drive / IBSTORAGE Toggle */}
      <div className="flex items-center gap-1 mb-6 bg-white rounded-lg shadow p-1 w-fit">
        <button
          onClick={() => setMode("d-drive")}
          disabled={loading}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            mode === "d-drive"
              ? "bg-blue-600 text-white"
              : "text-gray-600 hover:bg-gray-100"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          D Drive
        </button>
        <button
          onClick={() => setMode("ibstorage")}
          disabled={loading}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            mode === "ibstorage"
              ? "bg-blue-600 text-white"
              : "text-gray-600 hover:bg-gray-100"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          IBSTORAGE
        </button>
      </div>

      {/* Progress bar */}
      {scanProgress && loading && (
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

      {/* Initial loading (before SSE start event) */}
      {loading && !scanProgress && !error && (
        <div className="flex items-center gap-2 text-blue-600 mb-6">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Connecting to {modeLabel} scan...
        </div>
      )}

      {error && (
        <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {results.map((r: any, i: number) => (
            <div
              key={i}
              className={`bg-white rounded-lg shadow p-4 border-l-4 ${
                r.status === "Successful" ? "border-green-500" : "border-red-500"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-gray-800">{r.outletCode}</h3>
                <span
                  className={`px-2 py-1 rounded-full text-xs font-medium ${
                    r.status === "Successful"
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {r.status}
                </span>
              </div>
              <p className="text-sm text-gray-500">{r.server}</p>
              {r.status === "Successful" && r.lastModified && (
                <p className="text-xs text-gray-400 mt-2">
                  Last backup: {new Date(r.lastModified).toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true })}
                </p>
              )}
              {mode === "ibstorage" && r.driveLetter && (
                <p className="text-xs text-blue-500 mt-1">Drive: {r.driveLetter}</p>
              )}
              {r.errorDetails && (
                <p className="text-xs text-red-500 mt-2">{r.errorDetails}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && results.length === 0 && !error && (
        <p className="text-gray-500">No servers found.</p>
      )}
    </div>
  );
};

export default Servers;
