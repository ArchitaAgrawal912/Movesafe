/*
 * MOVESAFE - Anchor Node  (this vehicle; USB-tethered to the cabin screen)
 * ------------------------------------------------------------------------
 * Listens for ESP-NOW beacons from tag nodes, records the RSSI of each
 * packet, and prints one JSON line per 100 ms over USB serial. The browser
 * HUD reads those lines with the Web Serial API.
 *
 * Deliberately dumb: it reports RAW RSSI and does no smoothing, filtering or
 * distance maths. All of that lives in the web app so the path-loss constants
 * can be calibrated live against a tape measure without a reflash. Firmware
 * you have to re-upload to tune is firmware you will not tune.
 *
 * Wire format, one line per frame, newline-terminated:
 *   {"t":18234,"self":"TRUCK-01","peers":[{"id":"TRUCK-02","rssi":-63,"age":41,"n":1203}]}
 *
 *   t     anchor uptime, ms
 *   rssi  raw RSSI of the most recent packet, dBm
 *   age   ms since that packet arrived
 *   n     packet counter; the app only consumes a sample when this advances,
 *         so a repeated reading is never fed into the filter twice
 *
 * Board:  any ESP32 / ESP32-S3 dev board
 * Core:   arduino-esp32 3.x  (2.x has a different recv callback signature and
 *                             gives no RSSI - see firmware/README.md)
 */

#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

// ---------------------------------------------------------------- settings

#define SELF_ID       "TRUCK-01"
#define WIFI_CHANNEL  1        // must match the tag node
#define REPORT_MS     100      // 10 Hz to the screen
#define PEER_TIMEOUT  3000     // drop a peer unheard for this long, ms
#define MAX_PEERS     8

// Cab buzzer. This is a hardware failsafe, not the main alert: it runs on raw
// RSSI with a fixed threshold and keeps sounding whether or not a laptop is
// plugged in. The screen alarm is the calibrated one and engages earlier, so
// the two together read as a two-stage warning - screen first, buzzer as the
// peer closes further. Raise BUZZER_RSSI to make it fire closer in.
#define BUZZER_PIN    13
#define BUZZER_RSSI   -65      // dBm; -65 measured at ~1 m on these boards

// ----------------------------------------------------------------- payload

typedef struct __attribute__((packed)) {
  char     id[12];
  uint32_t seq;
} MovesafeBeacon;

// The anchor broadcasts its own beacon as well as listening. It gains nothing
// from this itself - it is so the carried tag can measure the anchor and sound
// its own buzzer, since a tag that only transmitted could never measure
// anything. ESP-NOW does not loop a broadcast back to its sender, so this
// never pollutes our own peer table.
static const uint8_t BROADCAST_ADDR[6] = { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF };
static MovesafeBeacon selfBeacon;
static uint32_t       selfSeq = 0;

// ---------------------------------------------------------------- peer table

typedef struct {
  bool     used;
  char     id[12];
  int8_t   rssi;
  uint32_t lastSeen;   // millis()
  uint32_t count;      // packets heard
} PeerSlot;

static PeerSlot peers[MAX_PEERS];

// The receive callback runs on the WiFi task, not the loop task, so the table
// is guarded. The critical sections are a handful of instructions long.
static portMUX_TYPE peersMux = portMUX_INITIALIZER_UNLOCKED;

// ------------------------------------------------------------------ receive

void onBeacon(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  if (len < (int)sizeof(MovesafeBeacon)) return;

  MovesafeBeacon beacon;
  memcpy(&beacon, data, sizeof(beacon));
  beacon.id[sizeof(beacon.id) - 1] = '\0';

  // Per-packet RSSI. In core 3.x this rides along in the receive info; in
  // 2.x it is not exposed at all and needs a promiscuous-mode sniffer hack,
  // which is exactly why this sketch requires 3.x.
  const int8_t rssi = info->rx_ctrl->rssi;
  const uint32_t now = millis();

  portENTER_CRITICAL(&peersMux);

  int slot = -1;
  for (int i = 0; i < MAX_PEERS; i++) {
    if (peers[i].used && strcmp(peers[i].id, beacon.id) == 0) { slot = i; break; }
  }
  if (slot < 0) {
    for (int i = 0; i < MAX_PEERS; i++) {
      if (!peers[i].used) { slot = i; break; }
    }
    if (slot >= 0) {
      peers[slot].used  = true;
      peers[slot].count = 0;
      strncpy(peers[slot].id, beacon.id, sizeof(peers[slot].id) - 1);
      peers[slot].id[sizeof(peers[slot].id) - 1] = '\0';
    }
  }

  if (slot >= 0) {
    peers[slot].rssi     = rssi;
    peers[slot].lastSeen = now;
    peers[slot].count++;
  }

  portEXIT_CRITICAL(&peersMux);
}

