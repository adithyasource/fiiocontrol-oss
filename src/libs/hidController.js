import { batch } from "solid-js";
import {
  bands,
  defaultBands,
  masterGain,
  originalBands,
  originalMasterGain,
  productName,
  setBands,
  setDefaultBands,
  setDeviceId,
  setIsConnected,
  setMasterGain,
  setOriginalBands,
  setOriginalMasterGain,
  setProductName,
  setStatus,
  status,
} from "./hidStore";
import { findDriverForDevice, getSupportedDeviceFilters } from "./devices";
import { deepClone } from "./utils";

let device = null;
let driver = null;

function resetDisconnectedUi() {
  batch(() => {
    setIsConnected(false);
    setStatus("offline");
    setProductName("[disconnected]");
    setDeviceId(null);

    setMasterGain(0);
    setBands(deepClone(defaultBands()));
  });
}

export function handleDisconnect(e) {
  if (e.device === device) {
    try {
      device?.removeEventListener("inputreport", handleInputReport);
    } catch {
      // ignore
    }

    device = null;
    driver = null;

    resetDisconnectedUi();
  }
}

function handleInputReport(e) {
  if (!driver) return;

  const msg = driver.parseInputReport(new Uint8Array(e.data.buffer));
  if (!msg) return;

  if (msg.type === "masterGain") {
    setMasterGain(msg.value);
    return;
  }

  if (msg.type === "band") {
    const bandIdx = msg.index;
    const b = msg.value;

    if (bandIdx >= 0 && bandIdx < bands.length) {
      batch(() => {
        setBands(bandIdx, "freq", b.freq);
        setBands(bandIdx, "gain", b.gain);
        setBands(bandIdx, "q", b.q);
        setBands(bandIdx, "type", b.type);
      });
    }
  }
}

export async function connectDAC() {
  try {
    const filters = getSupportedDeviceFilters();
    const devices = await navigator.hid.requestDevice(filters.length ? { filters } : {});

    device = devices[0];
    if (!device) return;

    driver = findDriverForDevice(device);
    if (!driver) {
      device = null;
      alert("your device isn't supported yet :(");
      return;
    }

    batch(() => {
      setDeviceId(driver.id);
      setDefaultBands(deepClone(driver.defaultBands));
      setBands(deepClone(driver.defaultBands));
      setMasterGain(0);

      setProductName(device.productName);
      setIsConnected(true);
      setStatus("connected");
    });

    await device.open();
    device.addEventListener("inputreport", handleInputReport);

    await fetchAllData();
  } catch (err) {
    setStatus(`error: ${err.message}`);
  }
}

export async function fetchAllData() {
  if (!device || !driver) return;

  setStatus("reading dac...");
  await driver.fetchAllData(device);

  setOriginalBands(deepClone(bands));
  setOriginalMasterGain(masterGain());
  setStatus("synced");
}

export async function sendMasterGain(val) {
  if (!device || !driver) return;
  await driver.sendMasterGain(device, val);
}

export async function syncPreview() {
  if (!device || !driver || status() !== "synced") return;
  await driver.syncPreview(device, bands, masterGain());
}

export function resetToOriginal() {
  const original = originalBands();
  if (original.length) {
    batch(() => {
      setBands(deepClone(original));
      setMasterGain(originalMasterGain());
    });
  }
}

export function resetToDefaults() {
  batch(() => {
    setBands(deepClone(defaultBands()));
    setMasterGain(0);
  });
}

export function exportData() {
  const data = {
    bands: bands,
    masterGain: masterGain(),
  };

  const jsonString = JSON.stringify(data, null, 2);

  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  // creating fake anchor button temporarily
  const a = document.createElement("a");
  a.href = url;
  const date = new Date();
  a.download = `${productName().toLowerCase().replaceAll(" ", "_")}_config_${date
    .toLocaleString()
    .toString()
    .replaceAll(" ", "_")
    .replace(",", "")}.json`;

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  setTimeout(() => URL.revokeObjectURL(url), 100);
}

export async function importData() {
  try {
    const [fileHandle] = await window.showOpenFilePicker({
      types: [
        {
          accept: { "json/*": [".json"] },
        },
      ],
      multiple: false,
    });
    const file = await fileHandle.getFile();
    const contents = await file.text();

    try {
      const jsonData = JSON.parse(contents);
      batch(() => {
        setBands(jsonData.bands);
        setMasterGain(jsonData.masterGain);
      });
    } catch (e) {
      setStatus(`json parse error: ${e.message}`);
      resetToOriginal();
    }
  } catch (e) {
    setStatus(`error: ${e.message}`);
  }
}

export async function saveToDAC() {
  if (!device || !driver) return alert("Not connected");

  setStatus("saving");
  await driver.saveToDAC(device, bands);
  setStatus("saved");
}
