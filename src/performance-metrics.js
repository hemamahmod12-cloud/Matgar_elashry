/* قياس أداء خفيف للواجهة فقط؛ لا يرسل بيانات ولا يعتمد على backend. */
(function (global) {
  'use strict';
  const starts = new Map();
  const durations = new Map();
  const counts = new Map();
  const now = () => (global.performance && typeof global.performance.now === 'function')
    ? global.performance.now() : Date.now();
  function increment(name, amount = 1) {
    counts.set(name, (counts.get(name) || 0) + amount);
  }
  function start(name) {
    starts.set(name, now());
    increment(`${name}.started`);
  }
  function end(name) {
    const started = starts.get(name);
    if (started === undefined) return null;
    starts.delete(name);
    const duration = Math.max(0, now() - started);
    const values = durations.get(name) || [];
    values.push(duration);
    if (values.length > 50) values.shift();
    durations.set(name, values);
    increment(`${name}.completed`);
    return duration;
  }
  function percentile(values, ratio) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
  }
  function snapshot() {
    const result = { counts: Object.fromEntries(counts), durations: {} };
    durations.forEach((values, name) => {
      const total = values.reduce((sum, value) => sum + value, 0);
      result.durations[name] = {
        lastMs: values[values.length - 1] || 0,
        averageMs: values.length ? total / values.length : 0,
        p50Ms: percentile(values, 0.50),
        p95Ms: percentile(values, 0.95),
        p99Ms: percentile(values, 0.99),
        maxMs: values.length ? Math.max(...values) : 0,
        samples: values.length
      };
    });
    return result;
  }
  function reset() {
    starts.clear(); durations.clear(); counts.clear();
  }
  global.MatgarPerf = Object.freeze({ start, end, increment, snapshot, reset });
}(window));
