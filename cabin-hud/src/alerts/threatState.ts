import type { ThreatLevel } from '../theme';

/**
 * Threat thresholds, all in one place so they can be retuned in seconds on
 * demo day without hunting through components.
 *
 * Every level has a separate enter and clear distance. Without that
 * hysteresis a peer parked at exactly 3.0 m would strobe red/green several
 * times a second as RSSI noise walked the estimate back and forth across the
 * line - which is both useless to a driver and looks broken.
 */
export const THRESHOLDS = {
  /** Enter DANGER at or below this, metres. */
  danger: 3.0,
  /** Leave DANGER only once past this, metres. */
  dangerClear: 3.5,
  /** Enter CAUTION at or below this, metres. */
  caution: 8.0,
  /** Leave CAUTION only once past this, metres. */
  cautionClear: 9.0,
  /** No packet for this long and the peer is considered lost, ms. */
  lostMs: 1500,
  /** Drop the peer from the display entirely after this long, ms. */
  dropMs: 10000,
} as const;

export function nextThreat(prev: ThreatLevel | undefined, distance: number, ageMs: number): ThreatLevel {
  if (ageMs >= THRESHOLDS.lostMs) return 'LOST';

  if (distance <= THRESHOLDS.danger) return 'DANGER';
  if (prev === 'DANGER' && distance < THRESHOLDS.dangerClear) return 'DANGER';

  if (distance <= THRESHOLDS.caution) return 'CAUTION';
  if (prev === 'CAUTION' && distance < THRESHOLDS.cautionClear) return 'CAUTION';

  return 'SAFE';
}

/**
 * Hysteresis alone is not enough.
 *
 * Measured on the noise these radios actually produce, a target sitting at a
 * true 3.0 m yields filtered estimates spanning roughly 2.3-3.9 m. That range
 * straddles both the danger and the clear threshold, so the alarm would still
 * chatter. Requiring a level to persist before it is committed fixes what
 * widening the band cannot.
 *
 * The two timings are deliberately asymmetric: escalate almost at once,
 * relax slowly. Warning a fraction of a second early costs nothing; dropping
 * a real alarm because one sample looked good is the failure that hurts.
 */
export const DEBOUNCE = {
  escalateMs: 150,
  /**
   * Swept against simulated noise: at 1200 ms a peer parked at 3.3 m still
   * flipped ~4 times a minute; at 2000 ms that goes to zero without pushing
   * the alarm's trigger point away from 3 m. The visible cost is that
   * clearing a red alert takes two seconds of sustained distance, which is
   * the right way round for a brake warning.
   */
  relaxMs: 2000,
} as const;

/**
 * Wraps nextThreat with the persistence requirement above. One instance per
 * peer, held by the engine.
 */
export class ThreatDebouncer {
  private committed: ThreatLevel = 'LOST';
  private candidate: ThreatLevel = 'LOST';
  private candidateSince = 0;

  update(distance: number, ageMs: number, now: number): ThreatLevel {
    // Hysteresis is evaluated against the committed level, not the candidate,
    // so the two mechanisms reinforce rather than fight each other.
    const raw = nextThreat(this.committed, distance, ageMs);

    if (raw === this.committed) {
      this.candidate = raw;
      this.candidateSince = now;
      return this.committed;
    }

    if (raw !== this.candidate) {
      this.candidate = raw;
      this.candidateSince = now;
    }

    // A lost link is a fact about the radio, not a noisy measurement, so it
    // commits immediately.
    const required =
      raw === 'LOST'
        ? 0
        : severity(raw) > severity(this.committed)
          ? DEBOUNCE.escalateMs
          : DEBOUNCE.relaxMs;

    if (now - this.candidateSince >= required) this.committed = raw;
    return this.committed;
  }

  /** Drop straight back to LOST, skipping the relax delay. Used when the
   *  link has been down and the pre-gap state no longer describes anything. */
  reset(): void {
    this.committed = 'LOST';
    this.candidate = 'LOST';
    this.candidateSince = 0;
  }

  get level(): ThreatLevel {
    return this.committed;
  }
}

const SEVERITY: Record<ThreatLevel, number> = {
  DANGER: 3,
  CAUTION: 2,
  SAFE: 1,
  LOST: 0,
};

export function severity(level: ThreatLevel): number {
  return SEVERITY[level];
}
