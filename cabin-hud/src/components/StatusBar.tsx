import type { Snapshot } from '../telemetry/types';
import { COLORS } from '../theme';

interface Props {
  snap: Snapshot;
  muted: boolean;
  onToggleMute: () => void;
  onConnectSerial: () => void;
  onConnectSim: () => void;
  onDisconnect: () => void;
  onOpenCalibration: () => void;
}

export function StatusBar({
  snap,
  muted,
  onToggleMute,
  onConnectSerial,
  onConnectSim,
  onDisconnect,
  onOpenCalibration,
}: Props) {
  const active = snap.status === 'active';
  const linkColor = active ? COLORS.safe : snap.status === 'error' ? COLORS.danger : COLORS.lost;

  return (
    <header
      className="flex shrink-0 items-center gap-4 border-b px-4 py-2"
      style={{ background: COLORS.panel, borderColor: COLORS.panelEdge }}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-base font-black tracking-[0.18em]" style={{ color: COLORS.text }}>
          MOVESAFE
        </span>
        <span className="font-mono text-[10px] tracking-widest" style={{ color: COLORS.accent }}>
          AEGIS
        </span>
      </div>

      <div className="flex items-center gap-2 font-mono text-xs">
        <span style={{ color: COLORS.textDim }}>V2V LINK</span>
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: linkColor, boxShadow: active ? `0 0 8px ${linkColor}` : 'none' }}
        />
        <span className="font-bold tracking-wider" style={{ color: linkColor }}>
          {statusLabel(snap)}
        </span>
      </div>

      <div className="font-mono text-xs" style={{ color: COLORS.textDim }}>
        SELF <span style={{ color: COLORS.text }}>{snap.self}</span>
        <span className="mx-2">·</span>
        PEERS <span style={{ color: COLORS.text }}>{snap.peers.length}</span>
      </div>

      {snap.sourceKind === 'sim' && active && (
        <span
          className="rounded px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest"
          style={{ background: `${COLORS.caution}22`, color: COLORS.caution }}
        >
          SIMULATED
        </span>
      )}

      {snap.error && (
        <span className="truncate font-mono text-xs" style={{ color: COLORS.danger }}>
          {snap.error}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Button onClick={onToggleMute} active={!muted}>
          {muted ? 'ALARM OFF' : 'ALARM ON'}
        </Button>
        <Button onClick={onOpenCalibration}>CALIBRATE</Button>
        {active ? (
          <Button onClick={onDisconnect} danger>
            DISCONNECT
          </Button>
        ) : (
          <>
            <Button onClick={onConnectSim}>SIMULATOR</Button>
            <Button onClick={onConnectSerial} primary>
              CONNECT ESP32
            </Button>
          </>
        )}
      </div>
    </header>
  );
}

function statusLabel(snap: Snapshot): string {
  switch (snap.status) {
    case 'active':
      return 'ACTIVE';
    case 'connecting':
      return 'CONNECTING';
    case 'error':
      return 'FAULT';
    case 'unsupported':
      return 'UNSUPPORTED';
    default:
      return 'OFFLINE';
  }
}

function Button({
  children,
  onClick,
  primary,
  danger,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
  active?: boolean;
}) {
  const accent = danger ? COLORS.danger : primary ? COLORS.accent : COLORS.textDim;
  const on = primary || danger || active;
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded border px-2.5 py-1 font-mono text-[11px] font-bold tracking-wider transition-colors"
      style={{
        borderColor: on ? accent : COLORS.panelEdge,
        color: on ? accent : COLORS.textDim,
        background: on ? `${accent}14` : 'transparent',
      }}
    >
      {children}
    </button>
  );
}
