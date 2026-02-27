import React, { useState, useEffect } from "react";
import {
  fetchSchedulerConfig,
  updateSchedulerConfig,
  fetchSchedulerStatus,
} from "../services/apiServices";

const INTERVAL_OPTIONS = [
  { value: 30, label: "30 min" },
  { value: 35, label: "35 min" },
  { value: 40, label: "40 min" },
  { value: 45, label: "45 min" },
  { value: 50, label: "50 min" },
  { value: 60, label: "1 Hour" },
  { value: 120, label: "2 Hours" },
  { value: 180, label: "3 Hours" },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => {
  const h = i % 12 || 12;
  const ampm = i < 12 ? "AM" : "PM";
  return { value: i, label: `${h}:00 ${ampm}` };
});

const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const Settings: React.FC = () => {
  const [interval, setInterval_] = useState(60);
  const [startHour, setStartHour] = useState(8);
  const [endHour, setEndHour] = useState(0);
  const [activeDays, setActiveDays] = useState<string[]>([...ALL_DAYS]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [status, setStatus] = useState<any>(null);

  // Load config + status on mount
  useEffect(() => {
    Promise.all([fetchSchedulerConfig(), fetchSchedulerStatus()])
      .then(([cfg, sts]) => {
        setInterval_(cfg.intervalMinutes);
        setStartHour(cfg.startHour);
        setEndHour(cfg.endHour);
        setActiveDays(cfg.activeDays || [...ALL_DAYS]);
        setStatus(sts);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Poll status every 30s
  useEffect(() => {
    const id = window.setInterval(() => {
      fetchSchedulerStatus().then(setStatus).catch(() => {});
    }, 30000);
    return () => window.clearInterval(id);
  }, []);

  const toggleDay = (day: string) => {
    setActiveDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleApply = async () => {
    if (activeDays.length === 0) {
      setToast({ type: "error", message: "Select at least one active day" });
      return;
    }
    setSaving(true);
    setToast(null);
    try {
      await updateSchedulerConfig({
        intervalMinutes: interval,
        startHour,
        endHour,
        activeDays,
      });
      setToast({ type: "success", message: "Schedule updated successfully" });
      // Refresh status to show new next-run times
      fetchSchedulerStatus().then(setStatus).catch(() => {});
    } catch (err: any) {
      const msg = err?.response?.data?.message || "Failed to update schedule";
      setToast({ type: "error", message: msg });
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 4000);
    }
  };

  if (loading) {
    return (
      <div className="p-6 bg-gray-100 min-h-screen flex items-center justify-center">
        <svg className="w-8 h-8 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  const dDrive = status?.d_drive;
  const ibStorage = status?.ib_storage;

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Settings</h1>
        <p className="text-gray-600 mt-1">Manage auto-scan schedule configuration</p>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
            toast.type === "success"
              ? "bg-green-100 text-green-700 border border-green-200"
              : "bg-red-100 text-red-700 border border-red-200"
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Schedule Configuration Card */}
        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Schedule Configuration</h2>

          {/* Interval */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Run Every</label>
            <select
              value={interval}
              onChange={(e) => setInterval_(Number(e.target.value))}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Active Hours */}
          <div className="grid grid-cols-2 gap-4 mb-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Active From</label>
              <select
                value={startHour}
                onChange={(e) => setStartHour(Number(e.target.value))}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {HOUR_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Active Until</label>
              <select
                value={endHour}
                onChange={(e) => setEndHour(Number(e.target.value))}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {HOUR_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Active Days */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Active Days</label>
            <div className="flex flex-wrap gap-2">
              {ALL_DAYS.map((day) => {
                const active = activeDays.includes(day);
                return (
                  <button
                    key={day}
                    onClick={() => toggleDay(day)}
                    className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      active
                        ? "bg-blue-600 text-white"
                        : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Apply Button */}
          <button
            onClick={handleApply}
            disabled={saving}
            className="w-full px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Applying...
              </>
            ) : (
              "Apply Schedule"
            )}
          </button>
        </div>

        {/* Current Status Card */}
        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Scanner Status</h2>

          {/* D Drive Status */}
          <div className="mb-5 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${
                  dDrive?.status === "Running"
                    ? "bg-blue-500 animate-pulse"
                    : dDrive?.status === "Failed"
                    ? "bg-red-500"
                    : "bg-green-500"
                }`}
              />
              <span className="text-sm font-semibold text-gray-700">D Drive</span>
              <span className="text-xs text-gray-500 ml-auto">{dDrive?.status || "—"}</span>
            </div>
            {dDrive?.lastScanEnd && (
              <p className="text-xs text-gray-500">
                Last run:{" "}
                {new Date(dDrive.lastScanEnd).toLocaleString(undefined, {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                })}
                {dDrive.total != null && (
                  <span className="ml-1">
                    — {dDrive.successful}/{dDrive.total} successful
                  </span>
                )}
              </p>
            )}
            {status?.nextDDriveRun && (
              <p className="text-xs text-gray-400 mt-0.5">
                Next:{" "}
                {new Date(status.nextDDriveRun).toLocaleString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                })}
              </p>
            )}
          </div>

          {/* IBSTORAGE Status */}
          <div className="mb-5 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${
                  ibStorage?.status === "Running"
                    ? "bg-blue-500 animate-pulse"
                    : ibStorage?.status === "Failed"
                    ? "bg-red-500"
                    : "bg-green-500"
                }`}
              />
              <span className="text-sm font-semibold text-gray-700">IBSTORAGE</span>
              <span className="text-xs text-gray-500 ml-auto">{ibStorage?.status || "—"}</span>
            </div>
            {ibStorage?.lastScanEnd && (
              <p className="text-xs text-gray-500">
                Last run:{" "}
                {new Date(ibStorage.lastScanEnd).toLocaleString(undefined, {
                  month: "2-digit",
                  day: "2-digit",
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                })}
                {ibStorage.total != null && (
                  <span className="ml-1">
                    — {ibStorage.successful}/{ibStorage.total} successful
                  </span>
                )}
              </p>
            )}
            {status?.nextIBStorageRun && (
              <p className="text-xs text-gray-400 mt-0.5">
                Next:{" "}
                {new Date(status.nextIBStorageRun).toLocaleString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                })}
              </p>
            )}
          </div>

          {/* Active Schedule Summary */}
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
            <p className="text-sm font-medium text-blue-800 mb-1">Active Schedule</p>
            <p className="text-xs text-blue-600">
              Every{" "}
              {INTERVAL_OPTIONS.find((o) => o.value === status?.intervalMinutes)?.label ||
                `${status?.intervalMinutes} min`}
              {" "}from {status?.activeHours}
            </p>
            {status?.activeDays && (
              <p className="text-xs text-blue-600 mt-0.5">
                Days: {status.activeDays.join(", ")}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
