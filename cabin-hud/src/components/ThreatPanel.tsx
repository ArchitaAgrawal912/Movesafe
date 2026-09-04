import { THRESHOLDS } from '../alerts/threatState';
import { MIN_CLOSING_SPEED } from '../ranging/filter';
import type { PeerView } from '../telemetry/types';
import { COLORS, THREAT_COLOR, THREAT_LABEL } from '../theme';

/**
 * The numbers the driver reads at a glance. Deliberately large, monospaced
 * and tabular so the digits do not jitter sideways as they change.
 */
export function ThreatPanel({
  peer,
  selfSpeedKmh,
}: {
  peer: PeerView | null;
  selfSpeedKmh: number | null;
}) {
  if (!peer) {
    return (
      <div
        className="rounded-lg border px-4 py-3"
        style={{ background: `${COLORS.panel}e6`, borderColor: COLORS.panelEdge }}
      >
        <div className="text-xs tracking-widest" style={{ color: COLORS.textDim }}>
          NO VEHICLES IN RANGE
        </div>
      </div>
    );
  }

  const color = THREAT_COLOR[peer.threat];
  const lost = peer.threat === 'LOST';

  // A predicted miss inside the alert radius is a collision course; outside
  // it, the pass is survivable and the wording should not cry wolf.
  const onCollisionCourse = peer.cpa !== null && peer.cpa <= THRESHOLDS.danger;

  return (
    <div
      className="w-[300px] rounded-lg border px-4 py-3"
      style={{
        background: `${COLORS.panel}f2`,
        borderColor: color,
        boxShadow: peer.threat === 'DANGER' ? `0 0 22px ${color}55` : 'none',
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-xs font-semibold" style={{ color: COLORS.textDim }}>
          {peer.id}
        </span>
        <span className="font-mono text-xs font-bold tracking-wider" style={{ color }}>
          {THREAT_LABEL[peer.threat]}
        </span>
      </div>

      <div className="mt-1 flex items-end justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] tracking-widest" style={{ color: COLORS.textDim }}>
            DISTANCE
          </div>
          <div className="font-mono text-[2.5rem] leading-none font-bold tabular-nums" style={{ color }}>
            {lost ? '--.-' : peer.distance.toFixed(1)}
            <span className="ml-1 text-base font-semibold" style={{ color: COLORS.textDim }}>
              m
            </span>
          </div>
        </div>

        <div className="text-right">
          <div className="font-mono text-[10px] tracking-widest" style={{ color: COLORS.textDim }}>
            {onCollisionCourse ? 'COLLIDE IN' : 'CLOSEST IN'}
          </div>
          <div
            className="font-mono text-[2.5rem] leading-none font-bold tabular-nums"
            style={{ color: onCollisionCourse ? color : COLORS.textDim }}
          >
            {formatTtc(peer)}
            {peer.ttc !== null && !lost && (
              <span className="ml-1 text-base font-semibold" style={{ color: COLORS.textDim }}>
                s
              </span>
            )}
          </div>
        </div>
      </div>

      <div
        className="mt-3 grid grid-cols-2 gap-x-4 border-t pt-2 font-mono text-xs"
        style={{ borderColor: COLORS.panelEdge }}
      >
        <Speed label="MY SPEED" kmh={selfSpeedKmh} />
        <Speed label="THEIR SPEED" kmh={lost ? null : peer.peerSpeedKmh} />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs">
        <Field label="MISS BY" value={formatCpa(peer)} highlight={onCollisionCourse} />
        <Field label="CLOSING" value={formatClosing(peer)} />
        <Field label="RSSI" value={lost ? '--' : `${Math.round(peer.medianRssi)} dBm`} />
        <Field label="AGE" value={`${Math.round(peer.ageMs)} ms`} />
      </div>
    </div>
  );
}

function Speed({ label, kmh }: { label: string; kmh: number | null }) {
  return (
    <div>
      <div className="text-[10px] tracking-widest" style={{ color: COLORS.textDim }}>
        {label}
      </div>
      <div className="text-lg leading-tight font-bold tabular-nums" style={{ color: COLORS.text }}>
        {kmh === null ? '—' : kmh.toFixed(0)}
        <span className="ml-1 text-[10px] font-semibold" style={{ color: COLORS.textDim }}>
          km/h
        </span>
      </div>
    </div>
  );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span style={{ color: COLORS.textDim }}>{label}</span>
      <span className="tabular-nums" style={{ color: highlight ? COLORS.text : COLORS.textDim }}>
        {value}
      </span>
    </div>
  );
}

/**
 * Withheld unless the relative motion is above the noise floor. Deriving a
 * time-to-collision from RSSI jitter would produce confident-looking numbers
 * with nothing behind them, which is worse than a dash.
 */
function formatTtc(peer: PeerView): string {
  if (peer.threat === 'LOST' || peer.ttc === null) return '—';
  if (peer.ttc > 99) return '99+';
  return peer.ttc.toFixed(1);
}

function formatCpa(peer: PeerView): string {
  if (peer.threat === 'LOST' || peer.cpa === null) return '—';
  return `${peer.cpa.toFixed(1)} m`;
}

function formatClosing(peer: PeerView): string {
  if (peer.threat === 'LOST') return '—';
  if (Math.abs(peer.closingSpeed) < MIN_CLOSING_SPEED) return 'steady';
  const sign = peer.closingSpeed > 0 ? '+' : '';
  return `${sign}${peer.closingSpeed.toFixed(1)} m/s`;
}
