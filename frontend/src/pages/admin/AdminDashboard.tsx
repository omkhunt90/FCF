import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useCompetition } from '../../context/CompetitionContext';
import Timer from '../../components/Timer';
import Round3PowerPanel from '../../components/Round3PowerPanel';
import type { AuditEvent, Competition as CompetitionType } from '../../types';

interface DashboardData {
  totalParticipants: number;
  activeParticipants: number;
  totalSubmissions: number;
  acceptedSubmissions: number;
  competition: CompetitionType;
  serverTime: number;
}

export default function AdminDashboard() {
  const { competition, currentRound, remainingMs, refreshCompetition, isPaused } = useCompetition();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [recentAudit, setRecentAudit] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState('');

  const fetchAll = async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const [dashRes, auditRes] = await Promise.all([
        api.getAdminDashboard(),
        api.getAuditEvents(),
      ]);
      if (dashRes.success) setDashboard(dashRes.data as DashboardData);
      if (auditRes.success) setRecentAudit((auditRes.data as AuditEvent[]).slice(0, 20));
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => { void fetchAll(true); }, []);

  // Refresh every 15 seconds
  useEffect(() => {
    const interval = setInterval(() => { void fetchAll(); }, 15_000);
    return () => clearInterval(interval);
  }, []);

  const handleStartRound = async (roundId: string) => {
    setActionLoading(true);
    try {
      await api.startRound(roundId);
      await refreshCompetition();
      setMessage('Round started!');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setMessage(e.response?.data?.message ?? 'Failed to start round');
    } finally {
      setActionLoading(false);
    }
  };

  const handleEndRound = async (roundId: string) => {
    setActionLoading(true);
    try {
      await api.endRound(roundId);
      await refreshCompetition();
      setMessage('Round ended.');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setMessage(e.response?.data?.message ?? 'Failed to end round');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePauseRound = async (roundId: string) => {
    setActionLoading(true);
    try {
      await api.pauseRound(roundId);
      await refreshCompetition();
      setMessage('Round paused.');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setMessage(e.response?.data?.message ?? 'Failed to pause round');
    } finally {
      setActionLoading(false);
    }
  };

  const handleResumeRound = async (roundId: string) => {
    setActionLoading(true);
    try {
      await api.resumeRound(roundId);
      await refreshCompetition();
      setMessage('Round resumed.');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setMessage(e.response?.data?.message ?? 'Failed to resume round');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSetActivity = async (roundId: string, activityId: string) => {
    setActionLoading(true);
    try {
      await api.setActiveActivity(roundId, activityId);
      await refreshCompetition();
      setMessage('Active activity updated.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm(
      '⚠️ RESET COMPETITION?\n\nThis will permanently clear:\n• All submissions\n• All scores\n• Leaderboard\n• Audit events\n• All timers\n\nRound 1 will return to UPCOMING so you can test again.\n\nContinue?'
    )) return;
    setActionLoading(true);
    try {
      await api.resetCompetition();
      await refreshCompetition();
      await fetchAll();
      setMessage('✅ Competition reset! All data cleared. Round 1 is UPCOMING — participants can join to start.');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setMessage(e.response?.data?.message ?? 'Reset failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleFixActivityType = async (activityId: string, name: string) => {
    if (!window.confirm(`Fix this activity to CODE_DEBUGGING?\n\nThis will update "${name}" in the database so it works as a Round 2 Code Debugging activity.`)) return;
    setActionLoading(true);
    try {
      await api.patchActivity(activityId, { type: 'CODE_DEBUGGING', name: 'Code Debugging', durationMs: 20 * 60 * 1000 });
      await refreshCompetition();
      setMessage('✅ Activity updated to CODE_DEBUGGING (Code Debugging, 20 min). You can now assign tasks to it in Task Management.');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setMessage(e.response?.data?.message ?? 'Failed to update activity type');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSetupRound2 = async () => {
    setActionLoading(true);
    try {
      const res = await api.setupRound2();
      await refreshCompetition();
      setMessage(`✅ ${String(res.message ?? 'Round 2 initialized!')} Now go to Task Management to assign the Code Debugging task.`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setMessage(e.response?.data?.message ?? 'Failed to initialize Round 2');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSetupRound3 = async () => {
    setActionLoading(true);
    try {
      const res = await api.setupRound3();
      await refreshCompetition();
      setMessage(`✅ ${String(res.message ?? 'Round 3 initialized!')} Now go to Task Management to assign the Coding Sprint task.`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setMessage(e.response?.data?.message ?? 'Failed to initialize Round 3');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-page">
        <div className="spinner" />
        Loading dashboard...
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Admin Dashboard</h1>
          <p className="page-subtitle">{competition?.name ?? 'No competition configured'}</p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {/* Only show round timer if there are rounds with admin control (Round 2+) */}
          {currentRound && currentRound.roundNumber > 1 && (
            <Timer remainingMs={remainingMs} isPaused={isPaused} />
          )}
          <button
            id="reset-competition-btn"
            className="btn btn-danger btn-sm"
            onClick={() => void handleReset()}
            disabled={actionLoading}
            title="Reset all competition data for retesting"
          >
            🔄 Reset Competition
          </button>
        </div>
      </div>

      {message && (
        <div className="alert alert-info" style={{ marginBottom: '20px' }}>
          {message}
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setMessage('')}>✕</button>
        </div>
      )}

      {/* Stats */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Total Participants</div>
          <div className="stat-value">{dashboard?.totalParticipants ?? 0}</div>
          <div className="stat-sub">{dashboard?.activeParticipants ?? 0} active</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Submissions</div>
          <div className="stat-value">{dashboard?.totalSubmissions ?? 0}</div>
          <div className="stat-sub">{dashboard?.acceptedSubmissions ?? 0} correct</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Competition Status</div>
          <div className="stat-value" style={{ fontSize: '1rem', marginTop: '4px' }}>
            <span className={`badge ${
              competition?.status === 'RUNNING' ? 'badge-success' :
              competition?.status === 'COMPLETED' ? 'badge-muted' : 'badge-warning'
            }`}>
              {competition?.status ?? 'UNKNOWN'}
            </span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Current Round</div>
          <div className="stat-value" style={{ fontSize: '1rem', marginTop: '4px' }}>
            {currentRound?.name ?? '—'}
          </div>
          <div className="stat-sub">
            <span className={`badge badge-sm ${
              currentRound?.status === 'ACTIVE' ? 'badge-success' :
              currentRound?.status === 'ENDED' ? 'badge-muted' : 'badge-info'
            }`}>
              {currentRound?.status ?? '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Round 2 missing banner */}
      {!competition?.rounds.find(r => r.roundNumber === 2) && (
        <div className="alert alert-warning" style={{ marginBottom: 24 }}>
          <strong>⚠ Round 2 is not set up yet.</strong> Click the button below to create Round 2 (Code Debugging, 20 min) in the database.
          <div style={{ marginTop: 12 }}>
            <button
              id="init-round2-btn"
              className="btn btn-primary"
              onClick={() => void handleSetupRound2()}
              disabled={actionLoading}
            >
              {actionLoading ? '⏳ Initializing…' : '🐛 Initialize Round 2 (Code Debugging)'}
            </button>
          </div>
        </div>
      )}

      {/* Round 3 missing banner */}
      {competition?.rounds.find(r => r.roundNumber === 2) && !competition?.rounds.find(r => r.roundNumber === 3) && (
        <div className="alert alert-info" style={{ marginBottom: 24 }}>
          <strong>ℹ️ Round 3 is not set up yet.</strong> Click the button below to create Round 3 (Coding Sprint, 30 min) in the database.
          <div style={{ marginTop: 12 }}>
            <button
              id="init-round3-btn"
              className="btn btn-primary"
              onClick={() => void handleSetupRound3()}
              disabled={actionLoading}
            >
              {actionLoading ? '⏳ Initializing…' : '🏃 Initialize Round 3 (Coding Sprint)'}
            </button>
          </div>
        </div>
      )}

      {/* Round control */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <h3 className="card-title">Round Control</h3>
        </div>
        {competition?.rounds.map((round) => (
          <div
            key={round.id}
            style={{
              padding: '16px 0',
              borderBottom: '1px solid var(--border-color)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: round.roundNumber === 1 ? 8 : 0 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
                  {round.name}
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  {round.durationMs / 60000} min total · {round.activities.length} activities
                </div>
              </div>

              <span className={`badge ${
                round.status === 'ACTIVE' ? 'badge-success' :
                round.status === 'PAUSED' ? 'badge-warning' :
                round.status === 'ENDED' ? 'badge-muted' : 'badge-info'
              }`}>
                {round.status}
              </span>

              {/* Round 1: fully participant-controlled, no admin buttons */}
              {round.roundNumber === 1 ? (
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  🤖 Auto-managed by participants
                </span>
              ) : (
                <>
                  {/* Activity selector for admin-controlled rounds */}
                  <select
                    className="form-select"
                    style={{ width: 'auto' }}
                    value={round.activeActivityId ?? ''}
                    onChange={(e) => void handleSetActivity(round.id, e.target.value)}
                    disabled={actionLoading}
                  >
                    <option value="">Select activity...</option>
                    {round.activities.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>

                  {round.status === 'UPCOMING' && (
                    <button
                      className="btn btn-success btn-sm"
                      onClick={() => void handleStartRound(round.id)}
                      disabled={actionLoading}
                    >
                      Start Round
                    </button>
                  )}
                  {round.status === 'ACTIVE' && (
                    <>
                      <button
                        className="btn btn-warning btn-sm"
                        onClick={() => void handlePauseRound(round.id)}
                        disabled={actionLoading}
                      >
                        Pause
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => void handleEndRound(round.id)}
                        disabled={actionLoading}
                      >
                        End Round
                      </button>
                    </>
                  )}
                  {round.status === 'PAUSED' && (
                    <>
                      <button
                        className="btn btn-success btn-sm"
                        onClick={() => void handleResumeRound(round.id)}
                        disabled={actionLoading}
                      >
                        Resume
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => void handleEndRound(round.id)}
                        disabled={actionLoading}
                      >
                        End Round
                      </button>
                    </>
                  )}
                  {round.status === 'ENDED' && (
                    <button className="btn btn-secondary btn-sm" disabled>Ended</button>
                  )}
                </>
              )}
            </div>

            {/* For Round 1: show activity list read-only */}
            {round.roundNumber === 1 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                {round.activities.map(a => (
                  <span
                    key={a.id}
                    className={`badge ${a.isActive ? 'badge-success' : 'badge-muted'}`}
                    style={{ fontSize: '0.75rem' }}
                  >
                    {a.name} · {(a.durationMs ?? 900000) / 60000} min {a.isActive ? '(active)' : ''}
                  </span>
                ))}
              </div>
            )}

            {/* For Round 2: show activity type status + fix button if needed */}
            {round.roundNumber === 2 && (
              <div style={{ marginTop: 8 }}>
                {round.activities.length === 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <p style={{ fontSize: '0.8125rem', color: 'var(--color-error, #ef4444)', margin: 0 }}>
                      ⚠ No activities in Round 2.
                    </p>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => void handleSetupRound2()}
                      disabled={actionLoading}
                    >
                      🐛 Add Code Debugging Activity
                    </button>
                  </div>
                )}
                {round.activities.map(a => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                    <span className={`badge ${a.type === 'CODE_DEBUGGING' ? 'badge-success' : 'badge-warning'}`}
                      style={{ fontSize: '0.75rem' }}>
                      {a.name} · {a.type}
                    </span>
                    {a.type !== 'CODE_DEBUGGING' && (
                      <button
                        className="btn btn-warning btn-sm"
                        style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                        onClick={() => void handleFixActivityType(a.id, a.name)}
                        disabled={actionLoading}
                        title="Update this activity's type to CODE_DEBUGGING"
                      >
                        🔧 Fix → CODE_DEBUGGING
                      </button>
                    )}
                    {a.type === 'CODE_DEBUGGING' && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-success, #22c55e)' }}>
                        ✓ Ready — go to <strong>Task Management</strong> to assign the debugging task
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {/* For Round 3: show CODING_SPRINT activity status */}
            {round.roundNumber === 3 && (
              <div style={{ marginTop: 8 }}>
                {round.activities.length === 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <p style={{ fontSize: '0.8125rem', color: 'var(--color-error, #ef4444)', margin: 0 }}>
                      ⚠ No activities in Round 3.
                    </p>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => void handleSetupRound3()}
                      disabled={actionLoading}
                    >
                      🏃 Add Coding Sprint Activity
                    </button>
                  </div>
                )}
                {round.activities.map(a => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                    <span className={`badge ${a.type === 'CODING_SPRINT' ? 'badge-success' : 'badge-warning'}`}
                      style={{ fontSize: '0.75rem' }}>
                      {a.name} · {a.type}
                    </span>
                    {a.type === 'CODING_SPRINT' && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-success, #22c55e)' }}>
                        ✓ Ready — go to <strong>Task Management</strong> to assign the Coding Sprint task
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Round 3 Power Cards panel (shown when Round 3 is ACTIVE) */}
      {currentRound?.roundNumber === 3 && currentRound.status === 'ACTIVE' && (
        <Round3PowerPanel actionLoading={actionLoading} setMessage={setMessage} />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Leaderboard shortcut */}
        <div className="card">
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 className="card-title">Leaderboard</h3>
            <a href="/admin/leaderboard" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>
              View Full Leaderboard →
            </a>
          </div>
          <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Full per-activity and per-round rankings are available on the Leaderboard page.
            All teams are shown with scores, solve counts, and timestamps.
          </div>
        </div>

        {/* Recent audit events */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Recent Activity Flags</h3>
          </div>
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {recentAudit.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', padding: '12px', textAlign: 'center' }}>No events</p>
            ) : recentAudit.map((event) => (
              <div
                key={event.id}
                style={{
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border-color)',
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'flex-start',
                }}
              >
                <span className="badge badge-warning" style={{ flexShrink: 0, fontSize: '0.6875rem' }}>
                  {event.eventType.replace('_', ' ')}
                </span>
                <div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-primary)' }}>
                    {event.participant?.displayName ?? 'Unknown'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {new Date(event.occurredAt).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
