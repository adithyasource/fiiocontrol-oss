import { REV_TYPE_MAP, TYPE_MAP } from "../consts";
import { sleep } from "../utils";

export const fiioJa11 = {
  id: "fiio-ja11",
  name: "FiiO JadeAudio JA11",
  filters: [{ vendorId: 0x2972, productId: 258 }],
  reportId: 2,
  bandCount: 5,
  defaultBands: [
    { type: "PK", gain: 0, freq: 100, q: 0.7 },
    { type: "PK", gain: 0, freq: 500, q: 0.7 },
    { type: "PK", gain: 0, freq: 1000, q: 0.7 },
    { type: "PK", gain: 0, freq: 2500, q: 0.7 },
    { type: "PK", gain: 0, freq: 10000, q: 0.7 },
  ],

  supports(device) {
    return device.vendorId === 0x2972 && device.productId === 258;
  },

  parseInputReport(data) {
    const cmd = data[4];

    if (cmd === 23) {
      const raw = (data[7] << 8) | data[6];
      const signed = raw > 32767 ? raw - 65536 : raw;
      return { type: "masterGain", value: Number.parseFloat((signed / 2560).toFixed(1)) };
    }

    if (cmd === 21) {
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
    await device.sendReport(this.reportId, new Uint8Array([0xbb, 0x0b, 0, 0, 23, 0, 0, 0xee]));
    await sleep(200);

    for (let i = 0; i < this.bandCount; i++) {
      await device.sendReport(this.reportId, new Uint8Array([0xbb, 0x0b, 0, 0, 21, 1, i, 0xee]));
      await sleep(150);
    }
  },

  async sendMasterGain(device, val) {
    let value = Math.round(Math.max(-12, Math.min(12, val)) * 2560);
    if (value < 0) value = 65536 + value;

    await device.sendReport(
      this.reportId,
      new Uint8Array([0xaa, 0x0a, 0, 0, 23, 2, value & 0xff, (value >> 8) & 0xff, 0, 0xee]),
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
      await sleep(20);
    }

    await this.sendMasterGain(device, masterGain);
  },

  async saveToDAC(device, bands) {
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
      await sleep(50);
    }

    await sleep(50);
    await device.sendReport(this.reportId, new Uint8Array([0xaa, 0x0a, 0, 0, 25, 1, 3, 0, 0xee]));
  },
};
