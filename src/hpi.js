// Home values that follow a house price index: the FHFA House Price Index,
// as published on FRED (fred.stlouisfed.org, no key needed).
//
// account.index = {
//   series:      FRED series id, e.g. 'VASTHPI' (Virginia, quarterly)
//   baseValue:   the value you entered
//   anchorDate:  the index observation that was latest when you entered it
//   anchorIndex: that observation's value
// }
// value = baseValue × latest index ÷ anchorIndex. Entering a new value
// starts over from it (a new anchor), so your number always wins.

export const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

// Names for the series we offer by name; any other FRED id works too.
export function seriesLabel(id) {
  if (id === 'USSTHPI') return 'US home prices (quarterly)';
  const m = /^([A-Z]{2})STHPI$/.exec(id);
  if (m && STATES[m[1]]) return `${STATES[m[1]]} home prices (quarterly)`;
  if (/^ATNHPIUS\d{5}A$/.test(id)) return `County home prices, ${id} (yearly)`;
  if (/^ATNHPIUS\d{5}Q$/.test(id)) return `Metro home prices, ${id} (quarterly)`;
  return `FRED ${id}`;
}

export function seriesUrl(id) {
  return `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`;
}

export async function fetchSeries(id, fetchImpl = fetch) {
  if (!/^[A-Z0-9]{2,30}$/.test(id)) throw new Error(`"${id}" isn't a FRED series id.`);
  const res = await fetchImpl(seriesUrl(id), { headers: { 'User-Agent': 'FinTrack personal finance dashboard' } });
  const text = await res.text();
  if (!res.ok || /^\s*</.test(text)) throw new Error(`FRED has no series "${id}".`);
  return parseFredCsv(id, text);
}

// "observation_date,VASTHPI" (older files say "DATE"), one row per period;
// "." marks a missing value.
export function parseFredCsv(id, text) {
  const lines = text.trim().split(/\r?\n/);
  const head = (lines.shift() || '').split(',');
  if (!/date/i.test(head[0] || '') || head.length < 2) throw new Error(`FRED's reply for ${id} isn't a data file.`);
  const obs = {};
  for (const line of lines) {
    const [date, v] = line.split(',');
    const n = Number(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && v !== '.' && Number.isFinite(n) && n > 0) obs[date] = n;
  }
  if (!Object.keys(obs).length) throw new Error(`FRED's series ${id} has no values.`);
  return obs;
}

export function latest(obs) {
  const d = Object.keys(obs || {}).sort().at(-1);
  return d ? { date: d, value: obs[d] } : null;
}

// A fresh anchor: start following the index from `value`, now.
export function anchor(series, value, obs) {
  const l = latest(obs);
  if (!l) throw new Error(`No values for ${series} yet.`);
  return { series, baseValue: Number(value), anchorDate: l.date, anchorIndex: l.value };
}

// Today's value and how far the index has moved since the anchor.
export function indexedValue(ix, obs) {
  const l = latest(obs);
  if (!l || !(ix.anchorIndex > 0)) return { value: ix.baseValue, change: 0, latestDate: l?.date ?? null };
  const ratio = l.value / ix.anchorIndex;
  return { value: Math.round(ix.baseValue * ratio * 100) / 100, change: ratio - 1, latestDate: l.date };
}

// How old the latest observation is, so a series that stopped (like the
// Washington metro one did in 2024) doesn't quietly freeze the value.
export function staleness(id, obs, today) {
  const l = latest(obs);
  if (!l) return null;
  const days = (Date.parse(today) - Date.parse(l.date)) / 86400000;
  const keys = Object.keys(obs).sort();
  const yearly = keys.length > 1 && (Date.parse(keys.at(-1)) - Date.parse(keys.at(-2))) / 86400000 > 300;
  // Quarterly values come out about 2 months after a quarter ends (a dated
  // observation is the quarter's start, so ~5 months old when new); yearly
  // ones some months after the year.
  if (days <= (yearly ? 730 : 270)) return null;
  return `${seriesLabel(id)} hasn't had a new value since ${l.date}; the series may have stopped. Choose another under the home's Price index.`;
}
