// What to Wear — clothing recommendations from the Open-Meteo forecast.
// No build step, no API keys. Settings live in localStorage.

const SETTINGS_KEY = 'whatToWear.settings.v1';
const LAST_LOC_KEY = 'whatToWear.lastLocation.v1';
const FAVS_KEY = 'whatToWear.favorites.v1';

const defaultSettings = {
  gender: 'neutral',
  tempPref: 'normal',
  units: 'metric',
  style: 'casual',
};

const els = {
  form: document.getElementById('cityForm'),
  input: document.getElementById('cityInput'),
  locBtn: document.getElementById('locBtn'),
  suggestions: document.getElementById('suggestions'),
  loading: document.getElementById('loading'),
  error: document.getElementById('error'),
  result: document.getElementById('result'),
  locationName: document.getElementById('locationName'),
  locationTime: document.getElementById('locationTime'),
  nowIcon: document.getElementById('nowIcon'),
  nowTemp: document.getElementById('nowTemp'),
  nowFeels: document.getElementById('nowFeels'),
  nowDesc: document.getElementById('nowDesc'),
  nowMeta: document.getElementById('nowMeta'),
  outfitHeadline: document.getElementById('outfitHeadline'),
  outfitList: document.getElementById('outfitList'),
  outfitNotes: document.getElementById('outfitNotes'),
  forecast: document.getElementById('forecast'),
  packingCard: document.getElementById('packingCard'),
  packingList: document.getElementById('packingList'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsDialog: document.getElementById('settingsDialog'),
  settingsForm: document.getElementById('settingsForm'),
  cancelSettings: document.getElementById('cancelSettings'),
  gender: document.getElementById('gender'),
  units: document.getElementById('units'),
  style: document.getElementById('style'),
};

// Track which forecast day is selected (0 = today).
let selectedDayIndex = 0;
let selectedPeriod = 'day'; // 'day' or 'night'
let currentWeather = null;
let currentLoc = null;

// Trip planner state.
let tripDestinations = []; // [{ name, country, latitude, longitude }, ...]
let tripDates = { start: null, end: null };

// Per-box style overrides (default to settings.style; reset when settings change).
let recStyle = null;   // "What to wear" box style
let packStyle = null;  // "Packing for the trip" box style

// ---------- Settings ----------

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : { ...defaultSettings };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

let settings = loadSettings();

function syncSettingsFormToState() {
  els.gender.value = settings.gender;
  els.units.value = settings.units;
  els.style.value = settings.style;
  const tempRadios = document.querySelectorAll('input[name="tempPref"]');
  tempRadios.forEach(r => { r.checked = r.value === settings.tempPref; });
}

els.settingsBtn.addEventListener('click', () => {
  syncSettingsFormToState();
  els.settingsDialog.showModal();
});
els.cancelSettings.addEventListener('click', () => els.settingsDialog.close());
els.settingsForm.addEventListener('submit', (e) => {
  const tempPref = document.querySelector('input[name="tempPref"]:checked')?.value || 'normal';
  settings = {
    gender: els.gender.value,
    tempPref,
    units: els.units.value,
    style: els.style.value,
  };
  saveSettings(settings);
  // Setting style changed → reset per-box overrides so they follow the new default.
  recStyle = null;
  packStyle = null;
  syncStyleButtons('rec');
  syncStyleButtons('pack');
  // Re-render last location with new settings
  const last = getLastLocation();
  if (last) loadCity(last);
});

// ---------- Last location ----------

function getLastLocation() {
  try {
    const raw = localStorage.getItem(LAST_LOC_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function setLastLocation(loc) {
  localStorage.setItem(LAST_LOC_KEY, JSON.stringify(loc));
}

// ---------- Favorites ----------

function getFavorites() {
  try {
    const raw = localStorage.getItem(FAVS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveFavorites(arr) {
  localStorage.setItem(FAVS_KEY, JSON.stringify(arr));
}
function favKey(loc) {
  // Identify by rounded coords (avoid duplicates from tiny drift).
  return `${(+loc.latitude).toFixed(2)},${(+loc.longitude).toFixed(2)}`;
}
function isFavorited(loc) {
  return getFavorites().some(f => favKey(f) === favKey(loc));
}
function toggleFavorite(loc) {
  const favs = getFavorites();
  const k = favKey(loc);
  const idx = favs.findIndex(f => favKey(f) === k);
  if (idx >= 0) favs.splice(idx, 1);
  else favs.push({ name: loc.name, admin1: loc.admin1, country: loc.country, latitude: loc.latitude, longitude: loc.longitude });
  saveFavorites(favs);
  renderFavorites();
  updateFavStar();
}

function renderFavorites() {
  const root = document.getElementById('favorites');
  if (!root) return;
  const favs = getFavorites();
  root.innerHTML = '';
  if (!favs.length) { root.classList.add('hidden'); return; }
  root.classList.remove('hidden');
  favs.forEach(f => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'fav-chip';
    chip.innerHTML = `<span>★ ${escapeHtml(f.name)}${f.country ? `, ${escapeHtml(f.country)}` : ''}</span><span class="fav-x" title="Remove">×</span>`;
    chip.addEventListener('click', (e) => {
      if (e.target.classList.contains('fav-x')) {
        toggleFavorite(f);
        return;
      }
      loadCity(f);
    });
    root.appendChild(chip);
  });
}

function updateFavStar() {
  const btn = document.getElementById('favBtn');
  if (!btn || !currentLoc) return;
  const on = isFavorited(currentLoc);
  btn.classList.toggle('on', on);
  btn.title = on ? 'Remove from favorites' : 'Save city';
}

// ---------- Toast ----------

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2200);
}

// ---------- Share link ----------

function shareUrlFor(loc) {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('lat', (+loc.latitude).toFixed(4));
  url.searchParams.set('lon', (+loc.longitude).toFixed(4));
  url.searchParams.set('name', loc.name);
  if (loc.country) url.searchParams.set('country', loc.country);
  return url.toString();
}

async function copyShareLink() {
  if (!currentLoc) return;
  const url = shareUrlFor(currentLoc);
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch {
    // Fallback: show a prompt the user can copy from.
    window.prompt('Copy this link:', url);
  }
}

function locFromUrl() {
  const p = new URLSearchParams(window.location.search);
  const lat = parseFloat(p.get('lat'));
  const lon = parseFloat(p.get('lon'));
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return {
      name: p.get('name') || 'Shared location',
      admin1: '',
      country: p.get('country') || '',
      latitude: lat,
      longitude: lon,
    };
  }
  return null;
}

// ---------- Open-Meteo ----------

async function geocodeCity(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Geocoding failed');
  const data = await res.json();
  return data.results || [];
}

async function reverseGeocode(lat, lon) {
  // Open-Meteo doesn't have reverse geocoding; use BigDataCloud's free endpoint.
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    const data = await res.json();
    return {
      name: data.city || data.locality || data.principalSubdivision || 'Your location',
      admin1: data.principalSubdivision || '',
      country: data.countryName || '',
      latitude: lat,
      longitude: lon,
    };
  } catch {
    return { name: 'Your location', admin1: '', country: '', latitude: lat, longitude: lon };
  }
}

async function fetchWeather(lat, lon) {
  const tempUnit = settings.units === 'imperial' ? 'fahrenheit' : 'celsius';
  const windUnit = settings.units === 'imperial' ? 'mph' : 'kmh';
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset',
    timezone: 'auto',
    temperature_unit: tempUnit,
    wind_speed_unit: windUnit,
    forecast_days: 5,
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Weather fetch failed');
  return res.json();
}

// ---------- WMO weather code → label + emoji ----------

const wmoMap = {
  0: { label: 'Clear', day: '☀️', night: '🌙' },
  1: { label: 'Mostly clear', day: '🌤️', night: '🌙' },
  2: { label: 'Partly cloudy', day: '⛅', night: '☁️' },
  3: { label: 'Overcast', day: '☁️', night: '☁️' },
  45: { label: 'Fog', day: '🌫️', night: '🌫️' },
  48: { label: 'Freezing fog', day: '🌫️', night: '🌫️' },
  51: { label: 'Light drizzle', day: '🌦️', night: '🌧️' },
  53: { label: 'Drizzle', day: '🌦️', night: '🌧️' },
  55: { label: 'Heavy drizzle', day: '🌧️', night: '🌧️' },
  61: { label: 'Light rain', day: '🌦️', night: '🌧️' },
  63: { label: 'Rain', day: '🌧️', night: '🌧️' },
  65: { label: 'Heavy rain', day: '🌧️', night: '🌧️' },
  66: { label: 'Freezing rain', day: '🌧️', night: '🌧️' },
  67: { label: 'Freezing rain', day: '🌧️', night: '🌧️' },
  71: { label: 'Light snow', day: '🌨️', night: '🌨️' },
  73: { label: 'Snow', day: '❄️', night: '❄️' },
  75: { label: 'Heavy snow', day: '❄️', night: '❄️' },
  77: { label: 'Snow grains', day: '🌨️', night: '🌨️' },
  80: { label: 'Rain showers', day: '🌦️', night: '🌧️' },
  81: { label: 'Rain showers', day: '🌧️', night: '🌧️' },
  82: { label: 'Heavy showers', day: '⛈️', night: '⛈️' },
  85: { label: 'Snow showers', day: '🌨️', night: '🌨️' },
  86: { label: 'Heavy snow showers', day: '❄️', night: '❄️' },
  95: { label: 'Thunderstorm', day: '⛈️', night: '⛈️' },
  96: { label: 'Thunderstorm w/ hail', day: '⛈️', night: '⛈️' },
  99: { label: 'Severe thunderstorm', day: '⛈️', night: '⛈️' },
};
function wmo(code, isDay = 1) {
  const m = wmoMap[code] || { label: 'Unknown', day: '🌡️', night: '🌡️' };
  return { label: m.label, icon: isDay ? m.day : m.night };
}

// ---------- Outfit logic ----------

// Adjust the "perceived" temperature based on the user's preference.
// If they run cold (overdresser), shift down so the recommendation dresses warmer.
function adjustedTemp(feelsLike) {
  const inC = settings.units === 'imperial' ? (feelsLike - 32) * 5 / 9 : feelsLike;
  let shift = 0;
  if (settings.tempPref === 'cold') shift = -3;     // dress 3°C warmer
  else if (settings.tempPref === 'warm') shift = +3; // dress 3°C cooler
  return inC + shift;
}

// Average a numeric array across a slice (with bounds + null skipping).
function avgSlice(arr, start, end) {
  const slice = arr.slice(start, end).filter(v => v != null);
  if (!slice.length) return null;
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}
function modeSlice(arr, start, end) {
  const slice = arr.slice(start, end).filter(v => v != null);
  if (!slice.length) return null;
  const counts = new Map();
  slice.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
function maxSlice(arr, start, end) {
  const slice = arr.slice(start, end).filter(v => v != null);
  return slice.length ? Math.max(...slice) : null;
}

// Build a normalized "conditions" object for a given day index + period (day/night).
// Uses the hourly arrays so we can pick the right window of the day.
function conditionsFor(weather, dayIndex, period) {
  const { hourly, daily } = weather;
  const dateStr = daily.time[dayIndex]; // "YYYY-MM-DD"
  // Hourly times are ISO local strings like "2026-04-25T13:00".
  // Day window: 9:00 → 18:00. Night window: 20:00 → 05:00 (next day).
  const dayStart = hourly.time.findIndex(t => t === `${dateStr}T09:00`);
  const dayEnd   = hourly.time.findIndex(t => t === `${dateStr}T19:00`);
  const nightStart = hourly.time.findIndex(t => t === `${dateStr}T20:00`);
  const nextDate = daily.time[dayIndex + 1];
  let nightEnd = nextDate ? hourly.time.findIndex(t => t === `${nextDate}T06:00`) : -1;
  if (nightEnd === -1) nightEnd = hourly.time.length;

  const useStart = period === 'night' ? nightStart : dayStart;
  const useEnd   = period === 'night' ? nightEnd   : dayEnd;

  // Fallbacks if the window isn't covered (e.g., we're past it for today).
  let planningTemp, code, wind, precipProb;
  if (useStart >= 0 && useEnd > useStart) {
    planningTemp = avgSlice(hourly.apparent_temperature, useStart, useEnd);
    code = modeSlice(hourly.weather_code, useStart, useEnd);
    wind = maxSlice(hourly.wind_speed_10m, useStart, useEnd);
    precipProb = maxSlice(hourly.precipitation_probability, useStart, useEnd) ?? 0;
  } else {
    // Fallback: use daily extremes.
    planningTemp = period === 'night' ? daily.temperature_2m_min[dayIndex] : daily.temperature_2m_max[dayIndex];
    code = daily.weather_code[dayIndex];
    wind = daily.wind_speed_10m_max[dayIndex];
    precipProb = daily.precipitation_probability_max?.[dayIndex] ?? 0;
  }

  return {
    planningTemp,
    code,
    wind,
    precipProb,
    isPrecipNow: dayIndex === 0 && period === 'day' && weather.current.precipitation > 0,
    isToday: dayIndex === 0,
    period,
    high: daily.temperature_2m_max[dayIndex],
    low: daily.temperature_2m_min[dayIndex],
  };
}

function recommendOutfit(cond) {
  const tC = adjustedTemp(cond.planningTemp);
  const code = cond.code;
  const wind = cond.wind;
  const windKmh = settings.units === 'imperial' ? wind * 1.609 : wind;
  const precipProb = cond.precipProb;
  const isPrecipNow = cond.isPrecipNow;
  const isSnow = [71,73,75,77,85,86].includes(code);
  const isRain = [51,53,55,61,63,65,66,67,80,81,82,95,96,99].includes(code) || (isPrecipNow && !isSnow);
  const style = cond.style || settings.style;
  const gender = settings.gender;

  let headline = '';
  let items = [];
  let notes = [];

  // Top layer choice based on adjusted temp.
  if (tC <= -10) {
    headline = 'Bundle up — this is serious cold.';
    items.push('Heavy parka', 'Thermal base layer', 'Wool sweater', 'Insulated pants or thermals under pants');
    items.push('Warm hat', 'Insulated gloves', 'Scarf', 'Wool socks', 'Insulated boots');
  } else if (tC <= -2) {
    headline = 'Cold — winter coat weather.';
    items.push('Winter coat', 'Sweater or fleece', 'Long pants');
    items.push('Hat', 'Gloves', 'Scarf', 'Warm socks', 'Boots or sturdy shoes');
  } else if (tC <= 5) {
    headline = 'Chilly — heavy jacket.';
    items.push('Heavy jacket or wool coat', 'Sweater or long-sleeve top', 'Long pants');
    items.push('Closed shoes', 'Light gloves and a hat if you run cold');
  } else if (tC <= 10) {
    if (style === 'business') headline = 'Cool — overcoat over your blazer.';
    else headline = 'Cool — a proper jacket.';
    if (style === 'business') items.push('Overcoat or trench', 'Blazer', 'Sweater optional', 'Long pants', 'Dress shoes');
    else items.push('Insulated jacket or trench', 'Long-sleeve shirt or light sweater', 'Long pants', 'Closed shoes');
  } else if (tC <= 15) {
    if (style === 'business') headline = 'Mild — blazer with no heavy coat needed.';
    else headline = 'Mild — light jacket.';
    if (style === 'business') items.push('Blazer or light wool jacket', 'Long-sleeve shirt', 'Long pants', 'Dress shoes');
    else items.push('Light jacket or denim jacket', 'Long-sleeve top or light sweater', 'Long pants', 'Sneakers or loafers');
  } else if (tC <= 20) {
    if (style === 'business') headline = 'Pleasant — blazer, no coat.';
    else headline = 'Pleasant — long sleeves, maybe a layer.';
    if (style === 'business') items.push('Blazer (unlined or light)', 'Dress shirt', 'Trousers', 'Loafers or dress shoes');
    else items.push('Long-sleeve shirt or light layer', 'Pants or chinos', 'Sneakers');
  } else if (tC <= 25) {
    if (style === 'business') headline = 'Warm — drop the blazer or go unlined.';
    else headline = 'Warm — t-shirt weather.';
    if (style === 'business') items.push('Dress shirt (sleeves rolled)', 'Light blazer optional', 'Chinos or light trousers', 'Loafers');
    else items.push('T-shirt or short-sleeve shirt', 'Light pants, chinos, or shorts', 'Sneakers or sandals');
  } else if (tC <= 30) {
    headline = 'Hot — keep it light and breathable.';
    if (style === 'business') items.push('Light dress shirt (linen or cotton)', 'Light trousers', 'Loafers — skip the jacket');
    else items.push('T-shirt, tank, or short-sleeve shirt', 'Shorts or light pants', 'Sandals or breathable shoes');
    notes.push('Stay hydrated and seek shade.');
  } else {
    headline = 'Very hot — minimal layers, sun protection.';
    items.push('Lightweight, loose-fitting clothing', 'Shorts or light skirt', 'Hat or cap', 'Sunglasses', 'Sandals or breathable shoes');
    notes.push('Stay hydrated, avoid direct sun midday.');
  }

  // Gender styling tweaks (light touch).
  if (gender === 'femme') {
    if (tC > 15 && tC <= 25 && style === 'casual') items = items.map(i => i === 'Pants or chinos' ? 'Pants, jeans, or a skirt' : i);
    if (tC > 20 && tC <= 30 && style === 'casual') items = items.map(i => i === 'Light pants, chinos, or shorts' ? 'Light pants, shorts, or a sundress' : i);
  }

  // Rain & snow add-ons.
  if (isSnow) {
    items.push('Waterproof boots');
    notes.push('Snow expected — waterproof footwear and a hat help a lot.');
  } else if (isRain || precipProb >= 60) {
    items.push('Umbrella or rain jacket');
    if (precipProb >= 60 && !isPrecipNow) notes.push(`${precipProb}% chance of rain today.`);
  } else if (precipProb >= 30) {
    notes.push(`${precipProb}% chance of rain — maybe pack an umbrella.`);
  }

  // Wind.
  if (windKmh >= 35) {
    notes.push(`Windy (${Math.round(wind)} ${settings.units === 'imperial' ? 'mph' : 'km/h'}) — a windbreaker layer helps.`);
  }

  // Sun.
  if ([0,1].includes(code) && tC >= 18) {
    notes.push('Strong sun likely — sunglasses recommended.');
  }

  // Outdoor style override: emphasize layers.
  if (style === 'outdoor' && tC <= 15) {
    items.unshift('Moisture-wicking base layer');
  }

  return { headline, items: dedupe(items), notes: notes.join(' ') };
}

function dedupe(arr) { return [...new Set(arr)]; }

// Multi-day packing list: range of conditions across forecast.
function recommendPacking(weather, styleOverride) {
  const { daily } = weather;
  const style = styleOverride || settings.style;
  if (!daily.temperature_2m_max?.length) return null;
  const highs = daily.temperature_2m_max;
  const lows = daily.temperature_2m_min;
  const codes = daily.weather_code;
  const precipProbs = daily.precipitation_probability_max || [];

  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const anyRain = codes.some(c => [51,53,55,61,63,65,66,67,80,81,82,95,96,99].includes(c)) || precipProbs.some(p => p >= 50);
  const anySnow = codes.some(c => [71,73,75,77,85,86].includes(c));

  // Convert range to °C for shared logic.
  const minC = settings.units === 'imperial' ? (minLow - 32) * 5/9 : minLow;
  const maxC = settings.units === 'imperial' ? (maxHigh - 32) * 5/9 : maxHigh;

  const items = [];
  if (minC <= -2) items.push('Winter coat', 'Hat, gloves, scarf', 'Warm boots');
  else if (minC <= 8) items.push('Warm jacket', 'Sweater or fleece');
  else if (minC <= 14) items.push('Light jacket or blazer');
  if (maxC >= 22) items.push('T-shirts and lighter layers');
  if (maxC >= 27) items.push('Shorts or light pants', 'Sandals');
  if (maxC - minC >= 12) items.push('Layers — temperature swing across the trip');
  if (anyRain) items.push('Umbrella or rain jacket');
  if (anySnow) items.push('Waterproof boots');
  if (style === 'business') items.push('At least one blazer / smart outfit');
  if (style === 'outdoor') items.push('Active / hiking gear', 'Comfortable walking shoes');

  return dedupe(items);
}

// ---------- Rendering ----------

function fmtTemp(t) {
  if (t == null) return '—';
  return `${Math.round(t)}°${settings.units === 'imperial' ? 'F' : 'C'}`;
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function renderError(msg) {
  hide(els.loading); hide(els.result);
  els.error.textContent = msg;
  show(els.error);
}

function renderWeather(loc, weather) {
  hide(els.loading); hide(els.error);
  currentWeather = weather;
  currentLoc = loc;
  selectedDayIndex = 0;
  // Default period based on current local hour.
  const hour = new Date().getHours();
  selectedPeriod = (hour >= 19 || hour < 6) ? 'night' : 'day';
  syncPeriodButtons();
  const { daily, timezone } = weather;

  // Location name.
  const placeParts = [loc.name];
  if (loc.admin1 && loc.admin1 !== loc.name) placeParts.push(loc.admin1);
  if (loc.country) placeParts.push(loc.country);
  els.locationName.textContent = placeParts.filter(Boolean).join(', ');

  // Local time.
  try {
    const fmt = new Intl.DateTimeFormat([], {
      timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    // CSS uppercases this; output looks like "Sun 14:23"
    els.locationTime.textContent = fmt.format(new Date()).replace(',', '');
  } catch {
    els.locationTime.textContent = '';
  }

  // Forecast cells (clickable).
  els.forecast.innerHTML = '';
  for (let i = 0; i < daily.time.length; i++) {
    const d = new Date(daily.time[i] + 'T12:00:00');
    const dow = i === 0 ? 'Today' : d.toLocaleDateString([], { weekday: 'short' });
    const c = wmo(daily.weather_code[i], 1);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'day';
    cell.dataset.idx = i;
    cell.innerHTML = `
      <div class="dow">${dow}</div>
      <div class="ico">${c.icon}</div>
      <div class="hi">${fmtTemp(daily.temperature_2m_max[i])}</div>
      <div class="lo">${fmtTemp(daily.temperature_2m_min[i])}</div>
    `;
    cell.addEventListener('click', () => selectDay(i));
    els.forecast.appendChild(cell);
  }

  renderSelectedDay();

  // Reset the trip planner to this city as the primary destination, run it.
  tripDestinations = [{ ...loc }];
  show(els.result);
  updateFavStar();
  runTripPlanner();
}

function renderSelectedDay() {
  if (!currentWeather) return;
  const { current, daily } = currentWeather;
  const i = selectedDayIndex;
  const isToday = i === 0;
  const isDay = isToday ? current.is_day === 1 : true;
  const code = isToday ? current.weather_code : daily.weather_code[i];
  const condition = wmo(code, isDay);

  // Update day-cell active state.
  els.forecast.querySelectorAll('.day').forEach((cell, idx) => {
    cell.classList.toggle('active', idx === i);
  });

  // Now block (or "selected day" block).
  els.nowIcon.textContent = condition.icon;
  if (isToday) {
    els.nowTemp.textContent = fmtTemp(current.temperature_2m);
    els.nowFeels.textContent = `Feels like ${fmtTemp(current.apparent_temperature)}`;
    const windUnit = settings.units === 'imperial' ? 'mph' : 'km/h';
    els.nowMeta.textContent = `Humidity ${current.relative_humidity_2m}% · Wind ${Math.round(current.wind_speed_10m)} ${windUnit}`;
  } else {
    const hi = daily.temperature_2m_max[i];
    const lo = daily.temperature_2m_min[i];
    const d = new Date(daily.time[i] + 'T12:00:00');
    const dayLabel = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    els.nowTemp.textContent = `${fmtTemp(hi)}`;
    els.nowFeels.textContent = `${dayLabel} · low ${fmtTemp(lo)}`;
    const windUnit = settings.units === 'imperial' ? 'mph' : 'km/h';
    const wind = daily.wind_speed_10m_max[i];
    const pp = daily.precipitation_probability_max?.[i] ?? 0;
    els.nowMeta.textContent = `Wind up to ${Math.round(wind)} ${windUnit} · ${pp}% precip`;
  }
  els.nowDesc.textContent = condition.label;

  syncStyleButtons('rec');
  // Outfit for the selected day + period + style.
  const cond = conditionsFor(currentWeather, i, selectedPeriod);
  cond.style = recStyle || settings.style;
  const outfit = recommendOutfit(cond);
  // Clear label so the user knows what day/period the recommendation applies to.
  const recForEl = document.getElementById('recFor');
  if (recForEl) {
    const dLabel = i === 0
      ? 'today'
      : new Date(daily.time[i] + 'T12:00:00').toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    const pLabel = selectedPeriod === 'night' ? 'evening / overnight' : 'daytime (9am – 7pm)';
    const tempLabel = cond.planningTemp != null ? ` · feels ~${fmtTemp(cond.planningTemp)}` : '';
    recForEl.textContent = `Showing ${dLabel} · ${pLabel}${tempLabel}`;
  }
  els.outfitHeadline.textContent = outfit.headline;
  els.outfitList.innerHTML = '';
  outfit.items.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item;
    els.outfitList.appendChild(li);
  });
  els.outfitNotes.textContent = outfit.notes;
}

function selectDay(i) {
  selectedDayIndex = i;
  // Auto-default period when switching days: today picks based on current time, future days default to day.
  if (i === 0) {
    const hour = new Date().getHours();
    selectedPeriod = (hour >= 19 || hour < 6) ? 'night' : 'day';
  } else {
    selectedPeriod = 'day';
  }
  syncPeriodButtons();
  renderSelectedDay();
}

function syncPeriodButtons() {
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.period === selectedPeriod);
  });
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.period-btn');
  if (!btn) return;
  selectedPeriod = btn.dataset.period;
  syncPeriodButtons();
  renderSelectedDay();
});

