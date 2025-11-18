// useUndoRedo.ts
import { useCallback, useRef, useState } from "react";

export type HistoryState<T> = {
  past: T[];
  present: T;
  future: T[];
};

export default function useUndoRedo<T>(initialState: T) {
  const [history, setHistory] = useState<HistoryState<T>>({
    past: [],
    present: initialState,
    future: [],
  });

  const pointerRef = useRef<number>(history.past.length);
  const lastSavedState = useRef<T>(initialState);

  // helpers
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  // internal: replace history with a new object (used rarely)
  const replaceHistory = useCallback((next: HistoryState<T>) => {
    pointerRef.current = next.past.length;
    setHistory(next);
  }, []);

  // setState: push current present into past and set new present (clears future)
  const setState = useCallback((newState: T | ((prev: T) => T)) => {
    setHistory((current) => {
      const resolved = typeof newState === "function" ? (newState as (prev: T) => T)(current.present) : newState;
      // if identical, no-op
      if (JSON.stringify(resolved) === JSON.stringify(current.present)) {
        return current;
      }
      console.debug('[useUndoRedo] setState -> push present into past, pastLen ->', current.past.length + 1);
      const next: HistoryState<T> = {
        past: [...current.past, current.present],
        present: resolved,
        future: [], // clear redo
      };
      pointerRef.current = next.past.length;
      return next;
    });
  }, []);

  // push arbitrary snapshot (same as setState but for direct snapshot)
  const push = useCallback((snapshot: T) => {
    setHistory((current) => {
      if (JSON.stringify(snapshot) === JSON.stringify(current.present)) return current;
      console.debug('[useUndoRedo] push -> pastLen:', current.past.length + 1);
      const next: HistoryState<T> = {
        past: [...current.past, current.present],
        present: snapshot,
        future: [],
      };
      pointerRef.current = next.past.length;
      return next;
    });
  }, []);

  // replacePresent: replace the present WITHOUT pushing into past or clearing future
  // Use this for parent/server-originated syncs where we want the source of truth applied,
  // but we do not want to record another history entry.
  const replacePresent = useCallback((newPresent: T) => {
    setHistory((current) => {
      // if identical, no-op
      if (JSON.stringify(newPresent) === JSON.stringify(current.present)) return current;
      const next: HistoryState<T> = {
        past: current.past,
        present: newPresent,
        future: current.future,
      };
      pointerRef.current = next.past.length;
      console.debug('[useUndoRedo] replacePresent -> present replaced without pushing. pastLen:', next.past.length, 'futureLen:', next.future.length);
      return next;
    });
  }, []);

  // doUndo -> returns the restored snapshot (or null)
  const doUndo = useCallback((): T | null => {
    let restored: T | null = null;
    setHistory((current) => {
      if (current.past.length === 0) return current;
      const previous = current.past[current.past.length - 1];
      const newPast = current.past.slice(0, current.past.length - 1);
      const next: HistoryState<T> = {
        past: newPast,
        present: previous,
        future: [current.present, ...current.future],
      };
      restored = previous;
      pointerRef.current = next.past.length;
      console.debug('[useUndoRedo] doUndo -> pastLen:', next.past.length, 'futureLen:', next.future.length);
      return next;
    });
    return restored;
  }, []);

  const doRedo = useCallback((): T | null => {
    let restored: T | null = null;
    setHistory((current) => {
      if (current.future.length === 0) return current;
      const nextItem = current.future[0];
      const newFuture = current.future.slice(1);
      const next: HistoryState<T> = {
        past: [...current.past, current.present],
        present: nextItem,
        future: newFuture,
      };
      restored = nextItem;
      pointerRef.current = next.past.length;
      console.debug('[useUndoRedo] doRedo -> pastLen:', next.past.length, 'futureLen:', next.future.length);
      return next;
    });
    return restored;
  }, []);

  const reset = useCallback((newState: T) => {
    const newHist: HistoryState<T> = { past: [], present: newState, future: [] };
    pointerRef.current = 0;
    setHistory(newHist);
    lastSavedState.current = newState;
    console.debug('[useUndoRedo] reset -> present set, history cleared');
  }, []);

  const markAsSaved = useCallback(() => {
    lastSavedState.current = history.present;
  }, [history.present]);

  const hasUnsavedChanges = JSON.stringify(history.present) !== JSON.stringify(lastSavedState.current);

  // Dev global inspector
  if (process.env.NODE_ENV === 'development') {
    try {
      (window as any).__FLOW_UNDO_DEBUG = (window as any).__FLOW_UNDO_DEBUG || {};
      (window as any).__FLOW_UNDO_DEBUG.getHistory = () => history;
    } catch (e) {
      // ignore
    }
  }

  return {
    state: history.present,
    setState,
    push,
    replacePresent,
    doUndo,
    doRedo,
    canUndo,
    canRedo,
    reset,
    markAsSaved,
    hasUnsavedChanges,
    _debug: history,
  };
}
