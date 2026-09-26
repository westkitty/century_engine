// Procedural naming. Everything takes an RNG so names are reproducible.

const SYL_A = ['Hel', 'Kor', 'Vas', 'Mer', 'Ost', 'Tal', 'Ren', 'Sol', 'Ith', 'Bran', 'Cal', 'Dor', 'Eth', 'Fen', 'Gal', 'Hal', 'Ior', 'Kel', 'Lun', 'Mor', 'Nar', 'Or', 'Pel', 'Quen', 'Ryn', 'Sar', 'Tor', 'Ul', 'Ver', 'Wen', 'Yl', 'Zar'];
const SYL_B = ['ix', 'an', 'os', 'ia', 'um', 'en', 'ar', 'eth', 'is', 'ol', 'ura', 'ane', 'ess', 'ion', 'ath', 'ory', 'and', 'ine', 'ova', 'ek'];
const SUFFIX = ['District', 'Ward', 'Quarter', 'Reach', 'Ring', 'Terrace', 'Hollow', 'Span', 'Fields', 'Commons', 'Sector', 'Bend'];
const AGRI_SUFFIX = ['Fields', 'Terraces', 'Gardens', 'Orchards', 'Belt'];
const IND_SUFFIX = ['Works', 'Yards', 'Forge', 'Foundry', 'Spindle'];
const CIVIC_SUFFIX = ['Commons', 'Plaza', 'Assembly', 'Circle'];

export function coreName(rng) {
  return rng.pick(SYL_A) + rng.pick(SYL_B);
}

export function districtName(rng, kind) {
  const core = coreName(rng);
  let suf;
  if (kind === 'agri') suf = rng.pick(AGRI_SUFFIX);
  else if (kind === 'industry') suf = rng.pick(IND_SUFFIX);
  else if (kind === 'civic') suf = rng.pick(CIVIC_SUFFIX);
  else suf = rng.pick(SUFFIX);
  return `${core} ${suf}`;
}

export function migrantDistrictName(rng, origin) {
  const forms = [
    `${origin} Quarter`, `Little ${origin}`, `New ${origin}`, `${origin} Landing`, `${origin}town`,
  ];
  return rng.pick(forms);
}

export function revolutionaryRename(rng, base) {
  const forms = [
    `People's ${base}`, `Free ${base}`, `${base} Liberated`, `Commune of ${base}`, `${coreName(rng)} Memorial Ward`, `Unity ${rng.pick(SUFFIX)}`,
  ];
  return rng.pick(forms);
}

export function sacredRename(rng, base) {
  return rng.pick([`Sanctuary of ${base}`, `${base} Shrine Ward`, `Holy ${base}`, `${base} of the Vigil`]);
}

export function authoritarianRename(rng, base, factionShort) {
  return rng.pick([`${factionShort} ${base}`, `${base} Administrative Zone`, `Sector ${rng.range(2, 19)} (${base})`]);
}

export function revoltName(rng, district, year) {
  const n = rng.range(2, 40);
  return rng.pick([
    `${numberWord(n)}-Day Revolt`, `${district.split(' ')[0]} Rising`, `Bread Riots of Year ${year}`, `${district.split(' ')[0]} Uprising`,
    `The ${rng.pick(['Lantern', 'Conduit', 'Ration', 'Ladder', 'Valve', 'Grey', 'Silent'])} Revolt`,
  ]);
}

export function crisisName(rng, kind, ordinal) {
  const ords = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
  const o = ords[Math.min(ordinal, ords.length - 1)];
  if (kind === 'water') return `${o} Water Crisis`;
  if (kind === 'famine') return rng.pick([`${o} Famine`, `The ${rng.pick(['Lean', 'Grey', 'Hollow', 'Thin'])} Years`]);
  if (kind === 'blight') return `${o} Blight`;
  if (kind === 'plague') return rng.pick([`${o} Fever`, `The ${rng.pick(['Ring', 'Spindle', 'Damp', 'Ashen'])} Sickness`]);
  if (kind === 'breach') return rng.pick([`${o} Pressure Failure`, `The ${rng.pick(['Southern', 'Northern', 'Aft', 'Forward'])} Breach`]);
  if (kind === 'blackout') return rng.pick([`${o} Blackout`, `The Long Dark`]);
  return `${o} Crisis`;
}

export function factionName(rng, archetype) {
  const t = {
    authority: ['Hull Authority', 'Habitat Administration', 'Central Directorate', 'The Stewardry', 'Spindle Command'],
    guild: ['Merchant Guild', 'Trade Consortium', 'Exchange League', 'Carriers\' Compact', 'The Ledger Houses'],
    cultivators: ['Cultivators\' Union', 'Soil Compact', 'Growers\' Assembly', 'Terrace Syndicate'],
    engineers: ['Engineers\' Guild', 'Technocratic Circle', 'Reactor Fellowship', 'Systems Collegium'],
    collective: ['Ringward Collective', 'Workers\' Assembly', 'Commons Movement', 'Tenants\' League'],
    faith: ['Order of the Vigil', 'Church of the Turning', 'The Silent Conduit', 'Keepers of the Dark Years', 'Congregation of the Spindle'],
    rationing: ['Rationing Council', 'Emergency Water Board', 'Provisions Committee', 'Scarcity Directorate'],
    separatist: ['District League', 'Autonomy Front', 'Ward Assembly', 'Outer Ring Compact'],
    migrant: ['Newcomers\' Association', 'Arrivals\' Council', 'Landing Compact'],
  };
  return rng.pick(t[archetype] || t.authority);
}

export function shortFaction(name) {
  const w = name.replace(/^The /, '').split(' ');
  return w[0].replace(/'s$|'$/, '');
}

export function cohortName(rng, idx, year) {
  const adj = ['Founding', 'Second', 'Conduit', 'Lantern', 'Turning', 'Quiet', 'Ration', 'Bright', 'Hollow', 'Spindle', 'Terrace', 'Vigil', 'Iron', 'Green', 'Glass', 'Long', 'Late', 'New'];
  if (idx === 0) return 'Founders';
  return `${adj[idx % adj.length]} Generation`;
}

export function originName(rng) {
  return rng.pick(['Tethys', 'Ceres', 'Ganymede', 'Vesta', 'Callisto', 'Ariel', 'Pallas', 'Hygiea', 'Titan', 'Europa', 'Meridian', 'Kepler']);
}

export function numberWord(n) {
  const w = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'];
  if (n <= 20) return w[n];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty'];
  const t = tens[Math.floor(n / 10)] || 'Forty', r = n % 10;
  return r ? `${t}-${w[r]}` : t;
}

export function habitatName(rng) {
  return rng.pick(['Anvil', 'Meridian', 'Halcyon', 'Corvid', 'Tessera', 'Orrery', 'Lantern', 'Cinder', 'Aurelian', 'Vantage', 'Kestrel', 'Sable']) + ' ' + rng.pick(['Cylinder', 'Habitat', 'Ring', 'Station', 'Drum']);
}
