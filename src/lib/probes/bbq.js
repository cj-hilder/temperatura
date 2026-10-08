import { createSpikeFilter } from "./spikeFilter.js";

// BBQ — a commercial probe (Dialog DA14531), reverse-engineered from nRF
// Connect logs. Pure: notification parsing plus the driver descriptor. A BBQ
// disconnects from BLE while charging and reconnects when charging stops.

// The service is advertised (128-bit UUID list in the advertisement), so it
// works as a picker filter — the advertised name "BBQ" is far too generic to
// filter on.
export const SERVICE_UUID = "18424398-7cbc-11e9-8f9e-2a86e4085a59";
export const NOTIFY_CHAR_UUID = "772ae377-b3d2-ff8e-1042-5481d1e03456";

/**
 * One notification is raw bytes: the FIRST BYTE is the battery level as an
 * 8-bit integer 0-100 (not a character — it only looks like one in a hex
 * dump: 0x64 = 100 shows as "d", 0x57 = 87 as "W"), and the REST is the
 * temperature in °C as an ASCII decimal string. So `64-31-37-2E-36` is 100%
 * and 17.6 °C. A first byte over 100 isn't a percentage, so no battery is
 * reported for it; a remainder that isn't a decimal is "no usable reading".
 */
export function parseBbqNotification(bytes) {
  const battery = bytes.length > 0 && bytes[0] <= 100 ? bytes[0] : null;
  const text = new TextDecoder().decode(bytes.slice(1)).trim();
  const tempC = /^-?\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
  return { seq: null, tempC, battery, pressCount: null, probePresent: tempC != null, buttonHeld: false };
}

export const bbqDriver = {
  kind: "bbq",
  label: "BBQ",
  filters: [{ services: [SERVICE_UUID] }],
  serviceUuid: SERVICE_UUID,
  charUuid: NOTIFY_CHAR_UUID,
  hasButton: false,
  // Notifies when the value CHANGES, not at a steady rate (40 s+ of silence
  // with a steady temperature was observed), so silence can't mean loss —
  // only the connection dropping does.
  freshness: { type: "link" },
  // Its readings periodically dip low for one notification — see spikeFilter.js.
  createFilter: () => createSpikeFilter(),
  parse: (dataView) => parseBbqNotification(new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength)),
};
