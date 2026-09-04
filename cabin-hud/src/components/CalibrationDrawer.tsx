import { useEffect, useRef, useState } from 'react';
import { THRESHOLDS } from '../alerts/threatState';
import { DEFAULT_CALIBRATION } from '../ranging/rssiToDistance';
import type { TelemetryEngine } from '../telemetry/engine';
import type { SimMode } from '../telemetry/simSource';
import type { Snapshot } from '../telemetry/types';
import { COLORS, THREAT_COLOR } from '../theme';

const CAPTURE_MS = 3000;
const CAPTURE_INTERVAL_MS = 100;

interface Props {
  engine: TelemetryEngine;
  snap: Snapshot;
  open: boolean;
  onClose: () => void;
}

/**
 * The panel that makes the 3 m threshold land where the tape measure says it
 * should.
 *
 * RSSI ranging is meaningless without a reference reading taken on the actual
 * boards, in the actual environment. Capturing that here rather than baking it
 * into firmware means recalibrating on site takes ten seconds instead of a
 * reflash.
 */
export function CalibrationDrawer({ engine, snap, open, onClose }: Props) {
  const [cal, setCal] = useState(engine.calibration);
  const [capturing, setCapturing] = useState(false);
  const [captureMsg, setCaptureMsg] = useState<string | null>(null);
  const [mode, setMode] = useState<SimMode>(engine.sim.mode);
  const [simDistance, setSimDistance] = useState(engine.sim.targetDistance);
  const [autoRamp, setAutoRamp] = useState(engine.sim.autoRamp);
  const [peerSpeed, setPeerSpeed] = useState(engine.sim.peerSpeed);
  const [passDistance, setPassDistance] = useState(engine.sim.passDistance);
  const [mySpeed, setMySpeed] = useState(engine.sim.mySpeedKmh);
  const samples = useRef<number[]>([]);

  const primary = snap.primary;

  // The simulator can be reconfigured from outside the drawer (URL params,
  // the auto-ramp moving on its own), so resync every time it opens rather
  // than trusting the values captured at mount.
  useEffect(() => {
    if (!open) return;
    setMode(engine.sim.mode);
    setSimDistance(engine.sim.targetDistance);
    setAutoRamp(engine.sim.autoRamp);
    setPeerSpeed(engine.sim.peerSpeed);
    setPassDistance(engine.sim.passDistance);
    setMySpeed(engine.sim.mySpeedKmh);
  }, [open, engine]);

  // The auto-ramp moves the slider on its own; mirror it so the control does
  // not look stuck.
  useEffect(() => {
    if (!open || !autoRamp) return;
    const id = window.setInterval(() => setSimDistance(engine.sim.targetDistance), 120);
    return () => window.clearInterval(id);
  }, [open, autoRamp, engine]);

  const apply = (next: typeof cal) => {
    setCal(next);
    engine.setCalibration(next);
  };

  const capture = () => {
    if (capturing) return;
    samples.current = [];
    setCapturing(true);
    setCaptureMsg(null);

    const id = window.setInterval(() => {
      const rssi = engine.referenceRssi();
      if (rssi !== null) samples.current.push(rssi);
    }, CAPTURE_INTERVAL_MS);

    window.setTimeout(() => {
      window.clearInterval(id);
      setCapturing(false);
      const collected = samples.current;
      if (collected.length < 5) {
        setCaptureMsg('No peer heard. Power up the tag node and try again.');
        return;
      }
      const mean = collected.reduce((a, b) => a + b, 0) / collected.length;
      apply({ ...cal, rssiAt1m: Math.round(mean * 10) / 10 });
      setCaptureMsg(`Reference set from ${collected.length} samples.`);
    }, CAPTURE_MS);
  };

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-20 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <aside
        className="relative flex h-full w-[360px] flex-col gap-5 overflow-y-auto border-l p-4"
        style={{ background: COLORS.panel, borderColor: COLORS.panelEdge }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-sm font-bold tracking-widest" style={{ color: COLORS.text }}>
            CALIBRATION
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer font-mono text-xs"
            style={{ color: COLORS.textDim }}
          >
            CLOSE ✕
          </button>
        </div>

        {/* Live readout ------------------------------------------------- */}
        <Section title="LIVE READOUT">
          {primary ? (
            <dl className="grid grid-cols-2 gap-y-1 font-mono text-xs">
              <Row label="Peer" value={primary.id} />
              <Row label="Raw RSSI" value={`${Math.round(primary.rssi)} dBm`} />
              <Row label="Median RSSI" value={`${primary.medianRssi.toFixed(1)} dBm`} />
              <Row label="Distance" value={`${primary.distance.toFixed(2)} m`} />
              <Row
                label="State"
                value={primary.threat}
                color={THREAT_COLOR[primary.threat]}
              />
              <Row label="Age" value={`${Math.round(primary.ageMs)} ms`} />
            </dl>
          ) : (
            <p className="font-mono text-xs" style={{ color: COLORS.textDim }}>
              No peer in range.
            </p>
          )}
        </Section>

        {/* Path-loss constants ------------------------------------------ */}
        <Section title="PATH-LOSS MODEL">
          <Slider
            label="RSSI @ 1 m"
            value={cal.rssiAt1m}
            min={-80}
            max={-20}
            step={0.5}
            suffix=" dBm"
            onChange={(v) => apply({ ...cal, rssiAt1m: v })}
          />
          <Slider
            label="Path-loss exponent n"
            value={cal.pathLoss}
            min={1.5}
            max={4}
            step={0.05}
            onChange={(v) => apply({ ...cal, pathLoss: v })}
          />

          <button
            type="button"
            onClick={capture}
            disabled={capturing}
            className="mt-2 w-full cursor-pointer rounded border px-3 py-2 font-mono text-xs font-bold tracking-wider disabled:cursor-wait"
            style={{
              borderColor: COLORS.accent,
              color: COLORS.accent,
              background: `${COLORS.accent}14`,
            }}
          >
            {capturing ? 'SAMPLING…' : 'CAPTURE REFERENCE @ 1 m'}
          </button>
          <p className="mt-1 text-[11px] leading-snug" style={{ color: COLORS.textDim }}>
            Hold the tag node exactly 1 m away, clear of your body, then press. Averages{' '}
            {CAPTURE_MS / 1000} s.
          </p>
          {captureMsg && (
            <p className="mt-1 font-mono text-[11px]" style={{ color: COLORS.safe }}>
              {captureMsg}
            </p>
          )}

          <button
            type="button"
            onClick={() => apply({ ...DEFAULT_CALIBRATION })}
            className="mt-2 cursor-pointer font-mono text-[11px] underline"
            style={{ color: COLORS.textDim }}
          >
            reset to defaults
          </button>
        </Section>

        {/* Thresholds --------------------------------------------------- */}
        <Section title="ALERT THRESHOLDS">
          <dl className="grid grid-cols-2 gap-y-1 font-mono text-xs">
            <Row label="Danger at" value={`≤ ${THRESHOLDS.danger} m`} color={COLORS.danger} />
            <Row label="Clears at" value={`≥ ${THRESHOLDS.dangerClear} m`} color={COLORS.safe} />
            <Row label="Caution at" value={`≤ ${THRESHOLDS.caution} m`} color={COLORS.caution} />
            <Row label="Link lost" value={`${THRESHOLDS.lostMs} ms`} />
          </dl>
          <p className="mt-1 text-[11px] leading-snug" style={{ color: COLORS.textDim }}>
            The gap between danger and clear is deliberate: without it, RSSI noise makes the alert
            strobe on and off at the boundary. Edit in{' '}
            <code style={{ color: COLORS.text }}>alerts/threatState.ts</code>.
          </p>
        </Section>

        {/* Simulator ---------------------------------------------------- */}
        {snap.sourceKind === 'sim' && (
          <Section title="SIMULATOR">
            <div className="mb-1 flex gap-2">
              <ModeButton
                label="CROSSING"
                active={mode === 'crossing'}
                onClick={() => {
                  setMode('crossing');
                  engine.sim.mode = 'crossing';
                }}
              />
              <ModeButton
                label="MANUAL"
                active={mode === 'manual'}
                onClick={() => {
                  setMode('manual');
                  engine.sim.mode = 'manual';
                }}
              />
            </div>

            {mode === 'crossing' ? (
              <>
                <p className="text-[11px] leading-snug" style={{ color: COLORS.textDim }}>
                  One vehicle tracking right to left across your bow at constant speed.
                </p>
                <Slider
                  label="Their speed"
                  value={peerSpeed}
                  min={0.5}
                  max={8}
                  step={0.1}
                  suffix=" m/s"
                  onChange={(v) => {
                    setPeerSpeed(v);
                    engine.sim.peerSpeed = v;
                  }}
                />
                <Slider
                  label="Passes this close"
                  value={passDistance}
                  min={0.5}
                  max={12}
                  step={0.1}
                  suffix=" m"
                  onChange={(v) => {
                    setPassDistance(v);
                    engine.sim.passDistance = v;
                  }}
                />
                <Slider
                  label="My speed (telemetry only)"
                  value={mySpeed}
                  min={0}
                  max={40}
                  step={1}
                  suffix=" km/h"
                  onChange={(v) => {
                    setMySpeed(v);
                    engine.sim.mySpeedKmh = v;
                  }}
                />
                <p className="mt-1 text-[11px] leading-snug" style={{ color: COLORS.textDim }}>
                  Set "passes this close" under {THRESHOLDS.danger} m to trip the alarm on every
                  lap.
                </p>
              </>
            ) : (
              <>
                <p className="text-[11px] leading-snug" style={{ color: COLORS.textDim }}>
                  Fixed distance dead ahead, no bearing and no reported speed — exactly what the
                  current plain-ESP32 hardware provides.
                </p>
                <Slider
                  label="TRUCK-02 distance"
                  value={simDistance}
                  min={0.5}
                  max={25}
                  step={0.1}
                  suffix=" m"
                  disabled={autoRamp}
                  onChange={(v) => {
                    setSimDistance(v);
                    engine.sim.targetDistance = v;
                  }}
                />
                <Toggle
                  label="Auto-approach sweep (1 m/s)"
                  checked={autoRamp}
                  onChange={(v) => {
                    setAutoRamp(v);
                    engine.sim.autoRamp = v;
                  }}
                />
              </>
            )}
          </Section>
        )}
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3
        className="mb-2 border-b pb-1 font-mono text-[10px] font-bold tracking-[0.2em]"
        style={{ color: COLORS.textDim, borderColor: COLORS.panelEdge }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <>
      <dt style={{ color: COLORS.textDim }}>{label}</dt>
      <dd className="text-right tabular-nums" style={{ color: color ?? COLORS.text }}>
        {value}
      </dd>
    </>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className="mt-2 block" style={{ opacity: disabled ? 0.45 : 1 }}>
      <div className="flex justify-between font-mono text-[11px]">
        <span style={{ color: COLORS.textDim }}>{label}</span>
        <span className="tabular-nums" style={{ color: COLORS.text }}>
          {value.toFixed(step < 0.1 ? 2 : 1)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-sky-400"
      />
    </label>
  );
}

function ModeButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 cursor-pointer rounded border px-2 py-1 font-mono text-[11px] font-bold tracking-wider"
      style={{
        borderColor: active ? COLORS.accent : COLORS.panelEdge,
        color: active ? COLORS.accent : COLORS.textDim,
        background: active ? `${COLORS.accent}14` : 'transparent',
      }}
    >
      {label}
    </button>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="mt-2 flex cursor-pointer items-center gap-2 font-mono text-[11px]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-sky-400"
      />
      <span style={{ color: COLORS.textDim }}>{label}</span>
    </label>
  );
}
