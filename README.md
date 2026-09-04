# MOVESAFE — In-Cabin Driver HUD

SIH 2026 · PS 26007 · Team Aegis
*Safe and Efficient Operation of Mine Vehicles in Fog and Low-Visibility Conditions*

A V2V proximity radar for the cab of an open-cast mine haul truck. Other
vehicles appear as dots on a forward-looking radar with live distance and
time-to-collision. Inside 3 m the dot goes red and a proximity alarm sounds;
back outside it, green.

```
ESP32 #2  "TRUCK-02"  (tag — carried, battery powered)
    │  ESP-NOW broadcast @20 Hz
    ▼
ESP32 #1  "TRUCK-01"  (anchor — USB to the laptop)
    │  reads packet RSSI, one JSON line per 100 ms
    ▼  USB serial @115200
Browser  ── Web Serial ──▶ filter ──▶ distance ──▶ radar + alarm
```

## Quick start

```bash
cd cabin-hud
npm install
npm run dev            # http://localhost:5173
```

Chrome or Edge on desktop — Web Serial exists in neither Firefox nor Safari.

**With no hardware:** click **SIMULATOR**, or open `http://localhost:5173/?sim=1`.
One vehicle tracks right to left across your bow, passing 1.5 m in front — it
goes red and sounds the alarm inside 3 m, green outside it, and loops. Click
once first to arm the audio; browsers block sound before a gesture.

Open **CALIBRATE** to change its speed, how close it passes, or your own
speedometer reading. The **MANUAL** tab there swaps it for a fixed distance
dead ahead, which is what you want when pinning the threshold under test.

**With hardware:** flash both boards (see [firmware/README.md](firmware/README.md)),
close the Arduino Serial Monitor, then click **CONNECT ESP32** and pick the port.

### URL parameters

| Param | Effect |
|---|---|
| `?sim=1` | Boot straight into the simulator (crossing vehicle) |
| `&pass=1.5` | How close the crossing vehicle comes, metres |
| `&pspeed=2` | Its crossing speed, m/s |
| `&d=2.4` | Manual scenario instead: fixed distance dead ahead |
| `&ramp=1` | Manual scenario with an auto-approach sweep at 1 m/s |
| `&cal=1` | Open the calibration drawer immediately |

## What the panel shows

| Field | Where it comes from |
|---|---|
| **DISTANCE** | Filtered range estimate |
| **COLLIDE IN** | Time to closest approach. Labelled *CLOSEST IN* when the predicted miss clears the 3 m radius |
| **MISS BY** | Predicted closest-approach distance |
| **MY SPEED** | Own GPS, forwarded by the anchor. **Dash on the current hardware** — a plain ESP32 has no speed source |
| **THEIR SPEED** | Broadcast by the peer. Same caveat: needs GPS on the tag node |
| **CLOSING** | Range rate, derived from ranging alone — works on the current hardware |

Time-to-collision is time to *closest approach*, not time until the range hits
zero, because those differ on a crossing track: a vehicle passing tangentially
has a range rate that decays to zero at its nearest point without ever
reaching you. Tracking relative position in 2D rather than as a bare range is
what makes that distinction possible. With no bearing source the track sits on
a single axis and the maths collapses to the range-rate answer, so one code
path serves both today's hardware and a future UWB + compass build.

## Calibrate before you trust the 3 m line

RSSI ranging is meaningless without a reference reading taken on *your* boards
in *your* environment. It takes ten seconds:

1. Connect, open **CALIBRATE**.
2. Hold the tag node exactly 1 m from the anchor, clear of your body, and press
   **CAPTURE REFERENCE @ 1 m**. It averages 3 s.
3. Step back to a tape-measured 3 m and nudge **path-loss exponent n** until the
   readout says ≈3.0. Higher `n` shrinks reported distance.

Settings persist in `localStorage`.

## What the accuracy actually is

Measured against simulated noise matching what these radios produce (±2.5 dB):

| True distance | Std. dev. | Observed spread |
|---|---|---|
| 2.2 m | 0.21 m | 1.6 – 3.0 m |
| 3.0 m | 0.34 m | 2.2 – 4.3 m |
| 6 m | 0.60 m | 4.4 – 8.2 m |
| 12 m | 1.09 m | 9.0 – 15.8 m |

Error is multiplicative — it grows with range. On a 1 m/s approach the alarm
engages at a true **2.4–3.2 m**. Body-blocking the tag shifts it noticeably;
that is RSSI physics, not a bug, and it is exactly the limitation UWB removes.

Three mechanisms make a threshold usable on top of that noise:

- **Median + EMA filtering** on raw RSSI (`src/ranging/filter.ts`).
- **Lag compensation.** Smoothing puts the estimate ~0.5 s behind reality,
  which made the alarm fire at 2.1 m instead of 3.0 m. The measured closing
  speed projects that lag back out.
- **Hysteresis plus an asymmetric debounce** (`src/alerts/threatState.ts`).
  Hysteresis alone was not enough — a peer parked at 3.0 m still flipped ~26
  times a minute. Requiring a level to persist (150 ms to escalate, 2000 ms to
  relax) takes that to zero. Red engages almost instantly; clearing red takes
  two seconds of sustained distance.

## Tuning

| What | Where |
|---|---|
| Alert distances, debounce timings | `src/alerts/threatState.ts` → `THRESHOLDS`, `DEBOUNCE` |
| Filter window, EMA, lag compensation | `src/ranging/filter.ts` |
| Radar range, scale curve, colours | `src/components/RadarCanvas.tsx`, `src/theme.ts` |
| Alarm tone and repeat rate | `src/alerts/useBeeper.ts` |

## Layout

```
cabin-hud/src/
  telemetry/    types · engine · serialSource · simSource   ← the hardware seam
  ranging/      rssiToDistance · filter
  alerts/       threatState · useBeeper
  components/   RadarCanvas · StatusBar · ThreatPanel · HazardCard · CalibrationDrawer
firmware/
  tag-node/     ESP-NOW broadcaster
  anchor-node/  ESP-NOW receiver → JSON over USB
```

`TelemetrySource` (`src/telemetry/types.ts`) is the seam that keeps the UI
hardware-agnostic. Everything above it is unaware of whether it is fed by
serial, the simulator, or something else.

## Known limitations

- **No bearing.** A single-antenna ESP32 cannot measure direction, so peers
  render dead ahead. The `brg` field exists in the wire format and the radar
  already plots by it — an IMU compass fills it in with no UI change.
- **Distance is estimated, not ranged.** See the accuracy table above.
- **Chrome/Edge only**, and the page must be served over `localhost` or HTTPS.
- **One consumer per serial port.** Close the Arduino Serial Monitor first.

## Not built yet

FastAPI backend, PostgreSQL near-miss log, dispatcher dashboard, solar V2I
hazard nodes, LoRa, real UWB ranging, the 3.5" TFT port. Each has a seam
waiting for it: `TelemetrySource`, the `dist`/`brg` wire fields, and the
`hazards[]` array behind the environmental alert cards.
