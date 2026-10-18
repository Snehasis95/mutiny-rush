// Player settings, remembered on this device.
window.MR = window.MR || {};
MR.Settings = (() => {
  const DEFAULTS = { sound: true, vibration: true, sway: true };
  const KEY = 'mr-settings';
  let values = { ...DEFAULTS };
  try { Object.assign(values, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* storage unavailable */ }
  const listeners = [];

  return {
    get: k => values[k],
    set(k, v) {
      values[k] = v;
      try { localStorage.setItem(KEY, JSON.stringify(values)); } catch { /* storage unavailable */ }
      listeners.forEach(fn => fn(k, v));
    },
    onChange: fn => listeners.push(fn),
  };
})();

MR.vibrate = ms => {
  if (!MR.Settings.get('vibration')) return;
  try { navigator.vibrate && navigator.vibrate(ms); } catch { /* unsupported */ }
};