// Style toggles (per-box: rec card and packing card).
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.style-btn');
  if (!btn) return;
  const wrap = btn.closest('.style-toggle');
  if (!wrap) return;
  const value = btn.dataset.style;
  if (wrap.classList.contains('rec-style-toggle')) {
    recStyle = value;
    syncStyleButtons('rec');
    renderSelectedDay();
  } else if (wrap.classList.contains('pack-style-toggle')) {
    packStyle = value;
    syncStyleButtons('pack');
    runTripPlanner();
  }
});

function syncStyleButtons(which) {
  const value = which === 'rec' ? (recStyle || settings.style) : (packStyle || settings.style);
  const selector = which === 'rec' ? '.rec-style-toggle .style-btn' : '.pack-style-toggle .style-btn';
  document.querySelectorAll(selector).forEach(b => {
    b.classList.toggle('active', b.dataset.style === value);
  });
}

// ---------- City flow ----------

async function loadCity(loc) {
  hide(els.error); hide(els.result);
  show(els.loading);
  try {
    const weather = await fetchWeather(loc.latitude, loc.longitude);
    setLastLocation(loc);
    renderWeather(loc, weather);
  } catch (e) {
    console.error(e);
    renderError("Couldn't load the forecast. Check your connection and try again.");
  }
}

