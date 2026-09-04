import { useCallback, useEffect, useState } from 'react';
import { unlockAudio, useBeeper } from './alerts/useBeeper';
import { CalibrationDrawer } from './components/CalibrationDrawer';
import { DEMO_HAZARDS, HazardCard, SpeedLimit } from './components/HazardCard';
import { RadarCanvas } from './components/RadarCanvas';
import { StatusBar } from './components/StatusBar';
import { ThreatPanel } from './components/ThreatPanel';
import { SerialSource } from './telemetry/serialSource';
import { useEngine, useSnapshot } from './telemetry/useTelemetry';
import { COLORS, THREAT_COLOR, THREAT_LABEL } from './theme';

export default function App() {
  const engine = useEngine();
  const snap = useSnapshot(engine);
  const [muted, setMuted] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(
    () => new URLSearchParams(window.location.search).get('cal') === '1',
  );

  const primary = snap.primary;
  useBeeper(primary?.threat ?? 'LOST', primary?.distance ?? 99, muted);

  // Audio must be started from a real gesture, so every connect path unlocks
  // it. A HUD that shows red but stays silent is a failure mode worth
  // designing out.
  const connect = useCallback(
    (kind: 'serial' | 'sim') => {
      unlockAudio();
      void engine.connect(kind);
    },
    [engine],
  );

  // ?sim=1 boots straight into the simulator, for kiosk-style demos and for
  // screenshotting the HUD. Optional &d=2.4 sets the starting distance and
  // &ramp=1 starts the auto-approach sweep. &cal=1 (handled above, and valid
  // on its own) deep-links straight to the calibration drawer. Audio stays
  // locked until a real click, because browsers require a gesture - the
  // visual alert still works.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('sim') !== '1') return;
    // Passing a fixed distance implies the manual scenario; otherwise the
    // default crossing-vehicle scenario runs.
    const d = Number(params.get('d'));
    if (Number.isFinite(d) && d > 0) {
      engine.sim.mode = 'manual';
      engine.sim.targetDistance = d;
    }
    if (params.get('ramp') === '1') {
      engine.sim.mode = 'manual';
      engine.sim.autoRamp = true;
    }
    const pass = Number(params.get('pass'));
    if (Number.isFinite(pass) && pass > 0) engine.sim.passDistance = pass;
    const pspeed = Number(params.get('pspeed'));
    if (Number.isFinite(pspeed) && pspeed > 0) engine.sim.peerSpeed = pspeed;
    void engine.connect('sim');
  }, [engine]);

  const banner = primary && primary.threat === 'DANGER' ? primary : null;

  return (
    <div
      className="relative flex h-screen w-screen flex-col overflow-hidden"
      style={{ background: COLORS.bg, color: COLORS.text }}
    >
      <StatusBar
        snap={snap}
        muted={muted}
        onToggleMute={() => {
          unlockAudio();
          setMuted((m) => !m);
        }}
        onConnectSerial={() => connect('serial')}
        onConnectSim={() => connect('sim')}
        onDisconnect={() => void engine.disconnect()}
        onOpenCalibration={() => setDrawerOpen(true)}
      />

      <main className="flex min-h-0 flex-1">
        {/* Left rail: speed limit and V2I hazard alerts */}
        <aside
          className="flex w-[250px] shrink-0 flex-col gap-4 border-r p-3"
          style={{ borderColor: COLORS.panelEdge }}
        >
          <SpeedLimit kmh={20} />
          <div className="flex flex-col gap-2">
            <div className="font-mono text-[10px] tracking-[0.2em]" style={{ color: COLORS.textDim }}>
              ENVIRONMENTAL ALERTS
            </div>
            {DEMO_HAZARDS.map((h) => (
              <HazardCard key={h.id} hazard={h} />
            ))}
            <p className="mt-1 text-[10px] leading-snug" style={{ color: COLORS.textDim }}>
              Placeholder feed. Wire to the solar V2I nodes via <code>hazards[]</code>.
            </p>
          </div>

          <div className="mt-auto flex flex-col gap-1">
            {snap.peers.map((p) => (
              <div key={p.id} className="flex items-center gap-2 font-mono text-[11px]">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: THREAT_COLOR[p.threat] }}
                />
                <span className="flex-1 truncate" style={{ color: COLORS.textDim }}>
                  {p.id}
                </span>
                <span className="tabular-nums" style={{ color: THREAT_COLOR[p.threat] }}>
                  {p.threat === 'LOST' ? '--' : `${p.distance.toFixed(1)}m`}
                </span>
              </div>
            ))}
          </div>
        </aside>

        {/* Radar */}
        <section className="relative min-w-0 flex-1">
          <RadarCanvas engine={engine} />

          <div className="pointer-events-none absolute top-3 right-3">
            <ThreatPanel peer={primary} selfSpeedKmh={snap.selfSpeedKmh} />
          </div>

          {banner && (
            <div
              className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded px-6 py-2 text-2xl font-black tracking-[0.25em]"
              style={{
                background: `${COLORS.danger}22`,
                color: COLORS.danger,
                border: `2px solid ${COLORS.danger}`,
                boxShadow: `0 0 28px ${COLORS.danger}55`,
              }}
            >
              {THREAT_LABEL.DANGER} — {banner.distance.toFixed(1)} m
            </div>
          )}

          {snap.status !== 'active' && <ConnectOverlay onSim={() => connect('sim')} />}
        </section>
      </main>

      <CalibrationDrawer
        engine={engine}
        snap={snap}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}

function ConnectOverlay({ onSim }: { onSim: () => void }) {
  const serialOk = SerialSource.isSupported();
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/70 px-6">
      <div
        className="max-w-md rounded-lg border p-5 text-center"
        style={{ background: COLORS.panel, borderColor: COLORS.panelEdge }}
      >
        <div className="font-mono text-sm font-bold tracking-widest" style={{ color: COLORS.text }}>
          NO TELEMETRY SOURCE
        </div>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: COLORS.textDim }}>
          {serialOk ? (
            <>
              Plug in the anchor ESP32 and press <strong>CONNECT ESP32</strong>. Close the Arduino
              Serial Monitor first — it holds the port open.
            </>
          ) : (
            <>
              This browser has no Web Serial support. Use Chrome or Edge on desktop to talk to the
              ESP32, or run the simulator.
            </>
          )}
        </p>
        <button
          type="button"
          onClick={onSim}
          className="mt-4 cursor-pointer rounded border px-4 py-2 font-mono text-xs font-bold tracking-wider"
          style={{ borderColor: COLORS.accent, color: COLORS.accent, background: `${COLORS.accent}14` }}
        >
          RUN SIMULATOR INSTEAD
        </button>
      </div>
    </div>
  );
}
