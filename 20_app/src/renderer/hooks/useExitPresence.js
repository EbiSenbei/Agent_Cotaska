import { useCallback, useEffect, useRef, useState } from "react";

const EXIT_PRESENCE_FALLBACK_MS = 200;

function isOwnOpacityTransition(event) {
  return Boolean(
    event
    && event.target === event.currentTarget
    && event.propertyName === "opacity"
  );
}

function useExitPresence(value, fallbackMs = EXIT_PRESENCE_FALLBACK_MS) {
  const [presentValue, setPresentValue] = useState(value);
  const [motionState, setMotionState] = useState(value == null ? "exited" : "entered");
  const presentValueRef = useRef(value);
  const motionStateRef = useRef(value == null ? "exited" : "entered");
  const fallbackTimerRef = useRef(null);

  const clearFallbackTimer = useCallback(() => {
    if (fallbackTimerRef.current == null) return;
    window.clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
  }, []);

  const finishExit = useCallback(() => {
    if (motionStateRef.current !== "exiting") return;
    clearFallbackTimer();
    presentValueRef.current = null;
    motionStateRef.current = "exited";
    setPresentValue(null);
    setMotionState("exited");
  }, [clearFallbackTimer]);

  useEffect(() => {
    if (value != null) {
      clearFallbackTimer();
      presentValueRef.current = value;
      motionStateRef.current = "entered";
      setPresentValue(value);
      setMotionState("entered");
      return;
    }

    if (presentValueRef.current == null) return;
    motionStateRef.current = "exiting";
    setMotionState("exiting");
    clearFallbackTimer();
    fallbackTimerRef.current = window.setTimeout(finishExit, fallbackMs);
  }, [clearFallbackTimer, fallbackMs, finishExit, value]);

  useEffect(() => clearFallbackTimer, [clearFallbackTimer]);

  const handleTransitionEnd = useCallback((event) => {
    if (motionStateRef.current !== "exiting" || !isOwnOpacityTransition(event)) return;
    finishExit();
  }, [finishExit]);

  return {
    presentValue,
    motionState,
    isExiting: motionState === "exiting",
    handleTransitionEnd,
  };
}

export {
  EXIT_PRESENCE_FALLBACK_MS,
  isOwnOpacityTransition,
  useExitPresence,
};
