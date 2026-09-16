import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useCompetition } from '../../context/CompetitionContext';
import type { Task, Activity } from '../../types';

interface TaskForm {
  title: string;
  description: string;
  correctAnswer: string;
  points: number;
  orderIndex: number;
  timeoutMs: number;
  sampleOutput: string;
  questionBank: number | null;
  starterCode: string;      // CODE_DEBUGGING: buggy code / CODING_SPRINT: function stub
  configJson: string;       // CODE_DEBUGGING: JSON string of [{id, description, fixRegex}]
  testCasesJson: string;    // CODING_SPRINT: JSON string of [{label, driverCode, expectedOutput}]
}

const EMPTY_TASK: TaskForm = {
  title: '', description: '', correctAnswer: '', points: 10, orderIndex: 0, timeoutMs: 5000,
  sampleOutput: '', questionBank: null, starterCode: '', configJson: '', testCasesJson: '',
};

interface TaskWithAnswer extends Task {
  correctAnswer?: string;
  starterCode?: string | null;
  config?: Record<string, unknown> | null;
}

export default function TasksAdmin() {
  const { competition } = useCompetition();
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const [tasks, setTasks] = useState<TaskWithAnswer[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<TaskForm>(EMPTY_TASK);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // Get all activities from all rounds
  const allActivities = competition?.rounds.flatMap((r) => r.activities) ?? [];

  const fetchTasks = async (activityId: string) => {
    setLoading(true);
    try {
      const res = await api.getTasksForActivity(activityId);
      if (res.success) {
        // Also fetch full tasks with answers for admin
        const full = await Promise.all(
          (res.data as Task[]).map((t) =>
            api.getTaskAdmin(t.id).then((r) => r.success ? r.data : t).catch(() => t)
          )
        );
        setTasks(full as TaskWithAnswer[]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedActivity) void fetchTasks(selectedActivity.id);
  }, [selectedActivity?.id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedActivity) return;
    setSaving(true);
    try {
      // Parse configJson for CODE_DEBUGGING
      let config: Record<string, unknown> | undefined;
      if (selectedActivity.type === 'CODE_DEBUGGING' && form.configJson.trim()) {
        try {
          const parsed = JSON.parse(form.configJson);
          config = { errors: parsed };
        } catch {
          setMessage('Error Definitions JSON is invalid. Please fix it and try again.');
          setSaving(false);
          return;
        }
      }
      if (selectedActivity.type === 'CODING_SPRINT' && form.testCasesJson.trim()) {
        try {
          const parsed = JSON.parse(form.testCasesJson);
          config = { testCases: parsed };
        } catch {
          setMessage('Test Cases JSON is invalid. Please fix it and try again.');
          setSaving(false);
          return;
        }
      }
      const payload = {
        title: form.title,
        description: form.description,
        // correctAnswer not needed for CODE_DEBUGGING (uses configJson/fixRegex) or CODING_SPRINT (uses test cases)
        correctAnswer: (selectedActivity.type === 'CODE_DEBUGGING' || selectedActivity.type === 'CODING_SPRINT')
          ? undefined
          : (form.correctAnswer || undefined),
        points: form.points,
        orderIndex: form.orderIndex,
        timeoutMs: form.timeoutMs,
        sampleOutput: form.sampleOutput || undefined,
        questionBank: form.questionBank,
        // starterCode: CODE_DEBUGGING = buggy code, CODING_SPRINT = function stub shown to participant
        starterCode: (selectedActivity.type === 'CODE_DEBUGGING' || selectedActivity.type === 'CODING_SPRINT')
          ? (form.starterCode || undefined)
          : undefined,
        config: config,
      };
      if (editingId) {
        await api.updateTask(editingId, payload);
        setMessage('Task updated.');
      } else {
        await api.createTask({ ...payload, activityId: selectedActivity.id });
        setMessage('Task created.');
      }
      setForm(EMPTY_TASK);
      setShowCreate(false);
      setEditingId(null);
      await fetchTasks(selectedActivity.id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setMessage(e.response?.data?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (task: TaskWithAnswer) => {
    // Try to parse stored config JSON for display
    let configJson = '';
    if (task.config?.errors) {
      try { configJson = JSON.stringify(task.config.errors, null, 2); } catch { configJson = ''; }
    }
    let testCasesJson = '';
    if (task.config?.testCases) {
      try { testCasesJson = JSON.stringify(task.config.testCases, null, 2); } catch { testCasesJson = ''; }
    }
    setForm({
      title: task.title,
      description: task.description,
      correctAnswer: task.correctAnswer ?? '',
      points: task.points,
      orderIndex: task.orderIndex,
      timeoutMs: task.timeoutMs,
      sampleOutput: task.sampleOutput ?? '',
      questionBank: (task as TaskWithAnswer & { questionBank?: number | null }).questionBank ?? null,
      starterCode: task.starterCode ?? '',
      configJson,
      testCasesJson,
    });
    setEditingId(task.id);
    setShowCreate(true);
  };

  const handleDelete = async (taskId: string) => {
    if (!confirm('Are you sure you want to delete this task? This action cannot be undone.')) return;
    try {
      await api.deleteTask(taskId);
      setMessage('Task deleted.');
      if (selectedActivity) await fetchTasks(selectedActivity.id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setMessage(e.response?.data?.message ?? 'Failed to delete task');
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Task Management</h1>
        <p className="page-subtitle">Configure Dumb Charades questions and other activity tasks</p>
      </div>

      {message && (
        <div className="alert alert-info" style={{ marginBottom: '16px' }}>
          {message}
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setMessage('')}>✕</button>
        </div>
      )}

      {/* Activity selector */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Select Activity</label>
          <select
            className="form-select"
            value={selectedActivity?.id ?? ''}
            onChange={(e) => {
              const act = allActivities.find((a) => a.id === e.target.value);
              setSelectedActivity(act ?? null);
              setTasks([]);
              setShowCreate(false);
            }}
          >
            <option value="">Choose an activity...</option>
            {allActivities.map((a) => (
              <option key={a.id} value={a.id}>
                {competition?.rounds.find((r) => r.id === a.roundId)?.name} — {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedActivity && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              {selectedActivity.name} Tasks ({tasks.length})
            </h3>
            {!showCreate && (
              <button className="btn btn-primary btn-sm" onClick={() => { setShowCreate(true); setEditingId(null); setForm({ ...EMPTY_TASK, orderIndex: tasks.length }); }}>
                + Add Task
              </button>
            )}
          </div>

          {/* Task form */}
          {showCreate && (
            <div className="card" style={{ marginBottom: '20px' }}>
              <h3 className="card-title" style={{ marginBottom: '16px' }}>
                {editingId ? 'Edit Task' : 'New Task'}
              </h3>
              <form onSubmit={(e) => void handleSave(e)}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div className="form-group">
                    <label className="form-label">Title *</label>
                    <input className="form-input" value={form.title}
                      onChange={(e) => setForm({ ...form, title: e.target.value })} required />
                  </div>
                  {/* Correct Answer: not shown for CODE_DEBUGGING (uses error regex) or CODING_SPRINT (uses test cases) */}
                  {selectedActivity.type !== 'CODE_DEBUGGING' && selectedActivity.type !== 'CODING_SPRINT' && (
                  <div className="form-group">
                    <label className="form-label">Correct Answer (lowercase) *</label>
                    <input className="form-input" value={form.correctAnswer}
                      onChange={(e) => setForm({ ...form, correctAnswer: e.target.value })}
                      placeholder="e.g. 3 idiots"
                      required />
                    <p className="form-hint">Stored as-is. Participants are instructed to use lowercase.</p>
                  </div>
                  )}
                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label className="form-label">Description (shown to participant) *</label>
                    <textarea className="form-textarea" value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })} required />
                    <p className="form-hint">Instructions shown in the problem panel. Do not include the answer here.</p>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Points</label>
                    <input className="form-input" type="number" value={form.points}
                      onChange={(e) => setForm({ ...form, points: Number(e.target.value) })} min={0} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Order Index</label>
                    <input className="form-input" type="number" value={form.orderIndex}
                      onChange={(e) => setForm({ ...form, orderIndex: Number(e.target.value) })} min={0} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Timeout (ms)</label>
                    <input className="form-input" type="number" value={form.timeoutMs}
                      onChange={(e) => setForm({ ...form, timeoutMs: Number(e.target.value) })} min={500} max={10000} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Sample Output Hint (optional)</label>
                    <input className="form-input" value={form.sampleOutput}
                      onChange={(e) => setForm({ ...form, sampleOutput: e.target.value })}
                      placeholder="Shown to participant as format hint, NOT the answer" />
                  </div>
                  {selectedActivity.type === 'DUMB_CHARADES' && (
                    <div className="form-group">
                      <label className="form-label">Question Bank *</label>
                      <select
                        className="form-select"
                        value={form.questionBank ?? ''}
                        onChange={(e) => setForm({ ...form, questionBank: e.target.value ? Number(e.target.value) : null })}
                        required
                      >
                        <option value="">-- Select Bank --</option>
                        <option value="1">Bank 1</option>
                        <option value="2">Bank 2</option>
                        <option value="3">Bank 3</option>
                      </select>
                      <p className="form-hint">Each bank has 5 questions. Teams are assigned a specific bank.</p>
                    </div>
                  )}
                  {selectedActivity.type === 'CODE_DEBUGGING' && (
                    <>
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <label className="form-label">Buggy Starter Code * <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(pre-filled in participant editor)</span></label>
                        <textarea
                          className="form-textarea"
                          value={form.starterCode}
                          onChange={(e) => setForm({ ...form, starterCode: e.target.value })}
                          rows={10}
                          style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8125rem' }}
                          placeholder="#include <stdio.h>&#10;// Paste the buggy C code here — this is what participants will see"
                          required
                        />
                        <p className="form-hint">This code is pre-loaded in the participant's editor. It should contain exactly 10 intentional bugs.</p>
                      </div>
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <label className="form-label">Correct Code * <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(used for evaluation — never shown to participants)</span></label>
                        <textarea
                          className="form-textarea"
                          value={form.correctAnswer}
                          onChange={(e) => setForm({ ...form, correctAnswer: e.target.value })}
                          rows={10}
                          style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8125rem' }}
                          placeholder="#include <stdio.h>&#10;// Paste the fully corrected C code here"
                          required
                        />
                        <p className="form-hint">Stored securely. Never sent to the client. Used to verify fixes.</p>
                      </div>
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <label className="form-label" style={{ margin: 0 }}>Error Definitions JSON * <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(10 errors, each with a fixRegex)</span></label>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setForm({ ...form, configJson: JSON.stringify(
                              Array.from({ length: 10 }, (_, i) => ({
                                id: i + 1,
                                description: `Error ${i + 1}: describe what was wrong`,
                                fixRegex: `pattern_that_must_exist_in_fixed_code_${i + 1}`,
                              })), null, 2
                            )})}
                          >
                            Insert Template
                          </button>
                        </div>
                        <textarea
                          className="form-textarea"
                          value={form.configJson}
                          onChange={(e) => setForm({ ...form, configJson: e.target.value })}
                          rows={14}
                          style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8125rem' }}
                          placeholder='[{"id":1,"description":"Missing semicolon","fixRegex":"return\\s*0\\s*;"},...]'
                          required
                        />
                        <p className="form-hint">
                          Each error needs: <code>id</code> (1–10), <code>description</code> (admin label), <code>fixRegex</code> (JS regex that must match in the fixed code).
                          The regex uses <code>ms</code> flags (multiline + dotAll). Test your regex before saving.
                        </p>
                      </div>
                    </>
                  )}
                  {selectedActivity.type === 'CODING_SPRINT' && (
                    <>
                      {/* Starter Code: function stub shown to participant */}
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <label className="form-label">
                          Function Stub (Starter Code){' '}
                          <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(shown in participant editor — they fill in the function body)</span>
                        </label>
                        <textarea
                          className="form-textarea"
                          value={form.starterCode}
                          onChange={(e) => setForm({ ...form, starterCode: e.target.value })}
                          rows={6}
                          style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8125rem' }}
                          placeholder={`// Example:\nint solution(int a, int b) {\n    // Write your code here\n    \n}`}
                        />
                        <p className="form-hint">
                          Participants write <strong>only the function body</strong> — no <code>main()</code>, no <code>#include</code>.
                          The hidden driver code provides the includes and the main.
                        </p>
                      </div>

                      {/* Test Cases with driver code */}
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <label className="form-label" style={{ margin: 0 }}>Test Cases JSON *{' '}<span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(2–3 test cases with hidden driver)</span></label>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setForm({ ...form, testCasesJson: JSON.stringify([
                              {
                                label: 'Test Case 1 — Basic',
                                driverCode: '#include <stdio.h>\nint main() {\n    printf("%d\\n", solution(5, 3));\n    return 0;\n}',
                                expectedOutput: '8',
                              },
                              {
                                label: 'Test Case 2 — Edge: zeros',
                                driverCode: '#include <stdio.h>\nint main() {\n    printf("%d\\n", solution(0, 0));\n    return 0;\n}',
                                expectedOutput: '0',
                              },
                              {
                                label: 'Test Case 3 — Negative',
                                driverCode: '#include <stdio.h>\nint main() {\n    printf("%d\\n", solution(-3, 7));\n    return 0;\n}',
                                expectedOutput: '4',
                              },
                            ], null, 2)})}
                          >
                            Insert Template
                          </button>
                        </div>
                        <textarea
                          className="form-textarea"
                          value={form.testCasesJson}
                          onChange={(e) => setForm({ ...form, testCasesJson: e.target.value })}
                          rows={18}
                          style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.8125rem' }}
                          placeholder='[{"label":"Test Case 1","driverCode":"#include <stdio.h>\nint main(){printf(\"%d\\n\",solution(5,3));return 0;}","expectedOutput":"8"}]'
                          required
                        />
                        <p className="form-hint">
                          Each test case needs: <code>label</code> (display name), <code>driverCode</code> (hidden <code>main()</code> that calls the participant&apos;s function and prints output),
                          <code>expectedOutput</code> (exact stdout, trimmed). The driver is concatenated with participant code at compile time — participant never sees it.
                          Legacy <code>input</code>/<code>stdin</code> mode still works if you omit <code>driverCode</code>.
                        </p>
                      </div>
                    </>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Task'}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => { setShowCreate(false); setEditingId(null); }}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Tasks list */}
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Title</th>
                  <th>Bank</th>
                  <th>Answer</th>
                  <th>Points</th>
                  <th>Timeout</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '24px' }}>
                    <div className="spinner" style={{ margin: '0 auto' }} />
                  </td></tr>
                ) : tasks.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                    No tasks configured. Add one above.
                  </td></tr>
                ) : tasks.map((task) => (
                  <tr key={task.id}>
                    <td style={{ fontWeight: 600 }}>{task.orderIndex + 1}</td>
                    <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{task.title}</td>
                    <td>
                      {selectedActivity.type === 'DUMB_CHARADES' ? (
                        <span className={`badge ${ (task as TaskWithAnswer & { questionBank?: number | null }).questionBank ? 'badge-info' : 'badge-muted' }`}>
                          {(task as TaskWithAnswer & { questionBank?: number | null }).questionBank
                            ? `Bank ${(task as TaskWithAnswer & { questionBank?: number | null }).questionBank}`
                            : '—'}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="mono" style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                      {task.correctAnswer ?? '—'}
                    </td>
                    <td>{task.points}</td>
                    <td>{task.timeoutMs}ms</td>
                    <td>
                      <span className={`badge ${task.isActive ? 'badge-success' : 'badge-muted'}`}>
                        {task.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => startEdit(task)}>
                          Edit
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => void handleDelete(task.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
