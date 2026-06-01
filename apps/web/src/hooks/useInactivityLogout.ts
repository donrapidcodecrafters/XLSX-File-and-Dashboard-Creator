import { useCallback, useEffect, useRef, useState } from "react";

// Events that count as user activity
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "mousemove", "mousedown", "click", "keydown", "scroll", "touchstart", "wheel",
];

interface Options {
  /** Session TTL in hours — auto-logout fires after this much inactivity */
  ttlHours: number;
  /** Called when inactivity timeout expires — should call logout + update auth state */
  onTimeout: () => void;
  /** Whether to run — pass false when user is not logged in */
  enabled: boolean;
}

/** Minutes before timeout at which to show a warning */
const WARN_MINUTES_BEFORE = 2;

export function useInactivityLogout({ ttlHours, onTimeout, enabled }: Options) {
  const timeoutMs = ttlHours * 60 * 60 * 1000;
  const warnMs    = WARN_MINUTES_BEFORE * 60 * 1000;

  const logoutTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showWarning, setShowWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(WARN_MINUTES_BEFORE * 60);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (logoutTimer.current)  { clearTimeout(logoutTimer.current);  logoutTimer.current  = null; }
    if (warnTimer.current)    { clearTimeout(warnTimer.current);     warnTimer.current    = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  }, []);

  const resetTimers = useCallback(() => {
    if (!enabled) return;
    clearTimers();
    setShowWarning(false);

    // Warning fires (ttlHours - 2 min) after last activity
    warnTimer.current = setTimeout(() => {
      setShowWarning(true);
      setSecondsLeft(WARN_MINUTES_BEFORE * 60);
      // Countdown tick every second
      countdownRef.current = setInterval(() => {
        setSecondsLeft((s) => Math.max(0, s - 1));
      }, 1000);
    }, Math.max(0, timeoutMs - warnMs));

    // Logout fires ttlHours after last activity
    logoutTimer.current = setTimeout(() => {
      clearTimers();
      setShowWarning(false);
      onTimeout();
    }, timeoutMs);
  }, [enabled, timeoutMs, warnMs, clearTimers, onTimeout]);

  // Start timers when enabled, reset on activity events
  useEffect(() => {
    if (!enabled) {
      clearTimers();
      setShowWarning(false);
      return;
    }

    resetTimers();

    const handleActivity = () => {
      if (showWarning) return; // if warning is showing, user must click "Stay signed in"
      resetTimers();
    };

    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, handleActivity, { passive: true }));
    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, handleActivity));
      clearTimers();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ttlHours]);

  const staySignedIn = useCallback(() => {
    setShowWarning(false);
    resetTimers();
  }, [resetTimers]);

  return { showWarning, secondsLeft, staySignedIn };
}
