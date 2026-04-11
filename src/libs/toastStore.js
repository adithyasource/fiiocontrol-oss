import { createSignal } from "solid-js";

export const [toast, setToast] = createSignal(null);

export function showToast(message, duration = 3000) {
  setToast(message);
  setTimeout(() => setToast(null), duration);
}
