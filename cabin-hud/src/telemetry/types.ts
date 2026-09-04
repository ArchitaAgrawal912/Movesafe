import type { ThreatLevel } from '../theme';

/** Connection state of whichever TelemetrySource is currently attached. */
export type LinkStatus = 'idle' | 'connecting' | 'active' | 'error' | 'unsupported';

export type SourceKind = 'serial' | 'sim';

/**
 * One peer as reported by the anchor node, straight off the wire.
 *
 * `rssi` is RAW — the firmware deliberately does no smoothing so that all
 * filtering and calibration can be tuned live in the browser without
 * reflashing. See ranging/filter.ts.
 */
export interface RawPeer {
  id: string;
  /** Raw per-packet RSSI in dBm, e.g. -63. */
  rssi: number;
  /** Milliseconds since the anchor last heard from this peer. */
  age: number;
  /** Monotonic packet counter. Used to tell a fresh sample from a repeat. */
  n: number;
  /**
   * Relative bearing in degrees, 0 = dead ahead, clockwise positive.
   * A single-antenna ESP32 CANNOT measure this, so it is absent today and
   * peers render dead ahead. Present in the contract so that UWB + the
   * MPU-9250 compass can supply it later with no UI change.
   */
  brg?: number;
  /**
   * True ranged distance in metres. Absent today; a future DW3000 source
   * supplies it directly and the RSSI path-loss estimate is bypassed.
   */
  dist?: number;
  /**
   * The peer's own ground speed in km/h, as broadcast by that vehicle.
   *
   * Cannot be derived from ranging - it has to come from the peer itself, so
   * the tag node needs GPS or a wheel feed to fill it in. Absent on the
   * current plain-ESP32 build; the HUD shows a dash rather than guessing.
   */
  spd?: number;
}

/** One decoded line from the anchor node. */
export interface Frame {
  /** Anchor uptime in ms. */
  t: number;
  /** This vehicle's call sign. */
  self: string;
  peers: RawPeer[];
  /**
   * Our own ground speed in km/h. Same caveat as RawPeer.spd - it needs GPS
   * on the anchor, so it is absent on the current hardware.
   */
  selfSpeed?: number;
}

/**
 * The seam that keeps the UI hardware-agnostic.
 *
 * Implementations: serialSource (real ESP-NOW anchor over USB), simSource
 * (no hardware), and later a uwbSource for the DW3000 boards. Nothing
 * downstream of here knows or cares which one is attached.
 */
export interface TelemetrySource {
  readonly kind: SourceKind;
  start(onFrame: (f: Frame) => void, onStatus: (s: LinkStatus, err?: string) => void): Promise<void>;
  stop(): Promise<void>;
}

/** A peer after filtering, ranging and threat evaluation — what the HUD draws. */
export interface PeerView {
  id: string;
  /** Raw RSSI of the most recent packet, dBm. */
  rssi: number;
  /** Median-filtered RSSI, dBm. */
  medianRssi: number;
  /** Filtered distance, metres. */
  distance: number;
  /** Range rate in m/s, positive when closing. */
  closingSpeed: number;
  /** Magnitude of the relative velocity, m/s. */
  relSpeed: number;
  /**
   * Seconds until closest approach, or null when the relative motion is too
   * slow to distinguish from noise.
   *
   * This is time to CPA, not time until the range hits zero. On a crossing
   * track those differ: a vehicle passing tangentially has a range rate that
   * falls to zero at its closest point without ever reaching you.
   */
  ttc: number | null;
  /** Predicted closest-approach distance in metres, or null alongside a null ttc. */
  cpa: number | null;
  /** The peer's broadcast ground speed in km/h, or null if it does not report one. */
  peerSpeedKmh: number | null;
  threat: ThreatLevel;
  ageMs: number;
  bearingDeg: number;
  /** Recent positions for the fading trail on the radar. */
  trail: TrailPoint[];
}

export interface TrailPoint {
  d: number;
  brg: number;
  t: number;
}

export interface Snapshot {
  status: LinkStatus;
  sourceKind: SourceKind;
  self: string;
  /** Our own ground speed in km/h, or null when nothing reports it. */
  selfSpeedKmh: number | null;
  peers: PeerView[];
  /** The peer the driver should care about: worst threat, then nearest. */
  primary: PeerView | null;
  error?: string;
}
