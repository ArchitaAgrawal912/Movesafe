import { DEFAULT_CALIBRATION, distanceToRssi } from '../ranging/rssiToDistance';
import type { Frame, LinkStatus, RawPeer, TelemetrySource } from './types';

/**
 * Hardware-free telemetry, for building the UI before the boards are wired
 * and as the demo-day fallback if they misbehave in front of judges.
 *
 * It synthesises RSSI from a geometry and adds realistic noise rather than
 * emitting a clean distance directly, so the median filter, the EMA, the
 * lag compensation and the calibration maths all get exercised exactly as
 * they will on real hardware.
 */

const FRAME_INTERVAL_MS = 100;
/** Standard deviation of the synthetic RSSI noise, dB. Real boards are ~2.5. */
const NOISE_DB = 2.5;

/** Where the crossing vehicle enters and leaves, metres east of us. */
const CROSS_START_E = 18;
const CROSS_END_E = -8;
/** Silence between laps. Must exceed THRESHOLDS.lostMs so the track resets. */
const LAP_GAP_TICKS = 20;

export type SimMode = 'crossing' | 'manual';

export class SimSource implements TelemetrySource {
  readonly kind = 'sim' as const;

  mode: SimMode = 'crossing';

  // -- crossing scenario ---------------------------------------------------
  /** How fast the other vehicle crosses our path, m/s. */
  peerSpeed = 2.0;
  /** Closest approach, metres. Below the 3 m threshold, this trips the alarm. */
  passDistance = 1.5;
  /**
   * Our own speedometer reading, km/h.
   *
   * Display only - the scenario is modelled in OUR reference frame, so the
   * crossing track is already relative to us. This is the number a real
   * anchor would read off GPS and forward to the screen, and it is
   * independent of the ranging geometry.
   */
  mySpeedKmh = 18;

  // -- manual scenario -----------------------------------------------------
  /** Fixed distance dead ahead. Used for pinning the threshold under test. */
  targetDistance = 12;
  autoRamp = false;

  private timer: number | null = null;
  private seq = 0;
  private t0 = 0;
  private east = CROSS_START_E;
  private gapTicks = 0;
  private rampDirection = -1;

  async start(
    onFrame: (f: Frame) => void,
    onStatus: (s: LinkStatus, err?: string) => void,
  ): Promise<void> {
    this.t0 = performance.now();
    this.seq = 0;
    this.east = CROSS_START_E;
    onStatus('active');

    this.timer = window.setInterval(() => {
      const elapsed = performance.now() - this.t0;
      this.seq += 1;
      const dt = FRAME_INTERVAL_MS / 1000;

      const peer = this.mode === 'crossing' ? this.stepCrossing(dt) : this.stepManual(dt);

      onFrame({
        t: Math.round(elapsed),
        self: 'TRUCK-01',
        peers: peer ? [peer] : [],
        selfSpeed: this.mySpeedKmh,
      });
    }, FRAME_INTERVAL_MS);
  }

  /**
   * A single vehicle tracking right to left across our bow at a constant
   * speed, passing `passDistance` in front. Straight line, constant velocity -
   * so the reported time-to-CPA can be checked against the geometry.
   */
  private stepCrossing(dt: number): RawPeer | null {
    // Between laps the vehicle is simply out of contact for a moment rather
    // than teleporting back to the start. A jump would smear two positions
    // through the filter and show a red alert at 20 m; going quiet lets the
    // engine drop the stale track and start the next lap clean.
    if (this.gapTicks > 0) {
      this.gapTicks -= 1;
      return null;
    }

    this.east -= this.peerSpeed * dt;
    if (this.east < CROSS_END_E) {
      this.east = CROSS_START_E;
      this.gapTicks = LAP_GAP_TICKS;
      return null;
    }

    const east = this.east;
    const ahead = this.passDistance;
    const distance = Math.hypot(east, ahead);

    return {
      id: 'TRUCK-02',
      rssi: noisyRssi(distance),
      age: 20 + Math.random() * 30,
      n: this.seq,
      brg: (Math.atan2(east, ahead) * 180) / Math.PI,
      spd: this.peerSpeed * 3.6,
    };
  }

  /** Dead ahead at a distance you set by hand. No bearing, no reported speed -
   *  exactly what the current plain-ESP32 hardware provides. */
  private stepManual(dt: number): RawPeer {
    if (this.autoRamp) {
      this.targetDistance += this.rampDirection * dt;
      if (this.targetDistance <= 1) {
        this.targetDistance = 1;
        this.rampDirection = 1;
      } else if (this.targetDistance >= 20) {
        this.targetDistance = 20;
        this.rampDirection = -1;
      }
    }

    return {
      id: 'TRUCK-02',
      rssi: noisyRssi(this.targetDistance),
      age: 20 + Math.random() * 30,
      n: this.seq,
    };
  }

  async stop(): Promise<void> {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }
}

function noisyRssi(distance: number): number {
  const clean = distanceToRssi(distance, DEFAULT_CALIBRATION);
  return Math.round(clean + gaussian() * NOISE_DB);
}

/** Box-Muller. Real RSSI noise is roughly normal, so uniform noise would read wrong. */
function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
