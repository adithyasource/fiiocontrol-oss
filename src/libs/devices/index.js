import { fiioJa11 } from "./fiioJa11";
import { fiioBTR17 } from "./fiioBTR17";

export const SUPPORTED_DEVICES = [fiioJa11, fiioBTR17];

export function findDriverForDevice(device) {
  return SUPPORTED_DEVICES.find((d) => d.supports(device)) || null;
}

export function getSupportedDeviceFilters() {
  // navigator.hid.requestDevice needs a flat list of filters
  return SUPPORTED_DEVICES.flatMap((d) => d.filters || []);
}