// ---------- Geolocation ----------

function useMyLocation() {
  if (!navigator.geolocation) {
    renderError('Your browser does not support geolocation. Search for a city instead.');
    return;
  }
  show(els.loading);
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;
    const loc = await reverseGeocode(latitude, longitude);
    loadCity(loc);
  }, (err) => {
    console.warn(err);
    // Fall back to the last city the user viewed if we have one.
    const last = getLastLocation();
    if (last) {
      loadCity(last);
      return;
    }
    hide(els.loading);
    renderError('Could not get your location. Search for a city instead.');
  }, { timeout: 8000, maximumAge: 60000 });
}

els.locBtn.addEventListener('click', useMyLocation);

// ---------- Search / autocomplete ----------

let searchTimer = null;
let activeSuggestion = -1;
let currentResults = [];

els.input.addEventListener('input', () => {
  const q = els.input.value.trim();
  if (searchTimer) clearTimeout(searchTimer);
  if (q.length < 2) {
    els.suggestions.innerHTML = '';
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      const results = await geocodeCity(q);
      currentResults = results;
      activeSuggestion = -1;
      renderSuggestions(results);
    } catch (e) {
      console.error(e);
    }
  }, 200);
});

function renderSuggestions(results) {
  els.suggestions.innerHTML = '';
  results.forEach((r, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.dataset.idx = i;
    const place = [r.admin1, r.country].filter(Boolean).join(', ');
    li.innerHTML = `<strong>${escapeHtml(r.name)}</strong><span class="country">${escapeHtml(place)}</span>`;
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      pickResult(r);
    });
    els.suggestions.appendChild(li);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function pickResult(r) {
  els.input.value = `${r.name}${r.country ? ', ' + r.country : ''}`;
  els.suggestions.innerHTML = '';
  loadCity({
    name: r.name,
    admin1: r.admin1 || '',
    country: r.country || '',
    latitude: r.latitude,
    longitude: r.longitude,
  });
}

els.input.addEventListener('keydown', (e) => {
  const items = els.suggestions.querySelectorAll('li');
  if (e.key === 'ArrowDown' && items.length) {
    e.preventDefault();
    activeSuggestion = Math.min(activeSuggestion + 1, items.length - 1);
    updateActive(items);
  } else if (e.key === 'ArrowUp' && items.length) {
    e.preventDefault();
    activeSuggestion = Math.max(activeSuggestion - 1, 0);
    updateActive(items);
  } else if (e.key === 'Escape') {
    els.suggestions.innerHTML = '';
  }
});

function updateActive(items) {
  items.forEach((li, i) => li.classList.toggle('active', i === activeSuggestion));
}

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = els.input.value.trim();
  if (!q) return;
  // Use highlighted suggestion if any, else first result.
  if (activeSuggestion >= 0 && currentResults[activeSuggestion]) {
    pickResult(currentResults[activeSuggestion]);
    return;
  }
  try {
    show(els.loading);
    const results = await geocodeCity(q);
    if (!results.length) {
      hide(els.loading);
      renderError(`No city found for "${q}".`);
      return;
    }
    pickResult(results[0]);
  } catch (e) {
    console.error(e);
    renderError('Search failed. Try again.');
  }
});

