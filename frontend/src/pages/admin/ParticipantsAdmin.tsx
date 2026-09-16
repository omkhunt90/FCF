import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { Participant } from '../../types';

interface CreateForm {
  username: string;
  password: string;
  displayName: string;
  teamName: string;
}

const EMPTY_FORM: CreateForm = { username: '', password: '', displayName: '', teamName: '' };

export default function ParticipantsAdmin() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchParticipants = async () => {
    setLoading(true);
    try {
      const res = await api.getParticipants();
      if (res.success) setParticipants(res.data as Participant[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchParticipants(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      await api.createParticipant({
        username: form.username.trim(),
        password: form.password,
        displayName: form.displayName.trim(),
        teamName: form.teamName.trim() || undefined,
      });
      setForm(EMPTY_FORM);
      setShowCreate(false);
      await fetchParticipants();
    } catch (err: unknown) {
      const e = err as {
        response?: {
          data?: {
            message?: string;
            errors?: Record<string, string[]>;
          };
        };
      };
      if (e.response?.data?.errors) {
        const errorList = Object.entries(e.response.data.errors)
          .map(([field, msgs]) => `${field}: ${msgs.join(', ')}`)
          .join(' | ');
        setFormError(errorList || e.response.data.message || 'Failed to create participant');
      } else {
        setFormError(e.response?.data?.message ?? 'Failed to create participant');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (p: Participant) => {
    try {
      if (p.isActive) {
        await api.disableParticipant(p.id);
      } else {
        await api.enableParticipant(p.id);
      }
      await fetchParticipants();
    } catch {}
  };

  const handleAssignBank = async (p: Participant, bank: number | null) => {
    try {
      await api.assignQuestionBank(p.id, bank);
      await fetchParticipants();
    } catch {}
  };

  const handleDelete = async (p: Participant) => {
    if (!confirm(`Are you sure you want to permanently remove participant "${p.displayName}" (${p.user.username})?\n\nThis will delete their account, submissions, scores, and logs. This action cannot be undone.`)) {
      return;
    }
    try {
      await api.deleteParticipant(p.id);
      await fetchParticipants();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      alert(e.response?.data?.message ?? 'Failed to delete participant');
    }
  };

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Participants</h1>
          <p className="page-subtitle">Manage competition participants</p>
        </div>
        <button
          id="create-participant-btn"
          className="btn btn-primary"
          onClick={() => setShowCreate(!showCreate)}
        >
          + Add Participant
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <h3 className="card-title" style={{ marginBottom: '16px' }}>New Participant</h3>
          <form onSubmit={(e) => void handleCreate(e)}>
            {formError && <div className="alert alert-error" style={{ marginBottom: '12px' }}>{formError}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Display Name *</label>
                <input className="form-input" value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />
              </div>
              <div className="form-group">
                <label className="form-label">Team Name</label>
                <input className="form-input" value={form.teamName}
                  onChange={(e) => setForm({ ...form, teamName: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Username *</label>
                <input className="form-input" value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })} required />
              </div>
              <div className="form-group">
                <label className="form-label">Password *</label>
                <input className="form-input" type="password" value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={4} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Creating...' : 'Create Participant'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Team</th>
              <th>DC Bank</th>
              <th>Score</th>
              <th>Submissions</th>
              <th>Flags</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '24px' }}>
                <div className="spinner" style={{ margin: '0 auto' }} />
              </td></tr>
            ) : participants.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                No participants yet. Add one above.
              </td></tr>
            ) : participants.map((p) => (
              <tr key={p.id}>
                <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{p.displayName}</td>
                <td className="mono" style={{ fontSize: '0.8125rem' }}>{p.user.username}</td>
                <td>{p.teamName ?? '—'}</td>
                <td>
                  {/* Assign Dumb Charades question bank */}
                  <select
                    className="form-select"
                    style={{ fontSize: '0.8125rem', padding: '2px 6px', minWidth: 90 }}
                    value={p.assignedQuestionBank ?? ''}
                    onChange={(e) => void handleAssignBank(p, e.target.value ? Number(e.target.value) : null)}
                    title="Assign Dumb Charades question bank"
                  >
                    <option value="">None</option>
                    <option value="1">Bank 1</option>
                    <option value="2">Bank 2</option>
                    <option value="3">Bank 3</option>
                  </select>
                </td>
                <td style={{ fontWeight: 600 }}>{p.leaderboardEntry?.totalScore ?? 0}</td>
                <td>{p._count.submissions}</td>
                <td>
                  {p._count.auditEvents > 0 ? (
                    <span className="badge badge-warning">{p._count.auditEvents}</span>
                  ) : '—'}
                </td>
                <td>
                  <span className={`badge ${p.isActive ? 'badge-success' : 'badge-error'}`}>
                    {p.isActive ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <button
                      className={`btn btn-sm ${p.isActive ? 'btn-danger' : 'btn-success'}`}
                      onClick={() => void handleToggle(p)}
                      title={p.isActive ? 'Disable participant login' : 'Enable participant login'}
                    >
                      {p.isActive ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      style={{ color: 'var(--color-error, #ef4444)', border: '1px solid var(--border-color)' }}
                      onClick={() => void handleDelete(p)}
                      title="Remove participant permanently"
                    >
                      🗑 Remove
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
