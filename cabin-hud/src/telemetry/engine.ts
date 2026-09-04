import { severity, ThreatDebouncer, THRESHOLDS } from '../alerts/threatState';
import { PeerFilter } from '../ranging/filter';
import {
  loadCalibration,
  saveCalibration,
  type Calibration,
} from '../ranging/rssiToDistance';
import type { ThreatLevel } from '../theme';
import { SerialSource } from './serialSource';
import { SimSource } from './simSource';
import type { Frame, LinkStatus, PeerView, Snapshot, SourceKind, TelemetrySource } from './types';

/** How often derived state is recomputed, independent of frame arrival. */
const TICK_MS = 50;

interface PeerRecord {
  id: string;
  filter: PeerFilter;
  debouncer: ThreatDebouncer;
  rssi: number;
  medianRssi: number;
  distance: number;
  closingSpeed: number;
  relSpeed: number;
  ttc: number | null;
  cpa: number | null;
  peerSpeedKmh: number | null;
  threat: ThreatLevel;
  bearingDeg: number;
  lastPacketAt: number;
  lastSeq: number;
  /** Consecutive frames in which the anchor did not list this peer. */
  missCount: number;
}

/**
 * Frames without a peer before its track is considered broken.
 *
 * Counted in frames rather than milliseconds on purpose: it is the anchor's
 * own report rate that defines "we have not heard from them", and that holds
 * regardless of how the browser is scheduling timers.
 */
const MISS_LIMIT = 12;

/**
 * Owns the whole telemetry pipeline and holds no React state.
 *
 * The radar canvas reads `snapshot()` straight from its animation loop at
 * 60 fps, while React polls it at a much lower rate for the text panels. That
 * split is why the engine is a plain class: re-rendering the tree at frame
 * rate would be wasteful and would fight the canvas.
 *
 * A local tick runs regardless of whether frames are arriving, so a peer that
 * goes silent still transitions to LOST on time.
 */
export class TelemetryEngine {
  private source: TelemetrySource | null = null;
  private sourceKind: SourceKind = 'sim';
  private status: LinkStatus = 'idle';
  private error: string | undefined;
  private selfId = 'TRUCK-01';
  private selfSpeedKmh: number | null = null;
  private peers = new Map<string, PeerRecord>();
  private cal: Calibration = loadCalibration();
  private tickTimer: number | null = null;
  private listeners = new Set<() => void>();

  /** Kept so the drawer can drive the simulator directly. */
  readonly sim = new SimSource();

  // ---------------------------------------------------------------- lifecycle

  init(): void {
    if (this.tickTimer === null) {
      this.tickTimer = window.setInterval(() => this.tick(), TICK_MS);
    }
  }

  async dispose(): Promise<void> {
    if (this.tickTimer !== null) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    await this.disconnect();
  }

  async connect(kind: SourceKind): Promise<void> {
    await this.disconnect();

    this.sourceKind = kind;
    this.error = undefined;
    this.peers.clear();

    this.source = kind === 'sim' ? this.sim : new SerialSource();
    this.emit();

    await this.source.start(
      (frame) => this.onFrame(frame),
      (status, err) => {
        this.status = status;
        this.error = err;
        this.emit();
      },
    );
  }

  async disconnect(): Promise<void> {
    if (this.source) {
      await this.source.stop();
      this.source = null;
    }
    this.status = 'idle';
    this.peers.clear();
    this.selfSpeedKmh = null;
    this.emit();
  }

  get isConnected(): boolean {
    return this.status === 'active';
  }

  // -------------------------------------------------------------- calibration

  get calibration(): Calibration {
    return this.cal;
  }

  setCalibration(next: Calibration): void {
    this.cal = next;
    saveCalibration(next);
    // Re-derive from samples already held so the readout answers immediately
    // instead of waiting for the median window to refill.
    for (const rec of this.peers.values()) {
      const d = rec.filter.recalibrate(next);
      if (d !== null) rec.distance = d;
    }
    this.emit();
  }

  /** Median RSSI of the nearest tracked peer - what "capture @ 1 m" samples. */
  referenceRssi(): number | null {
    const primary = this.primaryRecord();
    return primary?.filter.lastMedianRssi ?? null;
  }

  // ------------------------------------------------------------------ ingest

