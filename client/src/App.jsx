import { NavLink, Route, Routes, Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Leads from "./pages/Leads.jsx";
import Outreach from "./pages/Outreach.jsx";
import Support from "./pages/Support.jsx";
import Activity from "./pages/Activity.jsx";
import ChatWidget from "./components/ChatWidget.jsx";

function Shell() {
  const { name, logout } = useAuth();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span style={{ width: 22, height: 22, borderRadius: 6, background: "var(--molten)", display: "inline-block" }} />
          <span className="name">Vex<span className="grad">Forge</span> HQ</span>
        </div>
        <NavLink to="/" end className={({ isActive }) => `navlink ${isActive ? "active" : ""}`}>Dashboard</NavLink>
        <NavLink to="/crm" className={({ isActive }) => `navlink ${isActive ? "active" : ""}`}>CRM · Leads</NavLink>
        <NavLink to="/outreach" className={({ isActive }) => `navlink ${isActive ? "active" : ""}`}>Outreach Queue</NavLink>
        <NavLink to="/support" className={({ isActive }) => `navlink ${isActive ? "active" : ""}`}>Call & Support</NavLink>
        <NavLink to="/activity" className={({ isActive }) => `navlink ${isActive ? "active" : ""}`}>Activity Log</NavLink>
        <div className="sidebar-foot">
          Signed in as <strong style={{ color: "var(--snow)" }}>{name}</strong>
          <button className="logout-btn" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/crm" element={<Leads />} />
          <Route path="/outreach" element={<Outreach />} />
          <Route path="/support" element={<Support />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <ChatWidget />
    </div>
  );
}

export default function App() {
  const { token } = useAuth();
  if (!token) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  return <Shell />;
}
