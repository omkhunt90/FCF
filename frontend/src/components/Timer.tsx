import React from 'react';

interface TimerProps {
  remainingMs: number | null;
  isPaused?: boolean;
}

function formatTime(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function Timer({ remainingMs, isPaused }: TimerProps) {
  if (remainingMs == null) {
    return <span className="timer">--:--</span>;
  }

  const isWarning = remainingMs > 0 && remainingMs <= 5 * 60 * 1000; // last 5 min
  const isDanger  = remainingMs > 0 && remainingMs <= 60 * 1000;      // last 1 min

  return (
    <span
      className={`timer ${isPaused ? 'timer-warning' : isDanger ? 'timer-danger' : isWarning ? 'timer-warning' : ''}`}
      aria-label={`Time remaining: ${formatTime(remainingMs)}`}
    >
      {remainingMs <= 0 ? 'TIME UP' : isPaused ? `⏸ PAUSED (${formatTime(remainingMs)})` : formatTime(remainingMs)}
    </span>
  );
}
