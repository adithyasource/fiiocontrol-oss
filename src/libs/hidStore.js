import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { DEFAULT_BANDS } from "./consts";

export const [bands, setBands] = createStore(JSON.parse(JSON.stringify(DEFAULT_BANDS)));
export const [masterGain, setMasterGain] = createSignal(0);
export const [isConnected, setIsConnected] = createSignal(false);
export const [status, setStatus] = createSignal("offline");
export const [originalBands, setOriginalBands] = createSignal([]);
export const [originalMasterGain, setOriginalMasterGain] = createSignal(0);
export const [productName, setProductName] = createSignal("[disconnected]");
