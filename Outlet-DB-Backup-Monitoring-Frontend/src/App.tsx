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

const ProtectedRoute: React.FC<{ element: React.ReactNode }> = ({ element }) => {
  const { user } = useContext(AuthContext);
  return user ? <>{element}</> : <Navigate to="/login" replace />;
};

const ProtectedLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ProtectedRoute
    element={
      <div className="flex w-full min-h-screen">
        <Sidebar />
        <div className="flex-1 p-6">{children}</div>
      </div>
    }
  />
);

const App: React.FC = () => {
  return (
    <AuthProvider>
      <Router basename="/backup-monitor">
        <Routes>
          <Route path="/login" element={<Login />} />
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
