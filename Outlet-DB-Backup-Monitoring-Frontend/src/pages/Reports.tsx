import React, { useState, useEffect } from "react";
import { fetchData } from "../services/apiServices";

type BackupMode = "d-drive" | "ibstorage";

const Reports: React.FC = () => {
  const [mode, setMode] = useState<BackupMode>("d-drive");
  const [outlets, setOutlets] = useState<string[]>([]);
  const [selectedOutlet, setSelectedOutlet] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const modeLabel = mode === "d-drive" ? "D Drive" : "IBSTORAGE";

  const handleModeSwitch = (newMode: BackupMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    setResults([]);
    setSearched(false);
    setError(null);
  };

  useEffect(() => {
    fetchData("/outlets")
      .then((res: any) => setOutlets(res.data || []))
      .catch(() => setOutlets([]));
  }, []);

  const handleSearch = async () => {
    setLoading(true);
    setError(null);
    setSearched(true);
    setPage(1);

    const params = new URLSearchParams();
    if (selectedOutlet) params.append("outlet", selectedOutlet);
    if (dateFrom) params.append("date_from", dateFrom);
    if (dateTo) params.append("date_to", dateTo);

    const query = params.toString();
    const baseEndpoint = mode === "d-drive" ? "/backup-stats" : "/ibstorage-stats";
    const endpoint = `${baseEndpoint}${query ? `?${query}` : ""}`;

    try {
      const res: any = await fetchData(endpoint);
      setResults(res.data || []);
    } catch {
      setError("Failed to fetch report data. Please try again.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setSelectedOutlet("");
    setDateFrom("");
    setDateTo("");
    setResults([]);
    setSearched(false);
    setError(null);
  };

  const onlineCount = results.filter((r: any) => r.status === "Successful").length;
  const errorCount = results.filter((r: any) => r.status === "Error").length;
  const totalPages = Math.ceil(results.length / pageSize);
  const paginatedResults = results.slice((page - 1) * pageSize, page * pageSize);

  const exportCSV = () => {
    const isIB = mode === "ibstorage";
    const headers = isIB
      ? ["#", "Outlet", "IP", "Drive", "Status", "Scan Date", "Last Backup Taken", "Backup File", "Backup Size", "Error"]
      : ["#", "Outlet", "IP", "Status", "Scan Date", "Last Backup Taken", "Backup File", "Backup Size", "Error"];
    const rows = results.map((r: any, i: number) => {
      const base = [
        i + 1,
        r.outletCode,
        r.server,
      ];
      if (isIB) base.push(r.driveLetter || "");
      base.push(
        r.status,
        r.scanDate || "",
        r.lastModified ? new Date(r.lastModified).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }) : "",
        r.file || "",
        r.backupsize || "",
        r.errorDetails || "",
      );
      return base;
    });

    const csvContent = [
      headers.join(","),
      ...rows.map((row: any) =>
        row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;

    const modeTag = isIB ? "ibstorage_backup_report" : "d_drive_backup_report";
    const now = new Date();
    const datePart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const hours = now.getHours();
    const h12 = hours % 12 || 12;
    const ampm = hours < 12 ? "am" : "pm";
    const timePart = `${h12}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")} ${ampm}`;
    link.download = `${modeTag}_${datePart}_${timePart}.csv`;

    link.click();
    URL.revokeObjectURL(url);
  };

  const hasFilters = selectedOutlet || dateFrom || dateTo;

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-blue-50 rounded-lg">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{modeLabel} Backup Reports</h1>
              <p className="text-gray-500 text-sm">
                Filter by date range and outlet to generate {modeLabel.toLowerCase()} backup reports
              </p>
            </div>
          </div>
        </div>
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

      {/* Filters Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Filters</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Outlet */}
          <div className="flex flex-col">
            <label className="text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">
              Outlet
            </label>
            <select
              value={selectedOutlet}
              onChange={(e: any) => setSelectedOutlet(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
            >
              <option value="">All Outlets</option>
              {outlets.map((code: any) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          </div>

          {/* Date From */}
          <div className="flex flex-col">
            <label className="text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">
              From Date
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e: any) => setDateFrom(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
            />
          </div>

          {/* Date To */}
          <div className="flex flex-col">
            <label className="text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">
              To Date
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e: any) => setDateTo(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col">
            <label className="text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">&nbsp;</label>
            <div className="flex gap-2">
            <button
              onClick={handleSearch}
              disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-medium py-2.5 px-4 rounded-lg transition-all duration-150 flex items-center justify-center gap-2 shadow-sm hover:shadow"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Searching...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  Search
                </>
              )}
            </button>
            {hasFilters && (
              <button
                onClick={handleReset}
                className="px-3 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg transition-colors text-sm"
                title="Reset filters"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            </div>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
          <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-red-700 text-sm font-medium">{error}</span>
        </div>
      )}

      {/* Summary Cards */}
      {searched && !loading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex items-center gap-4">
            <div className="p-3 bg-blue-50 rounded-xl">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Entries</p>
              <p className="text-2xl font-bold text-gray-900">{results.length}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex items-center gap-4">
            <div className="p-3 bg-emerald-50 rounded-xl">
              <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Successful</p>
              <p className="text-2xl font-bold text-emerald-600">{onlineCount}</p>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex items-center gap-4">
            <div className="p-3 bg-red-50 rounded-xl">
              <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Failed</p>
              <p className="text-2xl font-bold text-red-600">{errorCount}</p>
            </div>
          </div>
        </div>
      )}

      {/* Results Table */}
      {searched && !loading && results.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Table Header */}
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Report Results</h2>
              <div className="flex items-center gap-2 mt-1">
                {selectedOutlet && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                    {selectedOutlet}
                  </span>
                )}
                {dateFrom && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                    From: {dateFrom}
                  </span>
                )}
                {dateTo && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                    To: {dateTo}
                  </span>
                )}
                {!selectedOutlet && !dateFrom && !dateTo && (
                  <span className="text-xs text-gray-400">All outlets, all dates</span>
                )}
              </div>
            </div>
            <button
              onClick={exportCSV}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-all duration-150 shadow-sm hover:shadow"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export CSV
            </button>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-12">#</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Outlet</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">IP</th>
                  {mode === "ibstorage" && (
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Drive</th>
                  )}
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Scan Date</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Last Backup Taken</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Backup File</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Backup Size</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginatedResults.map((r: any, i: number) => (
                  <tr key={i} className={`hover:bg-blue-50/40 transition-colors ${i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}>
                    <td className="px-6 py-3.5 text-gray-400 font-mono text-xs">{(page - 1) * pageSize + i + 1}</td>
                    <td className="px-6 py-3.5 font-semibold text-gray-900">{r.outletCode}</td>
                    <td className="px-6 py-3.5 text-gray-600 font-mono text-xs">{r.server}</td>
                    {mode === "ibstorage" && (
                      <td className="px-6 py-3.5 text-gray-600 font-mono text-xs">{r.driveLetter || <span className="text-gray-300">&mdash;</span>}</td>
                    )}
                    <td className="px-6 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                          r.status === "Successful"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-red-50 text-red-700 border border-red-200"
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${r.status === "Successful" ? "bg-emerald-500" : "bg-red-500"}`} />
                        {r.status === "Successful" ? "Success" : "Failed"}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-gray-600 text-xs">
                      {r.scanDate || <span className="text-gray-300">&mdash;</span>}
                    </td>
                    <td className="px-6 py-3.5 text-gray-600 text-xs">
                      {r.lastModified ? new Date(r.lastModified).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }) : (
                        <span className="text-gray-300">&mdash;</span>
                      )}
                    </td>
                    <td className="px-6 py-3.5 text-gray-600 text-xs font-mono truncate max-w-[200px]" title={r.file || ""}>
                      {r.file || <span className="text-gray-300">&mdash;</span>}
                    </td>
                    <td className="px-6 py-3.5 text-gray-600 text-xs">
                      {r.backupsize || <span className="text-gray-300">&mdash;</span>}
                    </td>
                    <td className="px-6 py-3.5 text-red-500 text-xs max-w-[200px] truncate" title={r.errorDetails || ""}>
                      {r.errorDetails || <span className="text-gray-300">&mdash;</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Table Footer with Pagination */}
          <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500 flex items-center justify-between">
            <span>
              Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, results.length)} of{" "}
              {results.length} {results.length === 1 ? "entry" : "entries"}
            </span>
            {totalPages > 1 && (
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
            )}
            <span>
              {onlineCount} successful, {errorCount} failed
            </span>
          </div>
        </div>
      )}

      {/* Empty State */}
      {searched && !loading && results.length === 0 && !error && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <div className="mx-auto w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-gray-900 mb-1">No results found</h3>
          <p className="text-sm text-gray-500 max-w-sm mx-auto">
            No backup records match the selected filters. Try adjusting the date range or outlet selection.
          </p>
          <button
            onClick={handleReset}
            className="mt-4 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Reset filters
          </button>
        </div>
      )}

      {/* Initial State */}
      {!searched && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <div className="mx-auto w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9zm3.75 11.625a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-gray-900 mb-1">Generate a Report</h3>
          <p className="text-sm text-gray-500 max-w-sm mx-auto">
            Select your filters above and click <strong>Search</strong> to generate a backup status report.
          </p>
        </div>
      )}

      {/* Loading Overlay */}
      {loading && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <svg className="animate-spin h-10 w-10 text-blue-600 mx-auto mb-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <h3 className="text-base font-semibold text-gray-900 mb-1">Generating {modeLabel} Report</h3>
          <p className="text-sm text-gray-500">Fetching {modeLabel.toLowerCase()} backup records. This may take a moment...</p>
        </div>
      )}
    </div>
  );
};

export default Reports;
