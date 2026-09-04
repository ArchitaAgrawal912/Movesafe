# MOVESAFE firmware

Two sketches, two ESP32 boards.

| Sketch | Role | Power |
|---|---|---|
| `tag-node/` | The **other vehicle**. Broadcasts an ESP-NOW beacon 20×/s, and sounds its buzzer on what it hears back. | Power bank — you carry this one around. |
| `anchor-node/` | **This vehicle**. Hears beacons, reads their RSSI, prints JSON over USB, sounds its buzzer, and broadcasts 10×/s so the tag has something to measure. | USB cable to the laptop running the HUD. |

Both boards broadcast and both listen. The anchor gains nothing from its own
transmission — it is there so the carried tag can measure the anchor and sound
its buzzer, since a node that only transmitted could never measure anything.

## Wiring

One buzzer per board, on **GPIO13** (`BUZZER_PIN`), driven HIGH when a peer is
closer than `BUZZER_RSSI` (−65 dBm, about 1 m on these boards). An active
buzzer wired GPIO13 → buzzer + , buzzer − → GND. Raise `BUZZER_RSSI` to make it
fire closer in; it is a `#define` at the top of each sketch and both should
match. If a board has no buzzer fitted, leave it — the pin just toggles.

## Requirements

- **arduino-esp32 core 3.x.** This is not optional. Core 2.x uses a different
  ESP-NOW receive callback signature that exposes no RSSI at all, and getting
  it there needs a promiscuous-mode sniffer hack. On 3.x the value rides along
  in `info->rx_ctrl->rssi` and the sketch compiles as written.
  - Arduino IDE → Tools → Board → Boards Manager → "esp32 by Espressif Systems" → **3.x**
- No external libraries. `WiFi.h`, `esp_now.h` and `esp_wifi.h` ship with the core.

## Flashing

1. Open `tag-node/tag-node.ino`, select your board, upload. Its LED blinks once
   it is broadcasting.
2. Open `anchor-node/anchor-node.ino`, select the **other** board, upload.

Both sketches use `WIFI_CHANNEL 1`. It must be identical on both — ESP-NOW peers
on different channels never hear each other. If you change it, change it twice.

Node names are `#define`s at the top of each sketch (`TRUCK-01`, `TRUCK-02`).
Change them for a third node; the anchor tracks up to 8 peers by name.

## Checking it works, before involving the browser

Open the Arduino Serial Monitor **on the anchor**, at 115200 baud. You should
see one line per ~100 ms:

```
{"t":18234,"self":"TRUCK-01","peers":[{"id":"TRUCK-02","rssi":-63,"age":41,"n":1203}]}
```

- `rssi` should fall as you walk the tag away — roughly −45 dBm at 1 m to
  −75 dBm at 15 m. If it does not move, the tag is not being heard.
- Power the tag off: the peer disappears from `peers` within 3 s.
- Empty `peers[]` forever means the two boards are on different channels, or
  the tag is not running.

**Then close the Serial Monitor.** The port is exclusive — the browser cannot
open it while the IDE holds it, and that is the single most common reason the
HUD will not connect.

## Design notes

**Why ESP-NOW rather than WiFi or BLE.** It is connectionless and peer-to-peer:
no router, no access point, no association, no cellular. That is the same
decentralised V2V property the real UWB link will have, so nothing about the
system architecture changes when the DW3000 boards arrive — only the ranging
method does.

**Why the firmware does almost no maths.** It reports raw RSSI and nothing else.
Filtering, path-loss conversion and the alert thresholds live in the web app,
where they can be tuned live against a tape measure. Firmware you have to
re-upload to tune is firmware you will not tune.

The buzzer is the one exception, and it is deliberately crude: one raw RSSI
comparison, no filtering, no hysteresis. It is a failsafe that has to work when
no laptop is attached, so it cannot depend on anything running in a browser.
The calibrated alert is still the screen's.

**Why `n` is in the payload.** It is a packet counter. The anchor keeps
reporting its last reading at 10 Hz even when no new packet has arrived; the
app only feeds a sample into the filter when `n` advances, so a repeated
reading is never counted twice.

**Never add a `Serial.print` to the anchor.** Anything that is not a JSON line
lands in the middle of the telemetry stream. The app drops malformed lines
rather than crashing, but you would be silently throwing telemetry away.

## Replacing RSSI with real UWB

When the MaUWB ESP32-S3 (DW3000) boards arrive, the anchor should emit a
`dist` field in metres alongside (or instead of) `rssi`:

```json
{"id":"TRUCK-02","rssi":-63,"age":41,"n":1203,"dist":4.12}
```

The app already prefers `dist` over its own RSSI estimate when present — see
`cabin-hud/src/telemetry/engine.ts`. There is a `brg` field reserved for
bearing in degrees too, for when an IMU compass is added. Neither needs a UI
change.
