import { memo, useEffect, useRef } from 'react';
import { THRESHOLDS } from '../alerts/threatState';
import type { TelemetryEngine } from '../telemetry/engine';
import type { PeerView } from '../telemetry/types';
import { COLORS, THREAT_COLOR } from '../theme';

/**
 * Forward-looking proximity radar.
 *
 * Drawn on a canvas rather than SVG/DOM because it redraws every frame with
 * trails, glows and interpolated motion; reconciling that through React would
 * be wasted work. It reads the engine directly from its own rAF loop, so this
 * component renders exactly once.
 */

/** Furthest range plotted, metres. Beyond this, peers pin to the rim. */
const MAX_RANGE_M = 25;
const RING_METRES = [THRESHOLDS.danger, 10, MAX_RANGE_M];
/** Own vehicle sits low on the canvas so the forward view gets the space. */
const OWN_Y_FRACTION = 0.8;
/**
 * Radius curve. Below 1 it expands the near field, where the decisions are,
 * at the cost of the far field. A plain square root (0.5) over-does it -
 * everything past 10 m collapses into the rim - so this sits between that
 * and linear.
 */
const RANGE_EXPONENT = 0.65;
/** Fraction of the remaining gap closed per frame when animating movement. */
const SMOOTHING = 0.22;
/** Past this gap, jump rather than glide - a peer that far off is new, not moving. */
const SNAP_M = 4;
const MONO = "ui-monospace, 'SFMono-Regular', 'Cascadia Mono', Consolas, monospace";

