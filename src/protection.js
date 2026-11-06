// Insurance and estate: what an advisor asks about after the money itself.
// All entered by hand; FinTrack only keeps the list and points out gaps.
//
// settings.protection = {
//   policies: [{ id, type, who, provider, coverage, premium, work }]
//   docs: { will: { status, reviewed, where }, ... }      status: 'have' | 'no' | 'unsure'
//   beneficiaries: { accountId or 'policy:<id>': { named: 'yes'|'no'|'unsure', checked: year } }
// }

export const POLICY_TYPES = {
  life: 'Life insurance', disability: 'Disability insurance', umbrella: 'Umbrella liability',
  longTermCare: 'Long-term care', home: 'Homeowners', auto: 'Auto', health: 'Health', other: 'Other',
};

export const DOCS = [
  ['will', 'Will', 'Says who gets what and who cares for any children.'],
  ['financialPoa', 'Financial power of attorney', 'Someone to handle money matters if you can\'t.'],
  ['healthPoa', 'Healthcare power of attorney', 'Someone to make medical decisions if you can\'t.'],
  ['directive', 'Healthcare directive (living will)', 'Your wishes for medical care.'],
  ['trust', 'Trust (optional)', 'Not everyone needs one; worth asking about.'],
];

export const LIFE_MULTIPLE = 10;     // a common rule of thumb: life cover about 10x income
export const REVIEW_YEARS = 3;       // documents and beneficiaries: look again every few years

export function emptyProtection() { return { policies: [], docs: {}, beneficiaries: {} }; }

export function summarizeProtection(prot, { salary = null, accounts = [], thisYear = new Date().getFullYear() } = {}) {
  const p = prot || emptyProtection();
  const policies = (p.policies || []).map((x) => ({ ...x, label: POLICY_TYPES[x.type] || 'Other' }));
  const life = policies.filter((x) => x.type === 'life');
  const lifeTotal = life.reduce((s, x) => s + (Number(x.coverage) || 0), 0);
  const has = (t) => policies.some((x) => x.type === t);

  const docs = DOCS.map(([key, label, why]) => {
    const d = p.docs?.[key] || {};
    const stale = d.status === 'have' && d.reviewed && thisYear - d.reviewed > REVIEW_YEARS;
    return { key, label, why, status: d.status || null, reviewed: d.reviewed || null, where: d.where || '', stale };
  });

  // Beneficiaries: accounts that can name one, and each life policy.
  const named = (key) => p.beneficiaries?.[key] || {};
  const bens = [
    ...accounts.filter((a) => ['retirement', 'investments', 'cash'].includes(a.category) && !a.hidden)
      .map((a) => ({ key: a.id, label: `${a.name} · ${a.org}`, ...named(a.id) })),
    ...life.map((x) => ({ key: `policy:${x.id}`, label: `Life insurance · ${x.provider || x.who || 'policy'}`, ...named(`policy:${x.id}`) })),
  ].map((b) => ({ ...b, named: b.named || null, checked: b.checked || null, stale: b.named === 'yes' && b.checked && thisYear - b.checked > REVIEW_YEARS }));

  // Rough checks, each with a status like the health panel's.
  const checks = [];
  const lifeGuide = salary ? salary * LIFE_MULTIPLE : null;
  checks.push({
    key: 'life', label: 'Life insurance',
    status: !life.length ? 'attention' : lifeGuide ? (lifeTotal >= lifeGuide ? 'good' : lifeTotal >= lifeGuide / 2 ? 'watch' : 'attention') : 'good',
    note: !life.length ? 'None listed.' : `${money(lifeTotal)} of cover${lifeGuide ? `; a common rule of thumb is about ${LIFE_MULTIPLE}× income (${money(lifeGuide)}), though needs vary` : ''}.`,
  });
  checks.push({ key: 'disability', label: 'Disability insurance', status: has('disability') ? 'good' : 'watch', note: has('disability') ? 'In place.' : 'None listed. Many employers offer long-term disability; check your benefits.' });
  checks.push({ key: 'umbrella', label: 'Umbrella liability', status: has('umbrella') ? 'good' : 'watch', note: has('umbrella') ? 'In place.' : 'None listed. Worth asking about as a homeowner, as what you own grows.' });
  const core = docs.filter((d) => d.key !== 'trust');
  const missingDocs = core.filter((d) => d.status !== 'have');
  checks.push({
    key: 'docs', label: 'Estate documents',
    status: !missingDocs.length ? (core.some((d) => d.stale) ? 'watch' : 'good') : missingDocs.length === core.length ? 'attention' : 'watch',
    note: !missingDocs.length ? (core.some((d) => d.stale) ? `In place; some not reviewed in over ${REVIEW_YEARS} years.` : 'Will, powers of attorney and directive in place.') : `Not in place or not sure: ${missingDocs.map((d) => d.label.replace(/ \(.*\)/, '')).join(', ')}.`,
  });
  const benGaps = bens.filter((b) => b.named !== 'yes');
  checks.push({
    key: 'beneficiaries', label: 'Beneficiaries',
    status: !bens.length ? null : benGaps.length ? 'attention' : bens.some((b) => b.stale || !b.checked) ? 'watch' : 'good',
    note: !bens.length ? '' : benGaps.length ? `Not confirmed on ${benGaps.length} of ${bens.length}: ${benGaps.map((b) => (b.key.startsWith('policy:') ? b.label : b.label.split(' · ')[0])).join(', ')}.` : bens.some((b) => b.stale || !b.checked) ? `All named; check again any not reviewed in ${REVIEW_YEARS} years.` : 'Named on every account and policy.',
  });

  const entered = policies.length > 0 || docs.some((d) => d.status) || bens.some((b) => b.named);
  return { policies, lifeTotal, lifeGuide, docs, beneficiaries: bens, checks, entered, premiums: policies.reduce((s, x) => s + (Number(x.premium) || 0), 0) };
}

