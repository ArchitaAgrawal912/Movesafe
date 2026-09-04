import type { Frame, LinkStatus, RawPeer, TelemetrySource } from './types';

const BAUD_RATE = 115200;

/**
 * Reads newline-delimited JSON from the anchor ESP32 over USB via the Web
 * Serial API.
 *
 * Two things that bite in practice and are handled here:
 *  - Serial chunks arrive split mid-line, so lines must be reassembled from a
 *    running buffer rather than parsed per chunk.
 *  - The port is exclusive. If the Arduino IDE Serial Monitor is open, the
 *    open() call fails; the error message says so plainly.
 */
export class SerialSource implements TelemetrySource {
  readonly kind = 'serial' as const;

  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private stopping = false;

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  async start(
    onFrame: (f: Frame) => void,
    onStatus: (s: LinkStatus, err?: string) => void,
  ): Promise<void> {
    if (!SerialSource.isSupported()) {
      onStatus('unsupported', 'Web Serial is not available. Use Chrome or Edge on desktop.');
      return;
    }

    this.stopping = false;
    onStatus('connecting');

    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: BAUD_RATE });
    } catch (err) {
      this.port = null;
      const msg = describeOpenError(err);
      onStatus(msg === null ? 'idle' : 'error', msg ?? undefined);
      return;
    }

    onStatus('active');

    this.reader = this.port.readable!.getReader();
    void this.pump(onFrame, onStatus);
  }

  private async pump(
    onFrame: (f: Frame) => void,
    onStatus: (s: LinkStatus, err?: string) => void,
  ): Promise<void> {
    // Decoding by hand rather than through TextDecoderStream: it keeps the
    // teardown path to a single reader, and `stream: true` correctly carries
    // a multi-byte character split across two USB packets.
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value) continue;

        buffer += decoder.decode(value, { stream: true });
        // Keep the tail after the last newline - it is a partial line.
        let idx: number;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          const frame = parseFrame(line);
          if (frame) onFrame(frame);
        }
        // Guard against a device that never sends a newline.
        if (buffer.length > 8192) buffer = '';
      }
    } catch (err) {
      if (!this.stopping) {
        onStatus('error', err instanceof Error ? err.message : 'Serial read failed.');
      }
    }
    if (!this.stopping) onStatus('idle');
  }

  async stop(): Promise<void> {
    this.stopping = true;
    const reader = this.reader;
    this.reader = null;
    try {
      await reader?.cancel();
      reader?.releaseLock();
    } catch {
      /* already gone */
    }
    try {
      await this.port?.close();
    } catch {
      /* already gone */
    }
    this.port = null;
  }
}

/**
 * Malformed lines are dropped silently and on purpose: a half-written line at
 * the moment the port opens is normal, and one bad line must never take the
 * HUD down mid-shift.
 */
export function parseFrame(line: string): Frame | null {
  if (!line.startsWith('{')) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }

  if (typeof obj !== 'object' || obj === null) return null;
  const rec = obj as Record<string, unknown>;
  if (!Array.isArray(rec.peers)) return null;

  const peers: RawPeer[] = [];
  for (const raw of rec.peers) {
    if (typeof raw !== 'object' || raw === null) continue;
    const p = raw as Record<string, unknown>;
    if (typeof p.id !== 'string' || typeof p.rssi !== 'number') continue;
    peers.push({
      id: p.id,
      rssi: p.rssi,
      age: typeof p.age === 'number' ? p.age : 0,
      n: typeof p.n === 'number' ? p.n : 0,
      brg: typeof p.brg === 'number' ? p.brg : undefined,
      dist: typeof p.dist === 'number' ? p.dist : undefined,
      spd: typeof p.spd === 'number' ? p.spd : undefined,
    });
  }

  return {
    t: typeof rec.t === 'number' ? rec.t : 0,
    self: typeof rec.self === 'string' ? rec.self : 'TRUCK-01',
    peers,
    selfSpeed: typeof rec.selfSpeed === 'number' ? rec.selfSpeed : undefined,
  };
}

/** Returns null when the user simply dismissed the port picker. */
function describeOpenError(err: unknown): string | null {
  if (!(err instanceof Error)) return 'Could not open the serial port.';
  if (err.name === 'NotFoundError') return null; // picker cancelled
  if (err.name === 'InvalidStateError' || /already open/i.test(err.message)) {
    return 'That port is already in use. Close the Arduino Serial Monitor and try again.';
  }
  if (err.name === 'SecurityError') {
    return 'Web Serial was blocked. Open the app over http://localhost, not a file:// path.';
  }
  return err.message || 'Could not open the serial port.';
}
