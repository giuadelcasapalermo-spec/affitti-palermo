'use client';

import { useState, useEffect, useCallback } from 'react';

export function usePersistedState<T>(
  key: string,
  defaultValue: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') return defaultValue;
    try {
      const saved = sessionStorage.getItem(key);
      return saved !== null ? (JSON.parse(saved) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(state));
    } catch {
      // ignore quota errors
    }
  }, [key, state]);

  const setPersistedState: React.Dispatch<React.SetStateAction<T>> = useCallback(
    (value) => setState(value),
    []
  );

  return [state, setPersistedState];
}
