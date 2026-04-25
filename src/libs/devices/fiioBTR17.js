import { REV_TYPE_MAP, TYPE_MAP } from "../consts";
import { sleep } from "../utils";

export const fiioBTR17 = {
  id: "fiio-btr17",
  name: "FiiO BTR17",
  filters: [{ vendorId: 0x2972 }], // any FiiO device
  reportId: 7,
  bandCount: 11,
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
    // Value is a signed 8-bit byte at data[6], divided by 16
    if (cmd === 22 && data[5] === 1) {
      const signed = data[6] > 127 ? data[6] - 256 : data[6];
      return { type: "masterGain", value: Number.parseFloat((signed / 16).toFixed(1)) };
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
    let value = Math.round(Math.max(-12, Math.min(12, val)) * 16);
    if (value < 0) value = 65536 + value;

    await device.sendReport(
      this.reportId,
      new Uint8Array([0xaa, 0x10, 0, 0, 23, 2, value & 0xff, (value >> 8) & 0xff, 0, 0xee]),
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
        0x10,
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

  async saveToDAC(device, bands) {
    // Send all band data to device
    for (let i = 0; i < bands.length; i++) {
      const b = bands[i];
      let g = Math.round(b.gain * 10);
      if (g < 0) g = 65536 + g;
      const f = Math.round(b.freq);
      const qv = Math.round(b.q * 100);

      const packet = new Uint8Array([
        0xaa,
        0x10,
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

    // TODO: Fix master gain saving for BTR17
    // The gain slider currently doesn't send to device, so we can't save it properly
    // Need to revisit: either send gain on slider move, or read gain from device here
    // For now, master gain won't persist on save

    // Save command — BTR17 uses byte 6 = 160
    await device.sendReport(this.reportId, new Uint8Array([0xaa, 0x10, 0, 0, 25, 1, 160, 0, 0xee]));
  },
};
