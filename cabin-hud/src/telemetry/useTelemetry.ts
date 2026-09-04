import { useEffect, useRef, useState } from 'react';
import { TelemetryEngine } from './engine';
import type { Snapshot } from './types';

/** One engine instance for the life of the app. */
export function useEngine(): TelemetryEngine {
  const ref = useRef<TelemetryEngine | null>(null);
  if (ref.current === null) ref.current = new TelemetryEngine();

  useEffect(() => {
    const engine = ref.current!;
    engine.init();
    return () => {
      void engine.dispose();
    };
  }, []);

  return ref.current;
}

/**
 * Polls the engine for the text panels.
 *
 * Deliberately slower than the radar: 10 Hz is past the point where a driver
 * can read changing digits anyway, and it keeps React out of the 60 fps
 * canvas loop entirely. Engine-pushed events (a connection error, a threat
 * level change) still land immediately via the subscription.
 */
export function useSnapshot(engine: TelemetryEngine, hz = 10): Snapshot {
  const [snap, setSnap] = useState<Snapshot>(() => engine.snapshot());

  useEffect(() => {
    const update = () => setSnap(engine.snapshot());
    const unsubscribe = engine.subscribe(update);
    const timer = window.setInterval(update, 1000 / hz);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [engine, hz]);

  return snap;
}
