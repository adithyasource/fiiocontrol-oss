export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
