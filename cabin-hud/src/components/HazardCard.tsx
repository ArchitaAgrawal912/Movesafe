import { COLORS } from '../theme';

/**
 * Environmental alerts from the solar V2I hazard nodes.
 *
 * The nodes themselves are not built yet, so these are driven by a static
 * array for now. The shape is the one the real LoRa payload will take, so
 * wiring them up later is a data change, not a UI change.
 */
export interface Hazard {
  id: string;
  title: string;
  detail: string;
  severity: 'info' | 'warn';
}

export const DEMO_HAZARDS: Hazard[] = [
  { id: 'H1', title: 'BLIND CURVE AHEAD', detail: 'Node V2I-04 · 220 m', severity: 'warn' },
  { id: 'H2', title: 'WET HAUL SURFACE', detail: 'Traction 34% · Bench 7', severity: 'warn' },
];

export function HazardCard({ hazard }: { hazard: Hazard }) {
  const color = hazard.severity === 'warn' ? COLORS.caution : COLORS.accent;
  return (
    <div
      className="rounded-r-md border-l-4 py-2 pr-3 pl-3"
      style={{ borderColor: color, background: `${color}14` }}
    >
      <div className="flex items-start gap-2">
        <WarnGlyph color={color} />
        <div className="min-w-0">
          <div className="text-[13px] leading-tight font-bold" style={{ color }}>
            {hazard.title}
          </div>
          <div className="mt-0.5 font-mono text-[10px]" style={{ color: COLORS.textDim }}>
            {hazard.detail}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SpeedLimit({ kmh }: { kmh: number }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[5px] bg-white"
        style={{ borderColor: COLORS.danger }}
      >
        <span className="font-mono text-xl leading-none font-black text-black">{kmh}</span>
      </div>
      <div>
        <div className="font-mono text-[10px] tracking-widest" style={{ color: COLORS.textDim }}>
          MAX SPEED
        </div>
        <div className="font-mono text-sm font-bold" style={{ color: COLORS.text }}>
          {kmh} km/h
        </div>
      </div>
    </div>
  );
}

function WarnGlyph({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" className="mt-0.5 shrink-0" aria-hidden="true">
      <path d="M12 3 L22 20 H2 Z" fill={color} />
      <path d="M12 9 v5" stroke="#000" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1.2" fill="#000" />
    </svg>
  );
}