// Click outside closes suggestions.
document.addEventListener('click', (e) => {
  if (!els.suggestions.contains(e.target) && e.target !== els.input) {
    els.suggestions.innerHTML = '';
  }
});

// ---------- Init ----------

(function init() {
  syncSettingsFormToState();
  renderFavorites();
  wireFavAndShare();
  wireTripPlanner();
  wireCompare();

  // Always default to the user's current location on a fresh load.
  // A shared link (?lat=&lon=) overrides; if geolocation fails, we fall
  // back to the last city the user viewed.
  const fromUrl = locFromUrl();
  if (fromUrl) loadCity(fromUrl);
  else useMyLocation();
})();

// ---------- Trip planner ----------

async function fetchTripWeather(lat, lon, startDate, endDate) {
  const tempUnit = settings.units === 'imperial' ? 'fahrenheit' : 'celsius';
  const windUnit = settings.units === 'imperial' ? 'mph' : 'kmh';
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',
    timezone: 'auto',
    temperature_unit: tempUnit,
    wind_speed_unit: windUnit,
    start_date: startDate,
    end_date: endDate,
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error('Trip forecast failed');
  return res.json();
}

function wireTripPlanner() {
  const startEl = document.getElementById('tripStart');
  const endEl = document.getElementById('tripEnd');
  const goBtn = document.getElementById('tripGo');
  const errEl = document.getElementById('tripError');
  const addBtn = document.getElementById('tripAddBtn');
  const addForm = document.getElementById('tripAddForm');
  const addInput = document.getElementById('tripAddInput');
  const addCancel = document.getElementById('tripAddCancel');
  const addSugg = document.getElementById('tripAddSuggestions');

  // Default dates: tomorrow → tomorrow+6 (a one-week trip starting next day).
  const fmtD = (d) => d.toISOString().slice(0, 10);
  const plus = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
  startEl.value = fmtD(plus(1));
  endEl.value = fmtD(plus(7));
  endEl.max = fmtD(plus(15)); // Open-Meteo free tier covers ~16 days ahead.
  tripDates.start = startEl.value;
  tripDates.end = endEl.value;

  // Re-run on date change.
  [startEl, endEl].forEach(el => el.addEventListener('change', () => {
    tripDates.start = startEl.value;
    tripDates.end = endEl.value;
    runTripPlanner();
  }));
  goBtn.addEventListener('click', () => runTripPlanner());

  // Add city flow.
  addBtn.addEventListener('click', () => {
    addBtn.classList.add('hidden');
    addForm.classList.remove('hidden');
    addInput.focus();
  });
  addCancel.addEventListener('click', () => {
    addForm.classList.add('hidden');
    addBtn.classList.remove('hidden');
    addInput.value = '';
    addSugg.innerHTML = '';
  });

  let addTimer = null;
  let addResults = [];
  addInput.addEventListener('input', () => {
    const q = addInput.value.trim();
    if (addTimer) clearTimeout(addTimer);
    if (q.length < 2) { addSugg.innerHTML = ''; return; }
    addTimer = setTimeout(async () => {
      try {
        addResults = await geocodeCity(q);
        addSugg.innerHTML = '';
        addResults.forEach((r) => {
          const li = document.createElement('li');
          const place = [r.admin1, r.country].filter(Boolean).join(', ');
          li.innerHTML = `<strong>${escapeHtml(r.name)}</strong><span class="country">${escapeHtml(place)}</span>`;
          li.addEventListener('mousedown', (e) => {
            e.preventDefault();
            addCity({
              name: r.name, admin1: r.admin1 || '', country: r.country || '',
              latitude: r.latitude, longitude: r.longitude,
            });
          });
          addSugg.appendChild(li);
        });
      } catch (err) { console.error(err); }
    }, 200);
  });
  addInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { addCancel.click(); }
    if (e.key === 'Enter' && addResults[0]) {
      e.preventDefault();
      const r = addResults[0];
      addCity({
        name: r.name, admin1: r.admin1 || '', country: r.country || '',
        latitude: r.latitude, longitude: r.longitude,
      });
    }
  });

  function addCity(loc) {
    // No duplicates by lat/lon.
    const key = (l) => `${(+l.latitude).toFixed(2)},${(+l.longitude).toFixed(2)}`;
    if (tripDestinations.some(d => key(d) === key(loc))) {
      addCancel.click();
      return;
    }
    tripDestinations.push(loc);
    addCancel.click();
    runTripPlanner();
  }
}

