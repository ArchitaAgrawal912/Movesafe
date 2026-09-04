import { MIN_DISTANCE_M, rssiToDistance, type Calibration } from './rssiToDistance';

/**
 * Two-stage smoothing, both stages needed.
 *
 * Raw ESP-NOW RSSI swings 8-10 dB with the boards sitting perfectly still,
 * and a single spike is enough to punch the estimate through the 3 m alert
 * threshold. So:
 *
 *   1. Median over a short window of raw RSSI. A median deletes spikes
 *      outright, where a mean would smear them across the whole window.
 *   2. EMA over the resulting distance, to take the remaining fuzz off.
 *
 * Closing speed comes from a least-squares fit over the recent filtered
 * distance history rather than a two-sample difference, which would be pure
 * noise at this sample rate.
 */

const MEDIAN_WINDOW = 5;
const EMA_ALPHA = 0.35;
const SPEED_WINDOW_MS = 2500;
const TRAIL_MS = 2500;

/**
 * Every smoothing stage costs latency, and a median plus an EMA together put
 * the estimate roughly half a second behind reality. On an approaching
 * vehicle that is half a metre per m/s of closing speed - measured as the
 * alarm engaging at 2.1 m instead of 3.0 m, which is the wrong direction to
 * be wrong in.
 *
 * Since closing speed is already estimated, the lag can simply be projected
 * out. Applied only when the closing speed is above the believability gate,
 * so a stationary peer gets no correction and no extra noise.
 */
const LAG_COMPENSATION_S = 0.45;

/** Floor for a believable closing speed, m/s. */
export const MIN_CLOSING_SPEED = 0.3;
/**
 * RSSI error is multiplicative, so absolute distance noise grows with range:
 * roughly 8% of the distance at the noise levels these radios produce. A
 * fixed speed gate therefore passes pure noise as "closing" at long range -
 * measured at 85% of stationary samples at 12 m. Scaling the gate with
 * distance is what makes TTC mean something.
 */
const CLOSING_SPEED_FRACTION = 0.22;

export function minBelievableClosingSpeed(distance: number): number {
  return Math.max(MIN_CLOSING_SPEED, CLOSING_SPEED_FRACTION * distance);
}

export interface FilterOutput {
  medianRssi: number;
  distance: number;
  closingSpeed: number;
  relSpeed: number;
  ttc: number | null;
  cpa: number | null;
}

export class PeerFilter {
  private rssiWindow: number[] = [];
  private distEma: number | null = null;
  /**
   * Relative position history in metres, x = east of us, y = ahead of us.
   *
   * Tracked in 2D rather than as a bare range so that time-to-collision is
   * time to CLOSEST APPROACH. A vehicle crossing in front of you has a range
   * rate that decays to zero at its nearest point - a range-only estimate
   * would report "no longer closing" at the exact moment it is nearest.
   *
   * With no bearing source the whole track sits on x = 0 and the maths
   * degenerates to the range-rate answer, so one code path serves both the
   * current hardware and a future UWB + compass build.
   */
  private history: { t: number; x: number; y: number }[] = [];
  private trailPoints: { d: number; brg: number; t: number }[] = [];
  private lastCorrected: number | null = null;

