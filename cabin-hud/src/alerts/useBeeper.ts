import { useEffect, useRef } from 'react';
import type { ThreatLevel } from '../theme';
import { THRESHOLDS } from './threatState';

/**
 * Parking-sensor style proximity alarm, synthesised with Web Audio so there
 * are no asset files to ship or fail to load.
 *
 * The repeat rate tightens as the peer closes, which is the part a driver
 * actually reads - they hear "getting worse" without looking at the screen.
 */

const TONE_HZ = 880;
const PULSE_S = 0.09;
const PEAK_GAIN = 0.22;

/** Gap between pulses at the DANGER threshold and at point blank, ms. */
const GAP_AT_THRESHOLD = 420;
const GAP_AT_CONTACT = 25;
const CONTACT_M = 1.2;

let ctx: AudioContext | null = null;

/**
 * Must be called from a real user gesture - browsers refuse to start audio
 * otherwise, and a silent alarm is worse than no alarm. The Connect button
 * click is the natural place.
 */
export function unlockAudio(): void {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    // No audio available; the visual alert still works.
  }
}

export function audioReady(): boolean {
  return ctx !== null && ctx.state === 'running';
}

function pulse(): void {
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = TONE_HZ;

  // Short ramps at both ends, otherwise each pulse starts and ends with an
  // audible click.
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(PEAK_GAIN, now + 0.006);
  gain.gain.setValueAtTime(PEAK_GAIN, now + PULSE_S - 0.006);
  gain.gain.linearRampToValueAtTime(0, now + PULSE_S);

  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + PULSE_S + 0.02);
}

function gapFor(distance: number): number {
  const span = THRESHOLDS.danger - CONTACT_M;
  const frac = span <= 0 ? 0 : (distance - CONTACT_M) / span;
  const clamped = Math.min(1, Math.max(0, frac));
  return GAP_AT_CONTACT + clamped * (GAP_AT_THRESHOLD - GAP_AT_CONTACT);
}

export function useBeeper(level: ThreatLevel, distance: number, muted: boolean): void {
  // Held in a ref so the loop always reads current values without being torn
  // down and rebuilt on every distance update.
  const state = useRef({ level, distance, muted });
  state.current = { level, distance, muted };

  useEffect(() => {
    let stopped = false;
    let timer = 0;

    const loop = () => {
      if (stopped) return;
      const s = state.current;
      let gap = 250;
      if (s.level === 'DANGER' && !s.muted) {
        pulse();
        gap = PULSE_S * 1000 + gapFor(s.distance);
      }
      timer = window.setTimeout(loop, gap);
    };

    loop();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);
}
