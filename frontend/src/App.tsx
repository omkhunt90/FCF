import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { CompetitionProvider } from './context/CompetitionContext';
import ProtectedRoute from './components/ProtectedRoute';
import './styles/design-system.css';

// Lazy load pages for code splitting
const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const ParticipantsAdmin = lazy(() => import('./pages/admin/ParticipantsAdmin'));
const TasksAdmin = lazy(() => import('./pages/admin/TasksAdmin'));
const SubmissionsAdmin = lazy(() => import('./pages/admin/SubmissionsAdmin'));
const ParticipantDashboard = lazy(() => import('./pages/participant/ParticipantDashboard'));
const CodingScreen = lazy(() => import('./pages/participant/CodingScreen'));
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage'));


const LoadingFallback = () => (
  <div className="loading-page">
    <div className="spinner" />
    <span>Loading...</span>
  </div>
);

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <CompetitionProvider>
            <Suspense fallback={<LoadingFallback />}>
              <Routes>
                {/* Public */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/" element={<Navigate to="/login" replace />} />

                {/* Admin routes */}
                <Route element={<ProtectedRoute role="ADMIN" />}>
                  <Route element={<AdminLayout />}>
                    <Route path="/admin" element={<AdminDashboard />} />
                    <Route path="/admin/participants" element={<ParticipantsAdmin />} />
                    <Route path="/admin/tasks" element={<TasksAdmin />} />
                    <Route path="/admin/submissions" element={<SubmissionsAdmin />} />
                    <Route path="/admin/leaderboard" element={<LeaderboardPage />} />
                  </Route>
                </Route>

                {/* Participant routes */}
                <Route element={<ProtectedRoute role="PARTICIPANT" />}>
                  <Route path="/participant" element={<ParticipantDashboard />} />
                  <Route path="/participant/round" element={<CodingScreen />} />
                </Route>

                {/* Catch-all */}
                <Route path="*" element={<Navigate to="/login" replace />} />
              </Routes>
            </Suspense>
          </CompetitionProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
