import React, { useState } from 'react';
import { NavLink, useNavigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { api } from '../../api/client';

const NAV_ITEMS = [
  { to: '/admin', label: 'Dashboard', icon: '⬛', end: true },
  { to: '/admin/participants', label: 'Participants', icon: '👥' },
  { to: '/admin/tasks', label: 'Tasks', icon: '📋' },
  { to: '/admin/submissions', label: 'Submissions', icon: '📤' },
  { to: '/admin/leaderboard', label: 'Leaderboard', icon: '🏆' },
];


export default function AdminLayout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters');
      return;
    }

    setPasswordLoading(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setPasswordSuccess('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setShowPasswordModal(false);
        setPasswordSuccess('');
      }, 1500);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setPasswordError(e.response?.data?.message ?? 'Failed to change password');
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>FCF Admin</h1>
          <p>SciClone Engineer's Day</p>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-label">Competition</div>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Bottom controls */}
        <div style={{ padding: '16px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <button
            className="btn btn-ghost btn-sm w-full"
            style={{ color: 'var(--sidebar-text)', justifyContent: 'flex-start', marginBottom: '8px' }}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? '☀ Light Mode' : '🌙 Dark Mode'}
          </button>
          <button
            className="btn btn-ghost btn-sm w-full"
            style={{ color: 'var(--sidebar-text)', justifyContent: 'flex-start', marginBottom: '8px' }}
            onClick={() => setShowPasswordModal(true)}
          >
            🔑 Change Password
          </button>
          <button
            className="btn btn-ghost btn-sm w-full"
            style={{ color: 'var(--sidebar-text)', justifyContent: 'flex-start' }}
            onClick={handleLogout}
          >
            ↩ Sign Out
          </button>
          <div style={{ marginTop: '12px', fontSize: '0.75rem', color: 'var(--sidebar-text)' }}>
            {user?.username}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content">
        <Outlet />
      </main>

      {/* Password Change Modal */}
      {showPasswordModal && (
        <div className="modal-overlay" onClick={() => setShowPasswordModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Change Password</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowPasswordModal(false)}>✕</button>
            </div>
            <form onSubmit={handleChangePassword}>
              <div className="modal-body">
                {passwordError && <div className="alert alert-error">{passwordError}</div>}
                {passwordSuccess && <div className="alert alert-success">{passwordSuccess}</div>}
                <div className="form-group">
                  <label className="form-label">Current Password</label>
                  <input
                    type="password"
                    className="form-input"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">New Password</label>
                  <input
                    type="password"
                    className="form-input"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Confirm New Password</label>
                  <input
                    type="password"
                    className="form-input"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowPasswordModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={passwordLoading}>
                  {passwordLoading ? 'Changing...' : 'Change Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
