/**
 * Log-distance path-loss ranging.
 *
 *     d = 10 ^ ((rssiAt1m - rssi) / (10 * n))
 *
 * This is a stand-in for real UWB two-way ranging. It is accurate to roughly
 * +/-1-2 m once calibrated, and is sensitive to body-blocking and nearby
 * metal. Both constants are tunable live from the calibration drawer so the
 * 3 m alert threshold can be trimmed against a tape measure on site.
 */

export interface Calibration {
  /** Measured RSSI at exactly 1 m, dBm. Capture this, do not guess it. */
  rssiAt1m: number;
  /** Path-loss exponent. 2.0 = free space, 2.5-3.5 = cluttered/industrial. */
  pathLoss: number;
}

export const DEFAULT_CALIBRATION: Calibration = {
  rssiAt1m: -45,
  pathLoss: 2.3,
};

export const MIN_DISTANCE_M = 0.3;
export const MAX_DISTANCE_M = 150;

const STORAGE_KEY = 'movesafe.calibration.v1';

export function rssiToDistance(rssi: number, cal: Calibration): number {
  const exponent = (cal.rssiAt1m - rssi) / (10 * cal.pathLoss);
  const d = Math.pow(10, exponent);
  if (!Number.isFinite(d)) return MAX_DISTANCE_M;
  return Math.min(MAX_DISTANCE_M, Math.max(MIN_DISTANCE_M, d));
}

/** Inverse of the above. Used by the simulator to synthesise believable RSSI. */
export function distanceToRssi(d: number, cal: Calibration): number {
  return cal.rssiAt1m - 10 * cal.pathLoss * Math.log10(Math.max(MIN_DISTANCE_M, d));
}

export function loadCalibration(): Calibration {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CALIBRATION };
    const parsed = JSON.parse(raw) as Partial<Calibration>;
    return {
      rssiAt1m:
        typeof parsed.rssiAt1m === 'number' && Number.isFinite(parsed.rssiAt1m)
          ? parsed.rssiAt1m
          : DEFAULT_CALIBRATION.rssiAt1m,
      pathLoss:
        typeof parsed.pathLoss === 'number' && parsed.pathLoss > 0.5
          ? parsed.pathLoss
          : DEFAULT_CALIBRATION.pathLoss,
    };
  } catch {
    // Private browsing or blocked storage - defaults are fine.
    return { ...DEFAULT_CALIBRATION };
  }
}

export function saveCalibration(cal: Calibration): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cal));
  } catch {
    // Non-fatal: calibration simply will not survive a reload.
  }
}