export const RadarCanvas = memo(function RadarCanvas({ engine }: { engine: TelemetryEngine }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Displayed distance per peer, eased toward the real value so the dot
    // glides between 10 Hz frames instead of stepping.
    const shown = new Map<string, number>();
    let raf = 0;

    const frame = (ts: number) => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      if (w === 0 || h === 0) {
        raf = requestAnimationFrame(frame);
        return;
      }
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const snap = engine.snapshot();
      const anyDanger = snap.peers.some((p) => p.threat === 'DANGER');

      const cx = w / 2;
      const cy = h * OWN_Y_FRACTION;
      const maxR = Math.max(60, Math.min(cy - 18, w / 2 - 18));
      const rPx = (d: number) =>
        maxR * Math.pow(Math.min(d, MAX_RANGE_M) / MAX_RANGE_M, RANGE_EXPONENT);

      drawBackground(ctx, w, h);
      drawSpokes(ctx, cx, cy, maxR);
      drawRings(ctx, cx, cy, rPx, ts, anyDanger);
      drawOwnVehicle(ctx, cx, cy);

      for (const peer of snap.peers) {
        const target = peer.distance;
        const prev = shown.get(peer.id);
        const next =
          prev === undefined || Math.abs(target - prev) > SNAP_M
            ? target
            : prev + (target - prev) * SMOOTHING;
        shown.set(peer.id, next);
        drawPeer(ctx, cx, cy, rPx, peer, next, peer.id === snap.primary?.id, ts);
      }

      for (const id of shown.keys()) {
        if (!snap.peers.some((p) => p.id === id)) shown.delete(id);
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  return <canvas ref={canvasRef} className="block h-full w-full" />;
});

// ----------------------------------------------------------------- drawing

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);

  // Faint map grid, so the radar reads as ground rather than empty space.
  ctx.strokeStyle = COLORS.grid;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 44) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, h);
  }
  for (let y = 0; y <= h; y += 44) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(w, Math.round(y) + 0.5);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawSpokes(ctx: CanvasRenderingContext2D, cx: number, cy: number, maxR: number) {
  ctx.strokeStyle = COLORS.ring;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  for (const deg of [-60, -30, 0, 30, 60]) {
    const a = ((deg - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + maxR * Math.cos(a), cy + maxR * Math.sin(a));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawRings(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rPx: (d: number) => number,
  ts: number,
  anyDanger: boolean,
) {
  ctx.font = `500 11px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const metres of RING_METRES) {
    const r = rPx(metres);
    const isAlertRing = metres === THRESHOLDS.danger;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);

    if (isAlertRing) {
      // The 3 m line is the one decision the driver makes, so it is drawn
      // as a live boundary and pulses while it is being breached.
      const pulse = anyDanger ? 0.45 + 0.4 * Math.sin(ts / 130) : 0.4;
      ctx.strokeStyle = COLORS.danger;
      ctx.globalAlpha = pulse;
      ctx.lineWidth = anyDanger ? 2.5 : 1.5;
      ctx.setLineDash([7, 6]);
    } else {
      ctx.strokeStyle = COLORS.ring;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Label up-left, clear of the dead-ahead track where peers sit.
    const a = (-140 * Math.PI) / 180;
    const lx = cx + r * Math.cos(a);
    const ly = cy + r * Math.sin(a);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.bg;
    const label = `${metres}m`;
    const tw = ctx.measureText(label).width;
    ctx.fillRect(lx - tw / 2 - 3, ly - 8, tw + 6, 16);
    ctx.fillStyle = isAlertRing ? COLORS.danger : COLORS.textDim;
    ctx.fillText(label, lx, ly);
  }
  ctx.globalAlpha = 1;
}

function drawOwnVehicle(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  // Forward field wedge.
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, 78, (-160 * Math.PI) / 180, (-20 * Math.PI) / 180);
  ctx.closePath();
  ctx.fillStyle = COLORS.accent;
  ctx.globalAlpha = 0.05;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = COLORS.text;

  // Simplified haul truck, nose up.
  ctx.beginPath();
  ctx.moveTo(0, -13);
  ctx.lineTo(7, -4);
  ctx.lineTo(7, 10);
  ctx.lineTo(-7, 10);
  ctx.lineTo(-7, -4);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(-4, -3, 8, 5);

  ctx.fillStyle = COLORS.textDim;
  ctx.fillRect(-10, 1, 3, 7);
  ctx.fillRect(7, 1, 3, 7);
  ctx.restore();

  ctx.font = `600 10px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = COLORS.textDim;
  ctx.fillText('MY POS', cx, cy + 16);
}

function drawPeer(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rPx: (d: number) => number,
  peer: PeerView,
  shownDistance: number,
  isPrimary: boolean,
  ts: number,
) {
  const color = THREAT_COLOR[peer.threat];
  const angle = ((peer.bearingDeg - 90) * Math.PI) / 180;
  const r = rPx(shownDistance);
  const x = cx + r * Math.cos(angle);
  const y = cy + r * Math.sin(angle);

  // A lost peer fades out over the drop window rather than vanishing, so the
  // driver sees it go stale instead of wondering where it went.
  const fade =
    peer.threat === 'LOST'
      ? Math.max(
          0.15,
          1 - (peer.ageMs - THRESHOLDS.lostMs) / (THRESHOLDS.dropMs - THRESHOLDS.lostMs),
        )
      : 1;

  ctx.globalAlpha = fade;

  drawTrail(ctx, cx, cy, rPx, peer, color, fade);

  if (isPrimary && peer.threat !== 'LOST') {
    drawLeader(ctx, cx, cy, x, y, color);
  }

  if (peer.threat === 'DANGER') {
    const halo = 16 + 10 * (0.5 + 0.5 * Math.sin(ts / 130));
    const grad = ctx.createRadialGradient(x, y, 2, x, y, halo);
    grad.addColorStop(0, `${color}66`);
    grad.addColorStop(1, `${color}00`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, halo, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(x, y, 7.5, 0, Math.PI * 2);
  if (peer.threat === 'LOST') {
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = COLORS.bg;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.font = `600 11px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = color;
  ctx.fillText(peer.id, x, y - 13);

  ctx.textBaseline = 'top';
  ctx.font = `700 13px ${MONO}`;
  ctx.fillStyle = peer.threat === 'LOST' ? COLORS.lost : COLORS.text;
  ctx.fillText(peer.threat === 'LOST' ? '--' : `${shownDistance.toFixed(1)}m`, x, y + 12);

  ctx.globalAlpha = 1;
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rPx: (d: number) => number,
  peer: PeerView,
  color: string,
  fade: number,
) {
  const trail = peer.trail;
  if (trail.length < 2) return;

  const newest = trail[trail.length - 1].t;
  const span = newest - trail[0].t || 1;

  for (let i = 0; i < trail.length; i += 2) {
    const point = trail[i];
    const age = (newest - point.t) / span;
    const a = ((point.brg - 90) * Math.PI) / 180;
    const pr = rPx(point.d);
    ctx.globalAlpha = (1 - age) * 0.4 * fade;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx + pr * Math.cos(a), cy + pr * Math.sin(a), 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = fade;
}

function drawLeader(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  x: number,
  y: number,
  color: string,
) {
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(x, y);
  ctx.stroke();

  // Arrowhead pointing at the threat.
  const a = Math.atan2(y - cy, x - cx);
  const back = 14;
  const spread = 0.38;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - back * Math.cos(a - spread), y - back * Math.sin(a - spread));
  ctx.lineTo(x - back * Math.cos(a + spread), y - back * Math.sin(a + spread));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.75;
  ctx.fill();
  ctx.globalAlpha = 1;
}
