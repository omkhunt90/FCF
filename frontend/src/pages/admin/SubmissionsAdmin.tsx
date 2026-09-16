import React, { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { useTheme } from '../../context/ThemeContext';
import { api } from '../../api/client';
import type { Submission, DebugDiffResult } from '../../types';

interface SubmissionAdmin extends Omit<Submission, 'taskId'> {
  id: string;
  taskId?: string | null;
  participant?: { displayName: string; teamName: string | null };
  task?: { title: string; points: number };
  sourceCode?: string;
  compileError?: string;
  stdout?: string;
  stderr?: string;
  compilerResult?: Record<string, unknown>;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    ACCEPTED: 'badge-success', WRONG_ANSWER: 'badge-error',
    COMPILE_ERROR: 'badge-error', RUNTIME_ERROR: 'badge-error',
    TIME_LIMIT_EXCEEDED: 'badge-warning', MEMORY_LIMIT_EXCEEDED: 'badge-warning',
    SYSTEM_ERROR: 'badge-error', PENDING: 'badge-muted',
  };
  return map[status] ?? 'badge-muted';
}

export default function SubmissionsAdmin() {
  const { theme } = useTheme();
  const [submissions, setSubmissions] = useState<SubmissionAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionAdmin | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  // Debug result state for CODE_DEBUGGING submissions
  const [debugResult, setDebugResult] = useState<DebugDiffResult | null>(null);
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [loadingDebug, setLoadingDebug] = useState(false);

  useEffect(() => {
    api.getAllSubmissions()
      .then((res) => { if (res.success) setSubmissions(res.data as SubmissionAdmin[]); })
      .finally(() => setLoading(false));
  }, []);

  const handleViewCode = async (submission: SubmissionAdmin) => {
    setLoadingDetails(true);
    setShowModal(true);
    try {
      const res = await api.getSubmissionAdmin(submission.id);
      if (res.success && res.data) {
        setSelectedSubmission(res.data as SubmissionAdmin);
      }
    } catch {
      setSelectedSubmission(submission);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleViewDebugResult = async (submission: SubmissionAdmin) => {
    setLoadingDebug(true);
    setShowDebugModal(true);
    setDebugResult(null);
    try {
      const res = await api.getDebugResult(submission.id);
      if (res.success && res.data) {
        setDebugResult(res.data as DebugDiffResult);
      }
    } catch {
      setDebugResult(null);
    } finally {
      setLoadingDebug(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Submissions</h1>
        <p className="page-subtitle">All participant code submissions</p>
      </div>

      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Participant</th>
              <th>Task</th>
              <th>Attempt #</th>
              <th>Status</th>
              <th>Score</th>
              <th>Time (ms)</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '24px' }}>
                <div className="spinner" style={{ margin: '0 auto' }} />
              </td></tr>
            ) : submissions.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                No submissions yet.
              </td></tr>
            ) : submissions.map((s) => (
              <tr key={s.id}>
                <td style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                  {new Date(s.submittedAt).toLocaleTimeString()}
                </td>
                <td>
                  <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                    {s.participant?.displayName ?? '—'}
                  </div>
                  {s.participant?.teamName && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{s.participant.teamName}</div>
                  )}
                </td>
                <td>{s.task?.title ?? '—'}</td>
                <td>#{s.attemptNumber}</td>
                <td><span className={`badge ${statusBadge(s.status)}`}>{s.status}</span></td>
                <td style={{ fontWeight: 600, color: s.isCorrect ? 'var(--color-success)' : 'var(--text-muted)' }}>
                  {s.isCorrect ? `+${s.score ?? 0}` : (s.score && s.score > 0 ? `+${s.score}` : '0')}
                  {(s.score != null && s.score > 0 && !s.isCorrect) && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 4 }}>(partial)</span>
                  )}
                </td>
                <td>{s.executionTimeMs != null ? `${s.executionTimeMs}ms` : '—'}</td>
                <td>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => void handleViewCode(s)}
                    >
                      View Code
                    </button>
                    {/* Show Debug Result button only for submissions with debug data */}
                    {s.compilerResult && (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => void handleViewDebugResult(s)}
                        style={{ background: 'var(--color-warning, #f59e0b)', borderColor: 'var(--color-warning, #f59e0b)' }}
                      >
                        🐛 Debug Result
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Code View Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '800px', height: '80vh', display: 'flex', flexDirection: 'column' }}
          >
            <div className="modal-header">
              <h3>
                {loadingDetails ? 'Loading...' : `${selectedSubmission?.participant?.displayName ?? 'Unknown'} — ${selectedSubmission?.task?.title ?? 'Task'}`}
              </h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {loadingDetails ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
                  <div className="spinner" />
                </div>
              ) : selectedSubmission ? (
                <>
                  {/* Status info */}
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <span className={`badge ${statusBadge(selectedSubmission.status)}`}>
                      {selectedSubmission.status}
                    </span>
                    <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                      Attempt #{selectedSubmission.attemptNumber}
                    </span>
                    {selectedSubmission.executionTimeMs != null && (
                      <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                        {selectedSubmission.executionTimeMs}ms
                      </span>
                    )}
                  </div>

                  {/* Source code */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                      SOURCE CODE
                    </div>
                    <div style={{ flex: 1, border: '1px solid var(--border-color)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                      <Editor
                        height="100%"
                        language="c"
                        theme={theme === 'dark' ? 'vs-dark' : 'vs'}
                        value={selectedSubmission.sourceCode ?? '// No source code available'}
                        options={{
                          readOnly: true,
                          fontSize: 13,
                          fontFamily: "'JetBrains Mono', monospace",
                          minimap: { enabled: false },
                          scrollBeyondLastLine: false,
                          wordWrap: 'on',
                          automaticLayout: true,
                        }}
                      />
                    </div>
                  </div>

                  {/* Output */}
                  {(selectedSubmission.stdout || selectedSubmission.stderr || selectedSubmission.compileError) && (
                    <div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                        OUTPUT
                      </div>
                      <pre style={{
                        padding: '12px',
                        background: 'var(--bg-surface-2)',
                        borderRadius: 'var(--radius)',
                        fontSize: '0.8125rem',
                        fontFamily: "'JetBrains Mono', monospace",
                        overflow: 'auto',
                        maxHeight: '150px',
                        margin: 0,
                        color: selectedSubmission.compileError || selectedSubmission.stderr ? 'var(--color-error)' : 'var(--text-primary)',
                      }}>
                        {selectedSubmission.compileError && `Compile Error:\n${selectedSubmission.compileError}\n\n`}
                        {selectedSubmission.stderr && `Runtime Error:\n${selectedSubmission.stderr}\n\n`}
                        {selectedSubmission.stdout && `Output:\n${selectedSubmission.stdout}`}
                      </pre>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Debug Result Modal — CODE_DEBUGGING per-error breakdown */}
      {showDebugModal && (
        <div className="modal-overlay" onClick={() => setShowDebugModal(false)}>
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '700px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
          >
            <div className="modal-header">
              <h3>
                {loadingDebug ? 'Loading…' : `🐛 Debug Result — ${debugResult?.participantName ?? 'Unknown'}`}
              </h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowDebugModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {loadingDebug ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}>
                  <div className="spinner" />
                </div>
              ) : debugResult ? (
                <>
                  {/* Summary */}
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'stretch', flexWrap: 'wrap' }}>
                    <div style={{
                      flex: 1, minWidth: 140, padding: '16px', borderRadius: 'var(--radius)',
                      background: 'var(--bg-surface-2)', textAlign: 'center', border: '1px solid var(--border-color)'
                    }}>
                      <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                        {debugResult.debugResult?.fixedCount ?? 0} / {debugResult.debugResult?.errorsChecked.length ?? 10}
                      </div>
                      <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 4 }}>Errors Fixed</div>
                    </div>
                    <div style={{
                      flex: 1, minWidth: 140, padding: '16px', borderRadius: 'var(--radius)',
                      background: 'var(--bg-surface-2)', textAlign: 'center', border: '1px solid var(--border-color)'
                    }}>
                      <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-success, #22c55e)' }}>
                        {debugResult.totalScore}
                      </div>
                      <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 4 }}>Total Score</div>
                    </div>
                    <div style={{
                      flex: 1, minWidth: 140, padding: '16px', borderRadius: 'var(--radius)',
                      background: 'var(--bg-surface-2)', textAlign: 'center', border: '1px solid var(--border-color)'
                    }}>
                      <div style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Attempt #{debugResult.attemptNumber}
                      </div>
                      <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 4 }}>
                        {new Date(debugResult.submittedAt).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>

                  {/* Per-error table */}
                  {debugResult.debugResult?.errorsChecked && (
                    <div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        PER-ERROR BREAKDOWN
                      </div>
                      <div className="table-wrapper">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th style={{ width: 48 }}>#</th>
                              <th>Error Description</th>
                              <th style={{ width: 100, textAlign: 'center' }}>Status</th>
                              <th style={{ width: 72, textAlign: 'center' }}>Points</th>
                            </tr>
                          </thead>
                          <tbody>
                            {debugResult.debugResult.errorsChecked.map((err) => (
                              <tr key={err.id}>
                                <td style={{ fontWeight: 600, color: 'var(--text-muted)' }}>#{err.id}</td>
                                <td style={{ color: 'var(--text-primary)' }}>{err.description}</td>
                                <td style={{ textAlign: 'center' }}>
                                  {err.fixed ? (
                                    <span className="badge badge-success">✓ Fixed</span>
                                  ) : (
                                    <span className="badge badge-error">✗ Not Fixed</span>
                                  )}
                                </td>
                                <td style={{ textAlign: 'center', fontWeight: 600,
                                  color: err.fixed ? 'var(--color-success, #22c55e)' : 'var(--text-muted)' }}>
                                  {err.fixed ? '+10' : '0'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {!debugResult.debugResult && (
                    <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px' }}>
                      No debug breakdown available for this submission.
                    </div>
                  )}
                </>
              ) : (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px' }}>
                  Failed to load debug result.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
