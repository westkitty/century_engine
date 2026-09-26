// Shared definitions for the simulation and the renderer.

export const GRID_COLS = 20;
export const GRID_ROWS = 10;
export const WORLD_W = 1600;
export const WORLD_H = 900;
export const SLOTS_PER_PLOT = 4;
export const COHORT_SPAN = 20;

// Structure types. `cat` groups them for rendering and accounting.
export const STRUCT = {
  housing:    { label: 'Housing block', cat: 'housing', cap: 2200 },
  tower:      { label: 'Residential tower', cat: 'housing', cap: 6500 },
  farm:       { label: 'Soil farm', cat: 'food', out: 3200 },
  hydroponic: { label: 'Hydroponic stack', cat: 'food', out: 4500 },
  rooftop:    { label: 'Rooftop farm', cat: 'food', out: 700 },
  waterplant: { label: 'Water plant', cat: 'water', out: 9000 },
  reservoir:  { label: 'Reservoir', cat: 'water', out: 3500 },
  conduit:    { label: 'Water conduit', cat: 'water', out: 3000 },
  recycler:   { label: 'Water recycler', cat: 'water', out: 16000 },
  fission:    { label: 'Fission plant', cat: 'energy', out: 22000 },
  solar:      { label: 'Mirror array', cat: 'energy', out: 7000 },
  fusion:     { label: 'Fusion core', cat: 'energy', out: 70000 },
  factory:    { label: 'Factory', cat: 'industry', out: 1 },
  fabricator: { label: 'Fabricator hall', cat: 'industry', out: 2 },
  market:     { label: 'Market', cat: 'commerce' },
  civic:      { label: 'Civic hall', cat: 'civic' },
  assembly:   { label: 'Assembly house', cat: 'civic' },
  garrison:   { label: 'Garrison', cat: 'civic' },
  school:     { label: 'School', cat: 'education' },
  academy:    { label: 'Academy', cat: 'education' },
  clinic:     { label: 'Clinic', cat: 'health' },
  hospital:   { label: 'Hospital', cat: 'health' },
  temple:     { label: 'Shrine', cat: 'culture' },
  park:       { label: 'Park', cat: 'culture' },
  memorial:   { label: 'Memorial', cat: 'culture' },
  museum:     { label: 'Museum', cat: 'culture' },
  station:    { label: 'Transit station', cat: 'transit' },
  tunnel:     { label: 'Transit tunnel', cat: 'transit' },
  barricade:  { label: 'Barricade', cat: 'military' },
  wall:       { label: 'Boundary wall', cat: 'military' },
  ruin:       { label: 'Ruin', cat: 'ruin' },
  hullpatch:  { label: 'Hull patch', cat: 'ruin' },
};

export const FACTION_ARCHETYPES = {
  authority:   { ideology: { control: 0.2, communal: 0.5, tradition: 0.4, openness: 0.4 }, color: '#e0c26a' },
  guild:       { ideology: { control: 0.6, communal: 0.1, tradition: 0.3, openness: 0.9 }, color: '#f08a4b' },
  cultivators: { ideology: { control: 0.6, communal: 0.7, tradition: 0.6, openness: 0.3 }, color: '#7fc46a' },
  engineers:   { ideology: { control: 0.4, communal: 0.4, tradition: 0.05, openness: 0.6 }, color: '#5cc8e8' },
  collective:  { ideology: { control: 0.8, communal: 0.95, tradition: 0.3, openness: 0.5 }, color: '#e05a7a' },
  faith:       { ideology: { control: 0.3, communal: 0.7, tradition: 0.95, openness: 0.2 }, color: '#b48ce8' },
  rationing:   { ideology: { control: 0.1, communal: 0.8, tradition: 0.3, openness: 0.2 }, color: '#9fb0c0' },
  separatist:  { ideology: { control: 0.9, communal: 0.5, tradition: 0.5, openness: 0.3 }, color: '#d8d05a' },
  migrant:     { ideology: { control: 0.7, communal: 0.6, tradition: 0.5, openness: 0.95 }, color: '#5ee0b0' },
};

export const DISTRICT_KINDS = ['residential', 'agri', 'industry', 'civic', 'mixed'];

export const CULTURE_COLORS = ['#6fa8dc', '#e6a35a', '#a56fd6', '#5ecf9d', '#e35d6a', '#d6c85a', '#7ad0e0', '#c98ac6'];
