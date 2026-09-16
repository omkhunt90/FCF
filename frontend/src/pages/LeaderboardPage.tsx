/**
 * LeaderboardPage — tabbed leaderboard showing per-activity and per-round rankings.
 * All participants shown (no top-10 limit). Auto-refreshes every 15s.
 * Accessible to both admin (/admin/leaderboard) and participant (/participant/leaderboard).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useCompetition } from '../context/CompetitionContext';
import type { LBRow, Activity, Round } from '../types';


// ─── Types ───────────────────────────────────────────────────────────────────

interface LBData {
  data: LBRow[];
  scope: string;
  scopeName: string;
  updatedAt: number;
}

type TabKey = 'overall' | `round-${string}` | `activity-${string}`;

interface Tab {
  key: TabKey;
  label: string;
  sublabel?: string;
  fetchFn: () => Promise<LBData>;
}

// ─── Medal helpers ────────────────────────────────────────────────────────────

function medal(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

function rankColor(rank: number): string {
  if (rank === 1) return 'var(--color-gold, #f59e0b)';
  if (rank === 2) return 'var(--color-silver, #94a3b8)';
  if (rank === 3) return 'var(--color-bronze, #b45309)';
  return 'var(--text-secondary)';
}

function formatTs(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ─── Leaderboard Table ────────────────────────────────────────────────────────

interface LBTableProps {
  rows: LBRow[];
  highlightId?: string; // current participant's id
}

function LBTable({ rows, highlightId }: LBTableProps) {
  if (rows.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: '2rem', marginBottom: 8 }}>📊</div>
        <div>No submissions yet. Rankings will appear once participants start.</div>
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
            <th style={thStyle}>Rank</th>
            <th style={{ ...thStyle, textAlign: 'left' }}>Team / Participant</th>
            <th style={thStyle}>Score</th>
            <th style={thStyle}>Solved</th>
            <th style={thStyle}>Attempts</th>
            <th style={thStyle}>Last Correct</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const isHighlighted = row.participantId === highlightId;
            return (
              <tr
                key={row.participantId}
                style={{
                  borderBottom: '1px solid var(--border-color)',
                  background: isHighlighted
                    ? 'rgba(99,102,241,0.08)'
                    : row.rank <= 3 ? `rgba(${row.rank === 1 ? '245,158,11' : row.rank === 2 ? '148,163,184' : '180,83,9'},0.06)` : 'transparent',
                  transition: 'background 0.2s',
                }}
              >
                <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700, color: rankColor(row.rank), fontSize: '1.1rem', minWidth: 56 }}>
                  {medal(row.rank)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'left' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9375rem' }}>
                    {row.displayName}
                    {isHighlighted && (
                      <span style={{ marginLeft: 6, fontSize: '0.7rem', background: 'var(--color-primary)', color: '#fff', borderRadius: 4, padding: '1px 6px' }}>You</span>
                    )}
                  </div>
                  {row.teamName && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{row.teamName}</div>
                  )}
                </td>
                <td style={{ ...tdStyle, fontWeight: 700, fontSize: '1.125rem', color: row.totalScore > 0 ? 'var(--color-success, #22c55e)' : 'var(--text-muted)' }}>
                  {row.totalScore}
                </td>
                <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>
                  {row.acceptedCount > 0 ? (
                    <span style={{ color: 'var(--color-success, #22c55e)', fontWeight: 600 }}>{row.acceptedCount}</span>
                  ) : '0'}
                </td>
                <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                  {row.totalAttempts}
                </td>
                <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: '0.8125rem', fontFamily: 'monospace' }}>
                  {formatTs(row.lastAcceptedAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '10px 14px',
  textAlign: 'center',
  fontSize: '0.75rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-muted)',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 14px',
  textAlign: 'center',
  verticalAlign: 'middle',
};

// ─── Main Page ────────────────────────────────────────────────────────────────

interface LeaderboardPageProps {
  participantId?: string; // optional override; auto-detected from auth context if not set
}

export default function LeaderboardPage({ participantId: _unused }: LeaderboardPageProps) {
  const { competition } = useCompetition();

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('overall');
  const [lbData, setLbData] = useState<LBData | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  // Build tabs from competition structure
  useEffect(() => {
    const t: Tab[] = [
      {
        key: 'overall',
        label: '🏆 Overall',
        fetchFn: async () => {
          const res = await api.getLeaderboard();
          return { data: res.data ?? [], scope: 'overall', scopeName: 'Overall', updatedAt: res.updatedAt ?? Date.now() };
        },
      },
    ];

    const rounds: Round[] = competition?.rounds ?? [];
    for (const round of rounds) {
      t.push({
        key: `round-${round.id}`,
        label: `📋 ${round.name}`,
        sublabel: 'Round total',
        fetchFn: async () => {
          const res = await api.getRoundLeaderboard(round.id);
          return { data: res.data ?? [], scope: 'round', scopeName: res.scopeName ?? round.name, updatedAt: res.updatedAt ?? Date.now() };
        },
      });

      for (const activity of (round.activities ?? []) as Activity[]) {
        const icon = activity.type === 'DUMB_CHARADES' ? '🎭' : activity.type === 'BLIND_CODING' ? '💻' : activity.type === 'CODE_DEBUGGING' ? '🐛' : '📝';
        t.push({
          key: `activity-${activity.id}`,
          label: `${icon} ${activity.name}`,
          sublabel: round.name,
          fetchFn: async () => {
            const res = await api.getActivityLeaderboard(activity.id);
            return { data: res.data ?? [], scope: 'activity', scopeName: res.scopeName ?? activity.name, updatedAt: res.updatedAt ?? Date.now() };
          },
        });
      }
    }

    setTabs(t);
  }, [competition]);

  const fetchActive = useCallback(async () => {
    const tab = tabs.find(t => t.key === activeTab);
    if (!tab) return;
    setLoading(true);
    try {
      const result = await tab.fetchFn();
      setLbData(result);
      setUpdatedAt(result.updatedAt);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [tabs, activeTab]);

  // Fetch on tab change + auto-refresh every 15s
  useEffect(() => {
    void fetchActive();
    const id = setInterval(() => void fetchActive(), 15_000);
    return () => clearInterval(id);
  }, [fetchActive]);

  const activeTabObj = tabs.find(t => t.key === activeTab);

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title">Leaderboard</h1>
          <p className="page-subtitle">
            {activeTabObj?.label ?? 'All Participants'} — {lbData?.data.length ?? 0} teams ranked
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {updatedAt && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Updated {new Date(updatedAt).toLocaleTimeString()}
            </span>
          )}
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => void fetchActive()}
            disabled={loading}
            id="lb-refresh-btn"
          >
            {loading ? '⟳ Refreshing…' : '⟳ Refresh'}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex',
        gap: 4,
        flexWrap: 'wrap',
        marginBottom: 24,
        borderBottom: '2px solid var(--border-color)',
        paddingBottom: 0,
      }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            id={`lb-tab-${tab.key}`}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '8px 16px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontWeight: activeTab === tab.key ? 700 : 400,
              color: activeTab === tab.key ? 'var(--color-primary)' : 'var(--text-secondary)',
              borderBottom: activeTab === tab.key ? '2px solid var(--color-primary)' : '2px solid transparent',
              marginBottom: -2,
              fontSize: '0.875rem',
              whiteSpace: 'nowrap',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              transition: 'color 0.15s',
            }}
          >
            <span>{tab.label}</span>
            {tab.sublabel && (
              <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontWeight: 400 }}>{tab.sublabel}</span>
            )}
          </button>
        ))}
      </div>

      {/* Leaderboard table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading && !lbData ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
            <span className="spinner" style={{ width: 32, height: 32 }} />
          </div>
        ) : (
          <LBTable rows={lbData?.data ?? []} />
        )}
      </div>

      <p style={{ textAlign: 'center', marginTop: 16, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        Auto-refreshes every 15 seconds · Tie-broken by earliest correct submission
      </p>
    </div>
  );
}
