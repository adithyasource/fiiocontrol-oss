import { batch } from "solid-js";
import {
  bands,
  setBands,
  setIsConnected,
  masterGain,
  setMasterGain,
  originalBands,
  setOriginalBands,
  originalMasterGain,
  setOriginalMasterGain,
  setStatus,
  status,
  setProductName,
} from "./hidStore";
import { DEFAULT_BANDS, REV_TYPE_MAP, TYPE_MAP } from "./consts";
import { showToast } from "./toastStore";

let device = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function handleDisconnect(e) {
  if (e.device === device) {
    device = null;
    setIsConnected(false);
    setStatus("offline");
    setBands(DEFAULT_BANDS);
    setProductName("[disconnected]");
    showToast("Disconnected from DAC");
  }
}

function handleInputReport(e) {
  const data = new Uint8Array(e.data.buffer);
  const cmd = data[4];

  if (cmd === 23) {
    const raw = (data[7] << 8) | data[6];
    const signed = raw > 32767 ? raw - 65536 : raw;
    setMasterGain(Number.parseFloat((signed / 2560).toFixed(1)));
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

    if (bandIdx >= 0 && bandIdx < 5) {
      batch(() => {
        setBands(bandIdx, "freq", freq);
        setBands(bandIdx, "gain", gain);
        setBands(bandIdx, "q", q);
        setBands(bandIdx, "type", type);
      });
    }
  }
}

export async function connectDAC() {
  try {
    const devices = await navigator.hid.requestDevice({ filters: [] });
    device = devices[0];
    if (!device) return;
    await device.open();
    device.addEventListener("inputreport", handleInputReport);
    setProductName(device.productName);
    setIsConnected(true);
    setStatus("connected");
    await fetchAllData();
  } catch (err) {
    setStatus(`error: ${err.message}`);
  }
}

export async function fetchAllData() {
  if (!device) return;
  setStatus("reading dac...");
  await device.sendReport(2, new Uint8Array([0xbb, 0x0b, 0, 0, 23, 0, 0, 0xee]));
  await sleep(200);
  for (let i = 0; i < 5; i++) {
    await device.sendReport(2, new Uint8Array([0xbb, 0x0b, 0, 0, 21, 1, i, 0xee]));
    await sleep(150);
  }
  setOriginalBands(JSON.parse(JSON.stringify(bands)));
  setOriginalMasterGain(masterGain());
  setStatus("synced");
}

export async function sendMasterGain(val) {
  if (!device) return;
  let value = Math.round(Math.max(-12, Math.min(12, val)) * 2560);
  if (value < 0) value = 65536 + value;
  await device.sendReport(2, new Uint8Array([0xaa, 0x0a, 0, 0, 23, 2, value & 0xff, (value >> 8) & 0xff, 0, 0xee]));
}

export async function syncPreview() {
  if (!device || status() !== "Synced") return;
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
    await device.sendReport(2, packet);
    await sleep(20);
  }
  await sendMasterGain(masterGain());
}

export function resetToOriginal() {
  batch(() => {
    const original = originalBands();
    if (original.length) {
      for (let i = 0; i < original.length; i++) {
        setBands(i, original[i]);
      }
    }
    setMasterGain(originalMasterGain());
  });
}

export async function saveToDAC() {
  if (!device) return alert("Not connected");
  setStatus("saving");
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
    await device.sendReport(2, packet);
    await sleep(50);
  }
  await sleep(50);
  await device.sendReport(2, new Uint8Array([0xaa, 0x0a, 0, 0, 25, 1, 3, 0, 0xee]));
  setStatus("saved");
}