  /**
   * Feed one fresh RSSI sample. Call this only when the packet counter has
   * advanced - pushing a repeated reading would fake confidence the radio
   * has not earned.
   */
  push(rssi: number, cal: Calibration, bearingDeg: number, now: number): FilterOutput {
    this.rssiWindow.push(rssi);
    if (this.rssiWindow.length > MEDIAN_WINDOW) this.rssiWindow.shift();

    const medianRssi = median(this.rssiWindow);
    const rawDistance = rssiToDistance(medianRssi, cal);

    this.distEma =
      this.distEma === null ? rawDistance : this.distEma + EMA_ALPHA * (rawDistance - this.distEma);
    const distance = this.distEma;

    // History holds the UNCOMPENSATED estimate, so the fit stays a clean
    // measurement rather than feeding its own correction back in.
    const bearingRad = (bearingDeg * Math.PI) / 180;
    this.history.push({
      t: now,
      x: distance * Math.sin(bearingRad),
      y: distance * Math.cos(bearingRad),
    });
    while (this.history.length > 0 && now - this.history[0].t > SPEED_WINDOW_MS) {
      this.history.shift();
    }

    // Relative velocity, fitted independently on each axis. A straight-line
    // track at constant speed is exactly what least squares wants, so this is
    // well conditioned even while the bearing is swinging quickly near CPA.
    const vx = slopePerSecond(this.history, 'x');
    const vy = slopePerSecond(this.history, 'y');
    const relSpeed = Math.hypot(vx, vy);

    const x = distance * Math.sin(bearingRad);
    const y = distance * Math.cos(bearingRad);
    // Range rate is the relative velocity projected onto the line of sight.
    const closingSpeed = distance > 0 ? -(x * vx + y * vy) / distance : 0;

    const believable = relSpeed >= minBelievableClosingSpeed(distance);
    const corrected = believable
      ? Math.max(MIN_DISTANCE_M, distance - closingSpeed * LAG_COMPENSATION_S)
      : distance;

    this.trailPoints.push({ d: corrected, brg: bearingDeg, t: now });
    while (this.trailPoints.length > 0 && now - this.trailPoints[0].t > TRAIL_MS) {
      this.trailPoints.shift();
    }

    this.lastCorrected = corrected;

    // Time to closest point of approach: t* = -(r . v) / |v|^2, and the miss
    // distance is how far apart we are at t*. Only meaningful looking forward.
    let ttc: number | null = null;
    let cpa: number | null = null;
    if (believable && relSpeed > 0) {
      const tStar = -(x * vx + y * vy) / (relSpeed * relSpeed);
      if (tStar > 0 && tStar < 600) {
        ttc = tStar;
        cpa = Math.hypot(x + vx * tStar, y + vy * tStar);
      }
    }

    return { medianRssi, distance: corrected, closingSpeed, relSpeed, ttc, cpa };
  }

  /**
   * Recompute distance from the samples already held, without consuming a new
   * one. Used when the operator drags a calibration slider so the readout
   * responds instantly instead of waiting for the window to refill.
   */
  recalibrate(cal: Calibration): number | null {
    if (this.rssiWindow.length === 0) return null;
    this.distEma = rssiToDistance(median(this.rssiWindow), cal);
    this.lastCorrected = this.distEma;
    return this.distEma;
  }

  get trail(): { d: number; brg: number; t: number }[] {
    return this.trailPoints;
  }

  get lastMedianRssi(): number | null {
    return this.rssiWindow.length ? median(this.rssiWindow) : null;
  }

  /**
   * Discard all history. Called when the link to a peer has been down long
   * enough that the samples either side of the gap are not one track: the
   * vehicle may have travelled a long way while unheard, and a median window
   * straddling the gap reports a distance that was never true.
   */
  reset(): void {
    this.rssiWindow = [];
    this.distEma = null;
    this.history = [];
    this.trailPoints = [];
    this.lastCorrected = null;
  }

  /** The lag-corrected estimate - the same value threat evaluation uses. */
  get lastDistance(): number | null {
    return this.lastCorrected;
  }
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Least-squares slope of one axis against time, in metres per second. */
function slopePerSecond(points: { t: number; x: number; y: number }[], axis: 'x' | 'y'): number {
  const n = points.length;
  if (n < 3) return 0;

  let sumT = 0;
  let sumV = 0;
  for (const p of points) {
    sumT += p.t;
    sumV += p[axis];
  }
  const meanT = sumT / n;
  const meanV = sumV / n;

  let num = 0;
  let den = 0;
  for (const p of points) {
    const dt = p.t - meanT;
    num += dt * (p[axis] - meanV);
    den += dt * dt;
  }
  if (den === 0) return 0;

  // num/den is metres per millisecond.
  return (num / den) * 1000;
}