// -------------------------------------------------------------------- init

void setup() {
  Serial.begin(115200);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  memset(peers, 0, sizeof(peers));

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  esp_wifi_set_channel(WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);

  if (esp_now_init() != ESP_OK) {
    // Emitted as valid JSON so the browser parser tolerates it rather than
    // choking on a stray plain-text line.
    Serial.println("{\"t\":0,\"self\":\"" SELF_ID "\",\"peers\":[],\"err\":\"esp_now_init\"}");
    while (true) delay(1000);
  }
  esp_now_register_recv_cb(onBeacon);

  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST_ADDR, 6);
  peer.channel = WIFI_CHANNEL;
  peer.encrypt = false;
  esp_now_add_peer(&peer);

  memset(&selfBeacon, 0, sizeof(selfBeacon));
  strncpy(selfBeacon.id, SELF_ID, sizeof(selfBeacon.id) - 1);

  Serial.println("{\"t\":0,\"self\":\"" SELF_ID "\",\"peers\":[],\"boot\":1}");
}

// -------------------------------------------------------------------- loop

void loop() {
  static uint32_t nextReport = 0;
  const uint32_t now = millis();
  if ((int32_t)(now - nextReport) < 0) return;
  nextReport = now + REPORT_MS;

  selfBeacon.seq = ++selfSeq;
  esp_now_send(BROADCAST_ADDR, (const uint8_t *)&selfBeacon, sizeof(selfBeacon));

  // Copy under lock, format outside it: Serial.write is far too slow to hold
  // a critical section across.
  PeerSlot snapshot[MAX_PEERS];
  portENTER_CRITICAL(&peersMux);
  memcpy(snapshot, peers, sizeof(snapshot));
  for (int i = 0; i < MAX_PEERS; i++) {
    if (peers[i].used && (now - peers[i].lastSeen) > PEER_TIMEOUT) peers[i].used = false;
  }
  portEXIT_CRITICAL(&peersMux);

  // Buzzer is driven here rather than in the receive callback: the callback
  // runs on the WiFi task and GPIO work does not belong there. A peer that has
  // gone quiet ages out of the table above, so silence on signal loss is free.
  bool tooClose = false;
  for (int i = 0; i < MAX_PEERS; i++) {
    if (!snapshot[i].used) continue;
    if ((now - snapshot[i].lastSeen) > PEER_TIMEOUT) continue;
    if (snapshot[i].rssi > BUZZER_RSSI) { tooClose = true; break; }
  }
  digitalWrite(BUZZER_PIN, tooClose ? HIGH : LOW);

  char line[512];
  int  n = snprintf(line, sizeof(line), "{\"t\":%lu,\"self\":\"%s\",\"peers\":[",
                    (unsigned long)now, SELF_ID);

  bool first = true;
  for (int i = 0; i < MAX_PEERS; i++) {
    if (!snapshot[i].used) continue;
    const uint32_t age = now - snapshot[i].lastSeen;
    if (age > PEER_TIMEOUT) continue;

    n += snprintf(line + n, sizeof(line) - n,
                  "%s{\"id\":\"%s\",\"rssi\":%d,\"age\":%lu,\"n\":%lu}",
                  first ? "" : ",",
                  snapshot[i].id,
                  (int)snapshot[i].rssi,
                  (unsigned long)age,
                  (unsigned long)snapshot[i].count);
    first = false;
    if (n > (int)sizeof(line) - 80) break;   // never overrun the buffer
  }

  snprintf(line + n, sizeof(line) - n, "]}");

  // Nothing else may ever print to Serial. Any stray debug line would land in
  // the middle of the stream; the app drops malformed lines, but you would be
  // silently throwing away telemetry.
  Serial.println(line);
}
