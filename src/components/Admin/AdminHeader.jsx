import { useNavigate } from "react-router-dom";

function AdminHeader({ admin, parish, showProfileDropdown, setShowProfileDropdown, onLogout }) {
  const navigate = useNavigate();

  return (
    <header className="admin-header">
      <div className="admin-header-left">
        <div className="admin-logo" onClick={() => navigate("/")} style={{ cursor: "pointer" }}>
          <img src="/logo.png" alt="TimeForMass" className="logo-image" />
          <span className="logo-text">TimeForMass</span>
        </div>
        <h1 className="admin-page-title">Parish Schedule</h1>
      </div>
      <div className="admin-header-right">
        <div className="admin-profile-wrapper">
          <div className="admin-profile" onClick={() => setShowProfileDropdown(!showProfileDropdown)}>
            <div className="admin-info">
              <div className="admin-name">{admin.name}</div>
              <div className="admin-parish">{parish.name}</div>
            </div>
            <button className="admin-dropdown-toggle" aria-label="Toggle menu">{showProfileDropdown ? "▲" : "▼"}</button>
          </div>
          <div className={`profile-dropdown ${showProfileDropdown ? "show" : ""}`}>
            <button className="dropdown-item" onClick={() => { navigate("/"); setShowProfileDropdown(false); }}>View Mass Schedules</button>
            <button className="dropdown-item" onClick={() => { onLogout(); setShowProfileDropdown(false); }}>Logout</button>
          </div>
        </div>
      </div>
    </header>
  );
}

export default AdminHeader;