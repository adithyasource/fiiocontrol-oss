import { fiioJa11 } from "./fiioJa11";

export const SUPPORTED_DEVICES = [fiioJa11];

export function findDriverForDevice(device) {
  return SUPPORTED_DEVICES.find((d) => d.supports(device)) || null;
}

export function getSupportedDeviceFilters() {
  // navigator.hid.requestDevice needs a flat list of filters
  return SUPPORTED_DEVICES.flatMap((d) => d.filters || []);
}