export function validateProtection(input, thisYear = new Date().getFullYear()) {
  const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(/[$,\s]/g, '')));
  const text = (v, n = 80) => String(v ?? '').trim().slice(0, n);
  const year = (v) => {
    const y = num(v);
    if (y == null) return null;
    if (!(y >= 1950 && y <= thisYear)) throw new Error('Years reviewed or checked are like 2024, and not in the future.');
    return y;
  };
  const policies = (input?.policies || []).slice(0, 40).map((x, i) => {
    if (!POLICY_TYPES[x.type]) throw new Error('Pick a kind of insurance.');
    const coverage = num(x.coverage), premium = num(x.premium);
    if (coverage != null && !(coverage >= 0)) throw new Error('Coverage is a dollar amount.');
    if (premium != null && !(premium >= 0)) throw new Error('The premium is dollars a year.');
    return { id: /^[\w-]{1,40}$/.test(x.id || '') ? x.id : `p${Date.now().toString(36)}${i}`, type: x.type, who: text(x.who, 40), provider: text(x.provider), coverage, premium, work: Boolean(x.work) };
  });
  const docs = {};
  for (const [key] of DOCS) {
    const d = input?.docs?.[key];
    if (!d) continue;
    if (d.status != null && !['have', 'no', 'unsure'].includes(d.status)) throw new Error('Unknown document status.');
    docs[key] = { status: d.status || null, reviewed: year(d.reviewed), where: text(d.where, 120) };
  }
  const beneficiaries = {};
  for (const [key, b] of Object.entries(input?.beneficiaries || {})) {
    if (!/^(policy:)?[\w-]{1,80}$/.test(key)) continue;
    if (b.named != null && !['yes', 'no', 'unsure'].includes(b.named)) throw new Error('Unknown beneficiary answer.');
    beneficiaries[key] = { named: b.named || null, checked: year(b.checked) };
  }
  return { policies, docs, beneficiaries };
}

function money(x) { return `$${Math.round(x).toLocaleString('en-US')}`; }
