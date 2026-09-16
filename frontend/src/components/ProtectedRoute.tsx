import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface ProtectedRouteProps {
  role?: 'ADMIN' | 'PARTICIPANT';
  redirectTo?: string;
}

export default function ProtectedRoute({ role, redirectTo = '/login' }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="loading-page">
        <div className="spinner" />
        <span>Loading...</span>
      </div>
    );
  }

  if (!user) return <Navigate to={redirectTo} replace />;

  if (role && user.role !== role) {
    // Redirect to appropriate area
    return <Navigate to={user.role === 'ADMIN' ? '/admin' : '/participant'} replace />;
  }

  return <Outlet />;
}