// Render destinations chip list inside the trip card.
function renderTripDestinations() {
  const ul = document.getElementById('tripCityList');
  if (!ul) return;
  ul.innerHTML = '';
  tripDestinations.forEach((loc, i) => {
    const li = document.createElement('li');
    li.className = 'trip-city';
    if (i === 0) li.classList.add('primary');
    const place = [loc.name, loc.country].filter(Boolean).join(', ');
    li.innerHTML = `
      <span class="trip-city-name">${escapeHtml(place)}</span>
      ${tripDestinations.length > 1 ? `<button type="button" class="trip-city-x" aria-label="Remove">×</button>` : ''}
    `;
    const x = li.querySelector('.trip-city-x');
    if (x) {
      x.addEventListener('click', () => {
        tripDestinations.splice(i, 1);
        runTripPlanner();
      });
    }
    ul.appendChild(li);
  });
}

// Fetch weather for all destinations across the trip range and merge for packing.
async function runTripPlanner() {
  const errEl = document.getElementById('tripError');
  const daysEl = document.getElementById('tripDays');
  const summaryEl = document.getElementById('tripSummary');
  const packingCard = document.getElementById('packingCard');
  const packingList = document.getElementById('packingList');
  if (!errEl || !daysEl || !summaryEl || !packingCard || !packingList) return;

  errEl.classList.add('hidden');

  // Make sure we have at least one destination (the current city).
  if (!tripDestinations.length && currentLoc) tripDestinations = [currentLoc];
  if (!tripDestinations.length) {
    packingCard.classList.add('hidden');
    return;
  }

  renderTripDestinations();

  const start = tripDates.start;
  const end = tripDates.end;
  if (!start || !end || start > end) {
    errEl.textContent = 'Pick a valid date range.';
    errEl.classList.remove('hidden');
    return;
  }
  const days = (new Date(end) - new Date(start)) / 86400000 + 1;
  if (days > 16) {
    errEl.textContent = 'Forecast only goes 16 days out.';
    errEl.classList.remove('hidden');
    return;
  }

  try {
    const allData = await Promise.all(
      tripDestinations.map(d => fetchTripWeather(d.latitude, d.longitude, start, end))
    );

    // Merge daily arrays across destinations: max highs, min lows, all codes, max precip prob, max wind.
    const ref = allData[0].daily;
    const merged = {
      time: ref.time.slice(),
      weather_code: ref.weather_code.slice(),
      temperature_2m_max: ref.temperature_2m_max.slice(),
      temperature_2m_min: ref.temperature_2m_min.slice(),
      precipitation_probability_max: (ref.precipitation_probability_max || []).slice(),
      wind_speed_10m_max: (ref.wind_speed_10m_max || []).slice(),
    };
    for (let c = 1; c < allData.length; c++) {
      const d = allData[c].daily;
      for (let i = 0; i < merged.time.length; i++) {
        if (d.temperature_2m_max[i] > merged.temperature_2m_max[i]) merged.temperature_2m_max[i] = d.temperature_2m_max[i];
        if (d.temperature_2m_min[i] < merged.temperature_2m_min[i]) merged.temperature_2m_min[i] = d.temperature_2m_min[i];
        if ((d.precipitation_probability_max?.[i] ?? 0) > (merged.precipitation_probability_max[i] ?? 0)) merged.precipitation_probability_max[i] = d.precipitation_probability_max[i];
        if ((d.wind_speed_10m_max?.[i] ?? 0) > (merged.wind_speed_10m_max[i] ?? 0)) merged.wind_speed_10m_max[i] = d.wind_speed_10m_max[i];
        // Keep the "worst" weather code (rough heuristic: higher code = more severe).
        if (d.weather_code[i] > merged.weather_code[i]) merged.weather_code[i] = d.weather_code[i];
      }
    }

    syncStyleButtons('pack');
    const packing = recommendPacking({ daily: merged }, packStyle || settings.style) || [];
    packingList.innerHTML = '';
    packing.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      packingList.appendChild(li);
    });
    if (packing.length) packingCard.classList.remove('hidden'); else packingCard.classList.add('hidden');

    // Day strip — show the merged ("worst-case") view, since it's what the packing list assumes.
    daysEl.innerHTML = '';
    for (let i = 0; i < merged.time.length; i++) {
      const d = new Date(merged.time[i] + 'T12:00:00');
      const dow = d.toLocaleDateString([], { weekday: 'short' });
      const dom = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      const c = wmo(merged.weather_code[i], 1);
      const cell = document.createElement('div');
      cell.className = 'day';
      cell.innerHTML = `
        <div class="dow">${dow} ${dom}</div>
        <div class="ico">${c.icon}</div>
        <div class="hi">${fmtTemp(merged.temperature_2m_max[i])}</div>
        <div class="lo">${fmtTemp(merged.temperature_2m_min[i])}</div>
      `;
      daysEl.appendChild(cell);
    }

    const startLabel = new Date(start + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' });
    const endLabel = new Date(end + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' });
    const cityNames = tripDestinations.map(d => d.name).join(' + ');
    summaryEl.textContent = `${cityNames} · ${startLabel} → ${endLabel} (${days} day${days === 1 ? '' : 's'})`;
  } catch (e) {
    console.error(e);
    errEl.textContent = 'Could not load the trip forecast.';
    errEl.classList.remove('hidden');
  }
}

