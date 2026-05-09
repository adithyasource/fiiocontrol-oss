import { REV_TYPE_MAP, TYPE_MAP } from "../consts";
import { sleep } from "../utils";

export const fiioBTR17 = {
  id: "fiio-btr17",
  name: "FiiO BTR17",
  filters: [{ vendorId: 0x2972 }], // any FiiO device
  reportId: 7,
  bandCount: 11,
  minMasterGain: -24,
  maxMasterGain: 12,
  defaultBands: [
    { type: "PK", gain: 0, freq: 32, q: 1.0 },
    { type: "PK", gain: 0, freq: 64, q: 1.0 },
    { type: "PK", gain: 0, freq: 125, q: 1.0 },
    { type: "PK", gain: 0, freq: 250, q: 1.0 },
    { type: "PK", gain: 0, freq: 500, q: 1.0 },
    { type: "PK", gain: 0, freq: 1000, q: 1.0 },
    { type: "PK", gain: 0, freq: 2000, q: 1.0 },
    { type: "PK", gain: 0, freq: 4000, q: 1.0 },
    { type: "PK", gain: 0, freq: 8000, q: 1.0 },
    { type: "PK", gain: 0, freq: 10100, q: 1.0 },
    { type: "PK", gain: 0, freq: 16000, q: 1.0 },
  ],

  supports(device) {
    return device.vendorId === 0x2972 && device.productId === 136;
  },

  parseInputReport(data) {
    const cmd = data[4];

    // Master gain response (cmd 22, byte 5 = 1 means response)
    // data[6] is an unsigned byte with a 164 offset: 164 = 0 dB
    // Each step = 16 units
    // Note: formula may need refinement — only 0 dB point confirmed
    if (cmd === 22 && data[5] === 1) {
      const diff = data[6] - 164;
      return { type: "masterGain", value: Number.parseFloat((diff / 16).toFixed(1)) };
    }

    // Band response (cmd 21, byte 5 = 8 means response)
    if (cmd === 21 && data[5] === 8) {
      const bandIdx = data[6];
      const rawGain = (data[7] << 8) | data[8];
      const signedGain = rawGain > 32767 ? rawGain - 65536 : rawGain;
      const gain = Number.parseFloat((signedGain / 10).toFixed(1));
      const freq = (data[9] << 8) | data[10];
      const qRaw = (data[11] << 8) | data[12];
      const q = Number.parseFloat((qRaw / 100).toFixed(2));
      const type = REV_TYPE_MAP[data[13]] || "PK";

      return { type: "band", index: bandIdx, value: { freq, gain, q, type } };
    }

    return null;
  },

  async fetchAllData(device) {
    // Device status query
    await device.sendReport(this.reportId, new Uint8Array([0xbb, 0x0b, 0, 0, 26, 0, 0, 0xee]));
    await sleep(100);

    // Get band count
    await device.sendReport(this.reportId, new Uint8Array([0xbb, 0x0b, 0, 0, 24, 0, 0, 0xee]));
    await sleep(100);

    // Fetch master gain (cmd 22)
    await device.sendReport(this.reportId, new Uint8Array([0xbb, 0x0b, 0, 0, 22, 0, 0, 0xee]));
    await sleep(150);

    // Fetch each band
    for (let i = 0; i < this.bandCount; i++) {
      await device.sendReport(this.reportId, new Uint8Array([0xbb, 0x0b, 0, 0, 21, 1, i, 0, 0xee]));
      await sleep(100);
    }
  },

  async sendMasterGain(device, val) {
    let value = Math.round(Math.max(-24, Math.min(12, val)) * 10);
    if (value < 0) value = 65536 + value;

    // BTR17 expects Big-Endian for gain values
    await device.sendReport(
      this.reportId,
      new Uint8Array([0xaa, 0x0a, 0, 0, 23, 2, (value >> 8) & 0xff, value & 0xff, 0, 0xee]),
    );
  },

  async syncPreview(device, bands, masterGain) {
    for (let i = 0; i < bands.length; i++) {
      const b = bands[i];
      let g = Math.round(b.gain * 10);
      if (g < 0) g = 65536 + g;
      const f = Math.round(b.freq);
      const qv = Math.round(b.q * 100);

      const packet = new Uint8Array([
        0xaa,
        0x0a,
        0,
        0,
        21,
        8,
        i,
        (g >> 8) & 0xff,
        g & 0xff,
        (f >> 8) & 0xff,
        f & 0xff,
        (qv >> 8) & 0xff,
        qv & 0xff,
        TYPE_MAP[b.type],
        0,
        0xee,
      ]);

      await device.sendReport(this.reportId, packet);
      await sleep(100);
    }

    await sleep(100);
    await this.sendMasterGain(device, masterGain);
  },

  async saveToDAC(device, bands, masterGainValue) {
    // Send all band data to device
    for (let i = 0; i < bands.length; i++) {
      const b = bands[i];
      let g = Math.round(b.gain * 10);
      if (g < 0) g = 65536 + g;
      const f = Math.round(b.freq);
      const qv = Math.round(b.q * 100);

      const packet = new Uint8Array([
        0xaa,
        0x0a,
        0,
        0,
        21,
        8,
        i,
        (g >> 8) & 0xff,
        g & 0xff,
        (f >> 8) & 0xff,
        f & 0xff,
        (qv >> 8) & 0xff,
        qv & 0xff,
        TYPE_MAP[b.type],
        0,
        0xee,
      ]);

      await device.sendReport(this.reportId, packet);
      await sleep(200); // Longer delay for save
    }

    // Save master gain to device (BTR17 requires explicit save for gain)
    if (masterGainValue !== undefined) {
      await this.sendMasterGain(device, masterGainValue);
      await sleep(200);
    }

    // Save command
    await device.sendReport(this.reportId, new Uint8Array([0xaa, 0x0a, 0, 0, 25, 1, 161, 0, 0xee]));
  },
};
