import React, { useContext } from "react";
import { BrowserRouter as Router, Route, Routes, Navigate } from "react-router-dom";
import { AuthContext, AuthProvider } from "./context/AuthContext";
import Sidebar from "./components/Sidebar/Sidebar";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Backups from "./pages/Backups";
import Servers from "./pages/Servers";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import "./index.css";
import "./App.css";

const LoadingScreen: React.FC = () => (
  <div className="min-h-screen w-full flex items-center justify-center bg-gray-100">
    <div className="text-center">
      <svg className="w-10 h-10 animate-spin text-blue-500 mx-auto mb-3" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <p className="text-gray-500 text-sm">Loading...</p>
    </div>
  </div>
);

const ProtectedRoute: React.FC<{ element: React.ReactNode }> = ({ element }) => {
  const { user, loading } = useContext(AuthContext);
  if (loading) return <LoadingScreen />;
  return user ? <>{element}</> : <Navigate to="/login" replace />;
};


const ProtectedLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ProtectedRoute
    element={
      <div className="min-h-screen">
        <Sidebar />
        <div className="ml-64 min-h-screen">{children}</div>
      </div>
    }
  />
);


const LoginGuard: React.FC = () => {
  const { user, loading } = useContext(AuthContext);
  if (loading) return <LoadingScreen />;
  return user ? <Navigate to="/dashboard" replace /> : <Login />;
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <Router basename="/backup-monitor">
        <Routes>
          <Route path="/login" element={<LoginGuard />} />
          <Route path="/dashboard" element={<ProtectedLayout><Dashboard /></ProtectedLayout>} />
          <Route path="/backups" element={<ProtectedLayout><Backups /></ProtectedLayout>} />
          <Route path="/servers" element={<ProtectedLayout><Servers /></ProtectedLayout>} />
          <Route path="/reports" element={<ProtectedLayout><Reports /></ProtectedLayout>} />
          <Route path="/settings" element={<ProtectedLayout><Settings /></ProtectedLayout>} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
};

export default App;
