import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';

interface Participant {
  id: string;
  displayName: string;
  teamName: string | null;
  personalRemainingMs: number | null;
  isFrozen: boolean;
  freezeRemainingMs: number;
  timerOffsetMs: number;
}

interface Props {
  actionLoading: boolean;
  setMessage: (msg: string) => void;
}

function formatMs(ms: number | null): string {
  if (ms == null) return '--:--';
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function Round3PowerPanel({ actionLoading, setMessage }: Props) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(false);
  const [powerLoading, setPowerLoading] = useState<string | null>(null); // participantId being acted on

  const fetchParticipants = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getRound3Participants();
      if (res.success && res.data) {
        setParticipants(res.data as Participant[]);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchParticipants();
    const interval = setInterval(() => void fetchParticipants(), 5000);
    return () => clearInterval(interval);
  }, [fetchParticipants]);

  const applyPower = async (participantId: string, power: 'freeze' | 'time-warp' | 'turbo-boost', label: string) => {
    if (actionLoading || powerLoading) return;
    setPowerLoading(participantId + power);
    try {
      const res = await api.applyRound3Power(participantId, power);
      setMessage(`✅ ${label} applied! ${String(res.message ?? '')}`);
      await fetchParticipants();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setMessage(e.response?.data?.message ?? `Failed to apply ${label}`);
    } finally {
      setPowerLoading(null);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 className="card-title">🎮 Round 3 — Power Cards</h3>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => void fetchParticipants()}
          disabled={loading}
        >
          ↻ Refresh
        </button>
      </div>

      <div style={{ padding: '12px 0' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 16,
          padding: '0 16px',
        }}>
          {participants.map(p => (
            <div
              key={p.id}
              style={{
                border: p.isFrozen ? '2px solid #6366f1' : '1px solid var(--border-color)',
                borderRadius: 10,
                padding: '14px',
                background: p.isFrozen ? 'rgba(99,102,241,0.08)' : 'var(--bg-secondary)',
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>
                    {p.teamName ?? p.displayName}
                  </div>
                  {p.teamName && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.displayName}</div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{
                    fontFamily: 'monospace', fontWeight: 700, fontSize: '1rem',
                    color: (p.personalRemainingMs ?? 0) < 120_000 ? '#ef4444' : 'var(--text-primary)',
                  }}>
                    ⏱ {formatMs(p.personalRemainingMs)}
                  </div>
                  {p.isFrozen && (
                    <div style={{ fontSize: '0.75rem', color: '#818cf8', fontWeight: 600 }}>
                      ⌨️ FROZEN {Math.ceil(p.freezeRemainingMs / 1000)}s
                    </div>
                  )}
                </div>
              </div>

              {/* Power buttons */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-sm"
                  style={{
                    background: '#6366f1', color: '#fff', border: 'none',
                    opacity: p.isFrozen ? 0.5 : 1,
                    fontSize: '0.75rem',
                  }}
                  disabled={!!powerLoading || actionLoading || p.isFrozen}
                  onClick={() => void applyPower(p.id, 'freeze', '⌨️ Keyboard Freeze')}
                  title="Freeze keyboard for 3 minutes"
                >
                  {powerLoading === p.id + 'freeze' ? '⏳' : '⌨️'} Freeze (3 min)
                </button>
                <button
                  className="btn btn-sm"
                  style={{
                    background: '#ef4444', color: '#fff', border: 'none',
                    fontSize: '0.75rem',
                  }}
                  disabled={!!powerLoading || actionLoading}
                  onClick={() => void applyPower(p.id, 'time-warp', '⏪ Time Warp')}
                  title="Subtract 4 minutes from this team's remaining time"
                >
                  {powerLoading === p.id + 'time-warp' ? '⏳' : '⏪'} −4 min
                </button>
                <button
                  className="btn btn-sm"
                  style={{
                    background: '#22c55e', color: '#fff', border: 'none',
                    fontSize: '0.75rem',
                  }}
                  disabled={!!powerLoading || actionLoading}
                  onClick={() => void applyPower(p.id, 'turbo-boost', '🚀 Turbo Boost')}
                  title="Add 4 minutes to this team's remaining time"
                >
                  {powerLoading === p.id + 'turbo-boost' ? '⏳' : '🚀'} +4 min
                </button>
              </div>
            </div>
          ))}
          {participants.length === 0 && !loading && (
            <p style={{ color: 'var(--text-muted)', padding: '12px 0', gridColumn: '1/-1' }}>
              No active participants found.
            </p>
          )}
          {loading && participants.length === 0 && (
            <p style={{ color: 'var(--text-muted)', padding: '12px 0', gridColumn: '1/-1' }}>Loading participants…</p>
          )}
        </div>
      </div>

      <div style={{ padding: '8px 16px 12px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        ⌨️ Keyboard Freeze: disables typing + Run + Submit for 3 minutes for that team only.
        ⏪ Time Warp: subtracts 4 minutes from that team's remaining time.
        🚀 Turbo Boost: adds 4 minutes to that team's remaining time.
      </div>
    </div>
  );
}