  private onFrame(frame: Frame): void {
    const now = performance.now();
    this.selfId = frame.self;
    this.selfSpeedKmh = frame.selfSpeed ?? null;

    const present = new Set(frame.peers.map((p) => p.id));
    for (const [id, rec] of this.peers) {
      if (!present.has(id)) rec.missCount += 1;
    }

    for (const raw of frame.peers) {
      let rec = this.peers.get(raw.id);
      if (!rec) {
        rec = {
          id: raw.id,
          filter: new PeerFilter(),
          debouncer: new ThreatDebouncer(),
          rssi: raw.rssi,
          medianRssi: raw.rssi,
          distance: 0,
          closingSpeed: 0,
          relSpeed: 0,
          ttc: null,
          cpa: null,
          peerSpeedKmh: null,
          threat: 'LOST',
          bearingDeg: raw.brg ?? 0,
          lastPacketAt: now,
          lastSeq: -1,
          missCount: 0,
        };
        this.peers.set(raw.id, rec);
      }

      // Only consume genuinely new packets. The anchor repeats its last
      // reading between packets, and feeding a repeat into the median window
      // would fake confidence the radio has not earned.
      const isNewPacket = raw.n !== rec.lastSeq;
      if (!isNewPacket) continue;
      rec.lastSeq = raw.n;

      // A peer returning after a dropout is effectively a new track: it could
      // have moved a long way while unheard, so history from before the gap
      // would blend two unrelated positions into one wrong distance.
      if (rec.missCount >= MISS_LIMIT || now - rec.lastPacketAt > THRESHOLDS.lostMs) {
        rec.filter.reset();
        rec.debouncer.reset();
        rec.threat = 'LOST';
      }
      rec.missCount = 0;

      rec.rssi = raw.rssi;
      rec.bearingDeg = raw.brg ?? 0;
      rec.lastPacketAt = now - raw.age;

      const out = rec.filter.push(raw.rssi, this.cal, rec.bearingDeg, now);
      rec.medianRssi = out.medianRssi;
      // A future UWB source reports true range; trust it over the RSSI estimate.
      rec.distance = raw.dist ?? out.distance;
      rec.closingSpeed = out.closingSpeed;
      rec.relSpeed = out.relSpeed;
      rec.ttc = out.ttc;
      rec.cpa = out.cpa;
      rec.peerSpeedKmh = raw.spd ?? null;
    }
  }

  private tick(): void {
    const now = performance.now();
    let changed = false;

    for (const [id, rec] of this.peers) {
      const ageMs = now - rec.lastPacketAt;
      if (ageMs > THRESHOLDS.dropMs) {
        this.peers.delete(id);
        changed = true;
        continue;
      }
      const level = rec.debouncer.update(rec.distance, ageMs, now);
      if (level !== rec.threat) {
        rec.threat = level;
        changed = true;
      }
    }

    // Only push on a discrete change - a new peer, a dropped peer, a threat
    // transition. Continuously moving values (distance, TTC) are picked up by
    // the UI's own poll, so pushing here would just re-render at tick rate.
    if (changed) this.emit();
  }

  // --------------------------------------------------------------- snapshot

  snapshot(): Snapshot {
    const now = performance.now();
    const views: PeerView[] = [];

    for (const rec of this.peers.values()) {
      views.push({
        id: rec.id,
        rssi: rec.rssi,
        medianRssi: rec.medianRssi,
        distance: rec.distance,
        closingSpeed: rec.closingSpeed,
        relSpeed: rec.relSpeed,
        ttc: rec.ttc,
        cpa: rec.cpa,
        peerSpeedKmh: rec.peerSpeedKmh,
        threat: rec.threat,
        ageMs: now - rec.lastPacketAt,
        bearingDeg: rec.bearingDeg,
        trail: rec.filter.trail,
      });
    }

    views.sort((a, b) => a.distance - b.distance);
    const primaryRec = this.primaryRecord();
    const primary = primaryRec ? (views.find((v) => v.id === primaryRec.id) ?? null) : null;

    return {
      status: this.status,
      sourceKind: this.sourceKind,
      self: this.selfId,
      selfSpeedKmh: this.selfSpeedKmh,
      peers: views,
      primary,
      error: this.error,
    };
  }

  /** Worst threat level wins; ties broken by whichever is nearest. */
  private primaryRecord(): PeerRecord | null {
    let best: PeerRecord | null = null;
    for (const rec of this.peers.values()) {
      if (!best) {
        best = rec;
        continue;
      }
      const ds = severity(rec.threat) - severity(best.threat);
      if (ds > 0 || (ds === 0 && rec.distance < best.distance)) best = rec;
    }
    return best;
  }

  // ------------------------------------------------------------ subscription

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
