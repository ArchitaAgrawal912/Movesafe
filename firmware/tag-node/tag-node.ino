/*
 * MOVESAFE - Tag Node  (the "other vehicle")
 * ------------------------------------------------------------------------
 * Broadcasts a tiny ESP-NOW beacon several times a second. That is its whole
 * job. The anchor node hears these packets and reads their RSSI.
 *
 * ESP-NOW is used rather than plain WiFi because it is connectionless and
 * peer-to-peer: no router, no access point, no association handshake, no
 * cellular. That is the same decentralised V2V property the real UWB link
 * will have, so the system architecture does not change when the DW3000
 * boards arrive - only the ranging method does.
 *
 * Board:  any ESP32 / ESP32-S3 dev board
 * Core:   arduino-esp32 3.x   (see firmware/README.md - 2.x will not compile)
 * Power:  USB power bank is fine; this node is carried, not tethered.
 */

#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

// ---------------------------------------------------------------- settings

#define NODE_ID        "TRUCK-02"   // max 11 chars; must match nothing else on site
#define WIFI_CHANNEL   1            // must be identical on tag and anchor
#define TX_INTERVAL_MS 50           // 20 Hz

#ifndef LED_BUILTIN
#define LED_BUILTIN 2
#endif

// ----------------------------------------------------------------- payload

// Packed so the byte layout is identical on both boards regardless of how
// the compiler would otherwise pad it.
typedef struct __attribute__((packed)) {
  char     id[12];
  uint32_t seq;
} MovesafeBeacon;

static const uint8_t BROADCAST_ADDR[6] = { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF };

static MovesafeBeacon beacon;
static uint32_t seq = 0;

// -------------------------------------------------------------------- init

void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);

  // STA mode with no connection: the radio is up, but we never associate
  // with an access point. ESP-NOW does not need one.
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  esp_wifi_set_channel(WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);

  if (esp_now_init() != ESP_OK) {
    Serial.println("[tag] esp_now_init failed");
    while (true) {
      digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));
      delay(100);
    }
  }

  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST_ADDR, 6);
  peer.channel = WIFI_CHANNEL;
  peer.encrypt = false;
  if (esp_now_add_peer(&peer) != ESP_OK) {
    Serial.println("[tag] esp_now_add_peer failed");
  }

  memset(&beacon, 0, sizeof(beacon));
  strncpy(beacon.id, NODE_ID, sizeof(beacon.id) - 1);

  Serial.print("[tag] broadcasting as ");
  Serial.print(NODE_ID);
  Serial.print(" on channel ");
  Serial.println(WIFI_CHANNEL);
  Serial.print("[tag] MAC ");
  Serial.println(WiFi.macAddress());
}

// -------------------------------------------------------------------- loop

void loop() {
  beacon.seq = ++seq;
  esp_now_send(BROADCAST_ADDR, (const uint8_t *)&beacon, sizeof(beacon));

  // Visible heartbeat, so you can tell the node is alive while carrying it
  // around with no serial monitor attached.
  digitalWrite(LED_BUILTIN, (seq % 10) < 2);

  delay(TX_INTERVAL_MS);
}