// ---------- Compare cities ----------

function wireCompare() {
  const input = document.getElementById('compareInput');
  const sugg = document.getElementById('compareSuggestions');
  const result = document.getElementById('compareResult');
  const colA = document.getElementById('compareColA');
  const colB = document.getElementById('compareColB');
  let timer = null;
  let results = [];

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (timer) clearTimeout(timer);
    if (q.length < 2) { sugg.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try {
        results = await geocodeCity(q);
        sugg.innerHTML = '';
        results.forEach((r, i) => {
          const li = document.createElement('li');
          li.dataset.idx = i;
          const place = [r.admin1, r.country].filter(Boolean).join(', ');
          li.innerHTML = `<strong>${escapeHtml(r.name)}</strong><span class="country">${escapeHtml(place)}</span>`;
          li.addEventListener('mousedown', (e) => {
            e.preventDefault();
            sugg.innerHTML = '';
            input.value = `${r.name}${r.country ? ', ' + r.country : ''}`;
            renderCompare(r);
          });
          sugg.appendChild(li);
        });
      } catch (e) { console.error(e); }
    }, 200);
  });

  document.getElementById('compareForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    if (results.length) {
      sugg.innerHTML = '';
      renderCompare(results[0]);
    }
  });

  async function renderCompare(other) {
    if (!currentLoc) return;
    try {
      const otherLoc = {
        name: other.name, admin1: other.admin1 || '', country: other.country || '',
        latitude: other.latitude, longitude: other.longitude,
      };
      const [wA, wB] = await Promise.all([
        fetchWeather(currentLoc.latitude, currentLoc.longitude),
        fetchWeather(otherLoc.latitude, otherLoc.longitude),
      ]);
      colA.innerHTML = renderCompareColumn(currentLoc, wA);
      colB.innerHTML = renderCompareColumn(otherLoc, wB);
      result.classList.remove('hidden');
    } catch (e) {
      console.error(e);
    }
  }

  function renderCompareColumn(loc, weather) {
    const c = weather.current;
    const cond = wmo(c.weather_code, c.is_day === 1);
    const hour = new Date().getHours();
    const period = (hour >= 19 || hour < 6) ? 'night' : 'day';
    const outfit = recommendOutfit(conditionsFor(weather, 0, period));
    const place = [loc.name, loc.country].filter(Boolean).join(', ');
    const items = outfit.items.slice(0, 6).map(i => `<li>${escapeHtml(i)}</li>`).join('');
    return `
      <div class="cc-head">
        <div class="cc-name">${escapeHtml(place)}</div>
        <div class="cc-temp">${cond.icon} ${fmtTemp(c.temperature_2m)}</div>
      </div>
      <div class="cc-meta muted small">${escapeHtml(cond.label)} · feels ${fmtTemp(c.apparent_temperature)}</div>
      <div class="cc-headline">${escapeHtml(outfit.headline)}</div>
      <ul class="outfit-list">${items}</ul>
    `;
  }
}

function wireFavAndShare() {
  const fav = document.getElementById('favBtn');
  const share = document.getElementById('shareBtn');
  if (fav) fav.addEventListener('click', () => {
    if (currentLoc) toggleFavorite(currentLoc);
  });
  if (share) share.addEventListener('click', copyShareLink);
}
