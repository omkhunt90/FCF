import React, { useEffect, useRef, useState } from 'react';
import { useCompetition } from '../../context/CompetitionContext';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';

export default function ParticipantDashboard() {
  const { competition, currentRound, isPaused, refreshCompetition } = useCompetition();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const autoNavRef = useRef(false); // prevent double-navigate on strict-mode double-mount
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshCompetition();
    } finally {
      setRefreshing(false);
    }
  };

  const isRound2 = currentRound?.roundNumber === 2;
  const isRound3 = currentRound?.roundNumber === 3;

  // Round 2: auto-navigate all participants simultaneously when admin starts it
  useEffect(() => {
    if (
      currentRound?.roundNumber === 2 &&
      currentRound.status === 'ACTIVE' &&
      !isPaused &&
      !autoNavRef.current
    ) {
      autoNavRef.current = true;
      navigate('/participant/round', { replace: true });
    }
  }, [currentRound?.roundNumber, currentRound?.status, isPaused, navigate]);

  // Round 3: auto-navigate when admin starts it
  useEffect(() => {
    if (
      currentRound?.roundNumber === 3 &&
      currentRound.status === 'ACTIVE' &&
      !isPaused &&
      !autoNavRef.current
    ) {
      autoNavRef.current = true;
      navigate('/participant/round', { replace: true });
    }
  }, [currentRound?.roundNumber, currentRound?.status, isPaused, navigate]);

  // Reset auto-nav guard when round changes (so it can trigger again if needed)
  useEffect(() => {
    autoNavRef.current = false;
  }, [currentRound?.id]);

  const handleEnterRound = () => {
    if (isPaused) return;
    navigate('/participant/round');
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const activeActivity = currentRound?.activities.find(
    (a) => a.id === currentRound.activeActivityId
  );

  // Round-specific instruction content
  const renderInstructions = () => {
    if (isRound3) {
      return (
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', lineHeight: 1.7 }}>
          <p style={{ marginBottom: '8px' }}>1. The Admin will start Round 3. You will be taken to the coding screen automatically.</p>
          <p style={{ marginBottom: '8px' }}>2. You will receive a coding problem. Read it carefully.</p>
          <p style={{ marginBottom: '8px' }}>3. Write your solution in C. Click <strong>Run</strong> to test against the provided test cases.</p>
          <p style={{ marginBottom: '8px' }}>4. The <strong>Submit button unlocks only when all test cases pass</strong>.</p>
          <p style={{ marginBottom: '8px' }}>5. The <strong>first team to submit a passing solution</strong> wins Round 3.</p>
          <p>6. You have <strong>30 minutes</strong>. The Admin controls the timer and may apply power cards to teams.</p>
        </div>
      );
    }
    if (isRound2) {
      return (
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', lineHeight: 1.7 }}>
          <p style={{ marginBottom: '8px' }}>
            1. The Admin will start Round 2. You will be taken to the coding screen automatically.
          </p>
          <p style={{ marginBottom: '8px' }}>
            2. You will see a C program with <strong>10 intentional errors</strong> pre-loaded in the editor.
          </p>
          <p style={{ marginBottom: '8px' }}>
            3. Analyse the code, find the bugs, and fix them directly in the editor.
          </p>
          <p style={{ marginBottom: '8px' }}>
            4. You have <strong>20 minutes</strong> — the timer is controlled by the Admin and runs for everyone at the same time.
          </p>
          <p style={{ marginBottom: '8px' }}>
            5. The <strong>Run button is disabled</strong> in Round 2. You can only Submit.
          </p>
          <p>
            6. Submit with the <strong>Submit Answer</strong> button. You may revise and resubmit anytime before time runs out.
          </p>
        </div>
      );
    }

    // Round 1 instructions
    return (
      <div style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', lineHeight: 1.7 }}>
        <p style={{ marginBottom: '8px' }}>
          1. Click <strong>Enter Round</strong> when the round starts — it auto-starts when you join.
        </p>
        <p style={{ marginBottom: '8px' }}>
          2. Choose which activity to do first — <strong>Dumb Charades</strong> or <strong>Blind Coding</strong>.
        </p>
        <p style={{ marginBottom: '8px' }}>
          3. Each activity has its own <strong>15-minute timer</strong> that starts when you click Start.
        </p>
        <p style={{ marginBottom: '8px' }}>
          4. The competition runs in <strong>fullscreen mode</strong>. Do not leave fullscreen during the round.
        </p>
        <p style={{ marginBottom: '8px' }}>
          5. For Dumb Charades, write a C program that <code className="mono">printf()</code>s your answer in <strong>lowercase</strong>.
        </p>
        <p>
          6. Submit with the <strong>Submit Answer</strong> button. Unlimited attempts per question.
        </p>
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div className="top-bar">
        <span className="top-bar-title">Fastest Coder First</span>
        <div className="top-bar-spacer" />
        <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginRight: 8 }}>
          {user?.displayName ?? user?.username}
        </span>
        <button
          id="participant-dashboard-top-refresh-btn"
          className="btn btn-ghost btn-sm"
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh competition state"
          style={{ marginRight: 6 }}
        >
          <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none', marginRight: 4 }}>↻</span>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={handleLogout}>Sign Out</button>
      </div>

      <div className="page-container">
        {/* Welcome */}
        <div className="page-header">
          <h1 className="page-title">Welcome, {user?.displayName ?? user?.username}!</h1>
          <p className="page-subtitle">SciClone Engineer's Day — Fastest Coder First</p>
        </div>

        {/* Status cards */}
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-label">Competition</div>
            <div className="stat-value" style={{ fontSize: '1.125rem' }}>
              {competition?.name ?? '—'}
            </div>
            <div className="stat-sub">
              <span className={`badge ${
                competition?.status === 'RUNNING' ? 'badge-success' :
                competition?.status === 'COMPLETED' ? 'badge-muted' :
                'badge-warning'
              }`}>
                {competition?.status ?? 'Loading...'}
              </span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Current Round</div>
            <div className="stat-value" style={{ fontSize: '1.125rem' }}>
              {currentRound?.name ?? 'Not started'}
            </div>
            <div className="stat-sub">
              <span className={`badge ${
                currentRound?.status === 'ACTIVE' ? 'badge-success' :
                currentRound?.status === 'ENDED' ? 'badge-muted' :
                'badge-info'
              }`}>
                {currentRound?.status ?? '—'}
              </span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Active Activity</div>
            <div className="stat-value" style={{ fontSize: '1.125rem' }}>
              {activeActivity?.name ?? '—'}
            </div>
            <div className="stat-sub" style={{ color: 'var(--text-muted)' }}>
              {isRound2 ? '🐛 Code Debugging' : (activeActivity?.type ?? 'Choose when you enter')}
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="card" style={{ marginBottom: '20px' }}>
          <div className="card-header">
            <h3 className="card-title">
              {isRound2 ? '🐛 Round 2 — Code Debugging' : 'Instructions'}
            </h3>
          </div>
          {renderInstructions()}
        </div>

        {/* Action buttons — Round 1 only; Round 2/3 auto-navigate */}
        {!isRound2 && !isRound3 && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 16 }}>
            {currentRound?.status === 'ACTIVE' && (
              <>
                <button
                  id="enter-round-btn"
                  className="btn btn-primary btn-lg"
                  onClick={handleEnterRound}
                >
                  Enter Round &rarr;
                </button>
                <button
                  id="active-round-refresh-btn"
                  className="btn btn-secondary btn-lg"
                  onClick={handleRefresh}
                  disabled={refreshing}
                >
                  <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none', marginRight: 6 }}>↻</span>
                  {refreshing ? 'Refreshing…' : 'Refresh Round'}
                </button>
              </>
            )}
          </div>
        )}

        {/* Round 2: waiting for admin to start */}
        {isRound2 && currentRound?.status === 'UPCOMING' && (
          <div className="alert alert-info" style={{ marginTop: 16 }}>
            <div style={{ marginBottom: 12 }}>
              ⏳ Waiting for the Admin to start Round 2. You will be taken to the coding screen automatically when it begins.
            </div>
            <button
              id="r2-waiting-refresh-btn"
              className="btn btn-primary btn-sm"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none', marginRight: 6 }}>↻</span>
              {refreshing ? 'Checking for new round…' : 'Refresh Status'}
            </button>
          </div>
        )}

        {/* Round 3: waiting for admin to start */}
        {isRound3 && currentRound?.status === 'UPCOMING' && (
          <div className="alert alert-info" style={{ marginTop: 16 }}>
            <div style={{ marginBottom: 12 }}>
              ⏳ Waiting for the Admin to start Round 3. You will be taken to the coding screen automatically when it begins.
            </div>
            <button
              id="r3-waiting-refresh-btn"
              className="btn btn-primary btn-sm"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none', marginRight: 6 }}>↻</span>
              {refreshing ? 'Checking for new round…' : 'Refresh Status'}
            </button>
          </div>
        )}

        {/* Round 2: paused */}
        {isRound2 && currentRound?.status === 'PAUSED' && (
          <div className="alert alert-warning" style={{ marginTop: 16 }}>
            <div style={{ marginBottom: 12 }}>
              ⏸ Round 2 is currently paused. The timer will resume when the Admin continues.
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none', marginRight: 6 }}>↻</span>
              {refreshing ? 'Checking…' : 'Refresh Status'}
            </button>
          </div>
        )}

        {/* Round 3: paused */}
        {isRound3 && currentRound?.status === 'PAUSED' && (
          <div className="alert alert-warning" style={{ marginTop: 16 }}>
            <div style={{ marginBottom: 12 }}>
              ⏸ Round 3 is currently paused. The timer will resume when the Admin continues.
            </div>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none', marginRight: 6 }}>↻</span>
              {refreshing ? 'Checking…' : 'Refresh Status'}
            </button>
          </div>
        )}

        {/* Any round: ended — show progress + what's next */}
        {currentRound?.status === 'ENDED' && (
          <div style={{ marginTop: 20 }}>

            {/* Progress stepper */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0,
              marginBottom: 24,
              flexWrap: 'wrap',
            }}>
              {/* Round 1 */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 90 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: !isRound2 && !isRound3 ? 'var(--color-success, #22c55e)' : (isRound2 || isRound3) ? 'var(--color-success, #22c55e)' : 'var(--bg-elevated)',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1rem', fontWeight: 700, border: '2px solid var(--color-success, #22c55e)',
                }}>✓</div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center' }}>Round 1<br/>Complete</span>
              </div>

              {/* Connector 1→2 */}
              <div style={{ width: 40, height: 2, background: isRound2 || isRound3 ? 'var(--color-success, #22c55e)' : 'var(--border-color)', margin: '0 4px', marginBottom: 20 }} />

              {/* Round 2 */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 90 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: isRound3 ? 'var(--color-success, #22c55e)' : isRound2 ? 'var(--color-warning, #f59e0b)' : 'var(--bg-elevated)',
                  color: isRound2 || isRound3 ? '#fff' : 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1rem', fontWeight: 700,
                  border: `2px solid ${isRound3 ? 'var(--color-success, #22c55e)' : isRound2 ? 'var(--color-warning, #f59e0b)' : 'var(--border-color)'}`,
                }}>
                  {isRound3 ? '✓' : isRound2 ? '●' : '2'}
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                  Round 2<br/>{isRound3 ? 'Complete' : isRound2 ? 'Ended' : 'Upcoming'}
                </span>
              </div>

              {/* Connector 2→3 */}
              <div style={{ width: 40, height: 2, background: isRound3 ? 'var(--color-success, #22c55e)' : 'var(--border-color)', margin: '0 4px', marginBottom: 20 }} />

              {/* Round 3 */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 90 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: isRound3 ? 'var(--color-warning, #f59e0b)' : 'var(--bg-elevated)',
                  color: isRound3 ? '#fff' : 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1rem', fontWeight: 700,
                  border: `2px solid ${isRound3 ? 'var(--color-warning, #f59e0b)' : 'var(--border-color)'}`,
                }}>
                  {isRound3 ? '●' : '3'}
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                  Round 3<br/>{isRound3 ? 'Ended' : 'Upcoming'}
                </span>
              </div>
            </div>

            {/* What's next card */}
            <div className="card" style={{ borderLeft: '4px solid var(--color-primary)', marginBottom: 16 }}>
              <div className="card-header" style={{ paddingBottom: 8 }}>
                <h3 className="card-title" style={{ margin: 0 }}>
                  {isRound3
                    ? '🏆 Competition Complete'
                    : isRound2
                    ? '✅ Round 2 Ended — Up Next: Round 3'
                    : '✅ Round 1 Ended — Up Next: Round 2'}
                </h3>
              </div>

              {/* Round 1 ended → preview Round 2 */}
              {!isRound2 && !isRound3 && (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', lineHeight: 1.7 }}>
                  <p style={{ marginBottom: 8 }}>🐛 <strong>Round 2 — Code Debugging</strong></p>
                  <p style={{ marginBottom: 4 }}>• A buggy C program with <strong>10 intentional errors</strong> will be loaded in the editor.</p>
                  <p style={{ marginBottom: 4 }}>• Find and fix all bugs, then Submit.</p>
                  <p style={{ marginBottom: 4 }}>• Duration: <strong>20 minutes</strong> (admin-controlled timer).</p>
                  <p style={{ marginBottom: 0 }}>• The <strong>Run button is disabled</strong> — only Submit is available.</p>
                </div>
              )}

              {/* Round 2 ended → preview Round 3 */}
              {isRound2 && (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', lineHeight: 1.7 }}>
                  <p style={{ marginBottom: 8 }}>⚡ <strong>Round 3 — Coding Sprint</strong></p>
                  <p style={{ marginBottom: 4 }}>• You will receive a fresh coding problem.</p>
                  <p style={{ marginBottom: 4 }}>• Write a C solution. Run to test, Submit when all test cases pass.</p>
                  <p style={{ marginBottom: 4 }}>• <strong>First team to submit a correct solution wins Round 3.</strong></p>
                  <p style={{ marginBottom: 0 }}>• Duration: <strong>30 minutes</strong> max.</p>
                </div>
              )}

              {/* Round 3 ended */}
              {isRound3 && (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', lineHeight: 1.7 }}>
                  <p style={{ marginBottom: 4 }}>All 3 rounds are complete. 🎉</p>
                  <p style={{ marginBottom: 0 }}>The Admin will announce the final results and winner shortly. Stay on this page.</p>
                </div>
              )}
            </div>

            {/* Refresh button */}
            {!isRound3 && (
              <button
                id="round-ended-dashboard-refresh-btn"
                className="btn btn-primary"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none', marginRight: 6 }}>↻</span>
                {refreshing ? 'Checking for next round…' : 'Refresh — Load Next Round'}
              </button>
            )}
            {isRound3 && (
              <button
                id="round-ended-dashboard-refresh-btn"
                className="btn btn-secondary"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none', marginRight: 6 }}>↻</span>
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            )}
          </div>
        )}

        {/* No round yet */}
        {(!currentRound || currentRound.status === 'UPCOMING') && !isRound2 && !isRound3 && (
          <div className="alert alert-info" style={{ marginTop: 16 }}>
            <div style={{ marginBottom: 12 }}>
              Waiting for the round to start. Stay on this page.
            </div>
            <button
              id="no-round-refresh-btn"
              className="btn btn-primary btn-sm"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <span style={{ display: 'inline-block', animation: refreshing ? 'spin 1s linear infinite' : 'none', marginRight: 6 }}>↻</span>
              {refreshing ? 'Checking for new round…' : 'Refresh Status'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
