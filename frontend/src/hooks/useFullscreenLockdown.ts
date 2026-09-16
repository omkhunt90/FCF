import { useState, useEffect, useRef, useCallback } from 'react';

interface UseFullscreenOptions {
  enabled: boolean;
  onFocusLost?: () => void;
}

interface UseFullscreenReturn {
  isFullscreen: boolean;
  focusLost: boolean;
  focusLostCount: number;
  requestFullscreen: () => void;
}

export function useFullscreenLockdown({
  enabled,
  onFocusLost,
}: UseFullscreenOptions): UseFullscreenReturn {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [focusLost, setFocusLost] = useState(false);
  const [focusLostCount, setFocusLostCount] = useState(0);
  const focusWarningTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastViolationTimeRef = useRef<number>(0);
  const hasPendingReturnWarningRef = useRef<boolean>(false);
  const focusLostRef = useRef<boolean>(false);
  focusLostRef.current = focusLost;

  const onFocusLostRef = useRef(onFocusLost);
  useEffect(() => {
    onFocusLostRef.current = onFocusLost;
  });

  const requestFullscreen = useCallback(() => {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      void el.requestFullscreen();
    } else if ((el as unknown as { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen) {
      (el as unknown as { webkitRequestFullscreen: () => void }).webkitRequestFullscreen();
    }
  }, []);

  const showWarningFor2Seconds = useCallback(() => {
    setFocusLost(true);
    if (focusWarningTimer.current) clearTimeout(focusWarningTimer.current);
    focusWarningTimer.current = setTimeout(() => {
      setFocusLost(false);
      focusWarningTimer.current = null;
    }, 2000);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const triggerViolation = () => {
      const now = Date.now();
      // Debounce duplicate events firing in quick succession (e.g. blur + visibilitychange + fullscreenchange)
      if (now - lastViolationTimeRef.current < 1000) {
        return;
      }
      lastViolationTimeRef.current = now;
      hasPendingReturnWarningRef.current = true;
      setFocusLostCount((c) => c + 1);
      onFocusLostRef.current?.();
      showWarningFor2Seconds();
    };

    const handleFullscreenChange = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
      if (!fs) {
        triggerViolation();
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        triggerViolation();
      } else {
        // When participant returns to the window, show warning in their UI for 2 seconds
        if (hasPendingReturnWarningRef.current || focusLostRef.current) {
          hasPendingReturnWarningRef.current = false;
          showWarningFor2Seconds();
        }
      }
    };

    const handleBlur = () => {
      triggerViolation();
    };

    const handleFocus = () => {
      // When participant returns to the window, show warning in their UI for 2 seconds
      if (hasPendingReturnWarningRef.current || focusLostRef.current) {
        hasPendingReturnWarningRef.current = false;
        showWarningFor2Seconds();
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);

    // Check current fullscreen state
    setIsFullscreen(!!document.fullscreenElement);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      if (focusWarningTimer.current) {
        clearTimeout(focusWarningTimer.current);
        focusWarningTimer.current = null;
      }
    };
  }, [enabled, showWarningFor2Seconds]);

  return { isFullscreen, focusLost, focusLostCount, requestFullscreen };
}
