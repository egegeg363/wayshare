/**
 * WayShare geospatial & detour engine.
 *
 * Everything in this module is pure, deterministic and isomorphic: the browser uses it
 * for instant previews, the API uses it for eligibility + pricing, and the seed script
 * uses it to build consistent demo data. Live network services (OSRM road routing and
 * Nominatim geocoding) live in `src/lib/server/geo-services.ts` and always fall back to
 * the functions below, so quotes are reproducible online or offline.
 */

export type LatLng = { lat: number; lng: number };

export type PlaceSource = "directory" | "nominatim" | "pin";

export type Place = LatLng & {
  /** Short display name, e.g. "Leipzig". */
  name: string;
  /** Secondary line, e.g. "Saxony, Germany" or a full street address. */
  detail?: string;
  source: PlaceSource;
};

/** Average ratio between real road distance and great-circle distance in Central Europe. */
export const ROAD_WINDING_FACTOR = 1.22;
/** Extra minutes per extra detour kilometre (detours run on slower, local roads). */
export const DETOUR_MINUTES_PER_KM = 1.15;
/** Blended motorway/urban speed used to estimate trip duration when OSRM is unavailable. */
export const ESTIMATED_TRIP_SPEED_KMH = 84;
/** Comparison tolerance for floating point kilometre values. */
const KM_EPSILON = 1e-6;
const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Round a distance to 0.1 km — the precision we store, quote and compare at. */
export function roundKm(km: number): number {
  return Math.round((km + Number.EPSILON) * 10) / 10;
}

/** Great-circle distance between two coordinates (Haversine formula), in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimated road distance: Haversine × road-winding factor. */
export function roadDistanceKm(a: LatLng, b: LatLng): number {
  return haversineKm(a, b) * ROAD_WINDING_FACTOR;
}

/** Estimated driving time for a road distance, in whole minutes. */
export function estimateDurationMin(distanceKm: number): number {
  return Math.max(1, Math.round((distanceKm / ESTIMATED_TRIP_SPEED_KMH) * 60));
}

/** Deterministic route estimate used whenever live routing is unavailable. */
export function estimateRoute(points: LatLng[]): { distanceKm: number; durationMin: number } {
  let distance = 0;
  for (let i = 1; i < points.length; i++) distance += roadDistanceKm(points[i - 1], points[i]);
  return { distanceKm: roundKm(distance), durationMin: estimateDurationMin(distance) };
}

/** A ride's route as a polyline from origin to destination (road geometry, or a straight segment). */
export type RoutePath = LatLng[];

/** Fallback route when no road geometry is known. */
export function straightRoute(origin: LatLng, destination: LatLng): RoutePath {
  return [origin, destination];
}

export type RouteProjection = {
  /** Closest point of the route to P. */
  point: LatLng;
  /** Distance from P to that point (km, straight line). */
  distanceKm: number;
  /** Distance along the route from its start to that point (km). */
  alongKm: number;
  /** Total route length (km). */
  totalKm: number;
};

/**
 * Projects P onto a route polyline. The nearest segment is found in a local planar
 * projection (accurate at regional scales); the distance itself is measured with Haversine.
 */
export function projectOntoRoute(p: LatLng, route: RoutePath): RouteProjection {
  if (route.length === 0) return { point: p, distanceKm: 0, alongKm: 0, totalKm: 0 };
  if (route.length === 1) return { point: route[0], distanceKm: haversineKm(p, route[0]), alongKm: 0, totalKm: 0 };
  const kx = 111.32 * Math.cos(toRad(p.lat));
  const ky = 110.574;
  const cumulative = [0];
  for (let i = 1; i < route.length; i++) cumulative.push(cumulative[i - 1] + haversineKm(route[i - 1], route[i]));
  let best = { point: route[0], distanceSq: Infinity, segment: 0, t: 0 };
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const ax = (a.lng - p.lng) * kx;
    const ay = (a.lat - p.lat) * ky;
    const dx = (b.lng - p.lng) * kx - ax;
    const dy = (b.lat - p.lat) * ky - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));
    const x = ax + t * dx;
    const y = ay + t * dy;
    const distanceSq = x * x + y * y;
    if (distanceSq < best.distanceSq) {
      best = { point: { lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng) }, distanceSq, segment: i - 1, t };
    }
  }
  const segmentKm = cumulative[best.segment + 1] - cumulative[best.segment];
  return {
    point: best.point,
    distanceKm: haversineKm(p, best.point),
    alongKm: cumulative[best.segment] + best.t * segmentKm,
    totalKm: cumulative[cumulative.length - 1],
  };
}

/** Closest point to `p` on a polyline — used to draw the dotted leg from a pickup to the route. */
export function nearestPointOnPath(p: LatLng, path: LatLng[]): LatLng | null {
  return path.length ? projectOntoRoute(p, path).point : null;
}

export type DetourResult = {
  /** How far the pickup lies from the driver's route (km, straight line). */
  offRouteKm: number;
  /** Extra road distance to fetch the passenger: there and back, ΔD = 2 × offRoute × 1.22. */
  detourDistanceKm: number;
  /** ΔT = round(ΔD × 1.15) minutes */
  detourDurationMin: number;
};

/**
 * Detour for a pickup at P on a ride following `route` (origin → destination).
 *
 *   offRoute = distance from P to the route line
 *   ΔD       = 2 × offRoute × 1.22    (leave the route, collect the passenger, come back — on roads)
 *   ΔT       = round(ΔD × 1.15) minutes
 *
 * Measuring against the actual route — not a straight A→B line — keeps the eligible area a
 * band along the road, the same width everywhere, exactly as the map draws it.
 */
export function computeDetour(route: RoutePath, pickup: LatLng): DetourResult {
  const offRouteKm = roundKm(projectOntoRoute(pickup, route).distanceKm);
  const detourDistanceKm = roundKm(2 * offRouteKm * ROAD_WINDING_FACTOR);
  return {
    offRouteKm,
    detourDistanceKm,
    detourDurationMin: Math.round(detourDistanceKm * DETOUR_MINUTES_PER_KM),
  };
}

/**
 * Fraction of the route a passenger boarding at P actually rides: the distance left along
 * the route from P's nearest point to the destination, over the full route length.
 * (Everyone is dropped at the driver's destination.)
 */
export function routeShare(route: RoutePath, pickup: LatLng): number {
  const { alongKm, totalKm } = projectOntoRoute(pickup, route);
  if (totalKm < 0.01) return 1;
  return Math.min(1, Math.max(0, (totalKm - alongKm) / totalKm));
}

export type IneligibleReason = "RIDE_NOT_OPEN" | "NOT_ENOUGH_SEATS" | "DETOUR_EXCEEDED";

export type Eligibility = {
  isOpen: boolean;
  hasEnoughSeats: boolean;
  isWithinDetourRadius: boolean;
  isEligible: boolean;
  /** First blocking reason, in the order a passenger would want to hear it. */
  reason: IneligibleReason | null;
};

/**
 * A pickup is eligible iff
 *   offRoute ≤ ride.remainingDetourKm  ∧  seatsRequested ≤ ride.availableSeats  ∧  ride.status = "OPEN"
 * where remainingDetourKm is the driver's pickup radius still unused by earlier pickups.
 */
export function checkEligibility(
  ride: { status: string; availableSeats: number; remainingDetourKm: number },
  offRouteKm: number,
  seatsRequested: number,
): Eligibility {
  const isOpen = ride.status === "OPEN";
  const hasEnoughSeats = seatsRequested <= ride.availableSeats;
  const isWithinDetourRadius = offRouteKm <= ride.remainingDetourKm + KM_EPSILON;
  const reason: IneligibleReason | null = !isOpen
    ? "RIDE_NOT_OPEN"
    : !isWithinDetourRadius
      ? "DETOUR_EXCEEDED"
      : !hasEnoughSeats
        ? "NOT_ENOUGH_SEATS"
        : null;
  return { isOpen, hasEnoughSeats, isWithinDetourRadius, isEligible: reason === null, reason };
}

// Google encoded-polyline format (precision 5) — compact storage for route geometry,
// and the format OSRM can return directly.
function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

export function encodePolyline(points: LatLng[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let out = "";
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    out += encodeValue(lat - lastLat) + encodeValue(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return out;
}

export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    const deltas: number[] = [];
    for (let k = 0; k < 2; k++) {
      let shift = 0;
      let result = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < encoded.length);
      deltas.push(result & 1 ? ~(result >> 1) : result >> 1);
    }
    lat += deltas[0];
    lng += deltas[1];
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

export function isValidLatLng(p: Partial<LatLng> | null | undefined): p is LatLng {
  return (
    !!p &&
    typeof p.lat === "number" &&
    typeof p.lng === "number" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}

export function samePoint(a: LatLng | null | undefined, b: LatLng | null | undefined, toleranceKm = 0.05) {
  if (!a || !b) return a === b;
  return haversineKm(a, b) <= toleranceKm;
}

export function formatCoords(p: LatLng, digits = 4): string {
  const lat = `${Math.abs(p.lat).toFixed(digits)}°${p.lat >= 0 ? "N" : "S"}`;
  const lng = `${Math.abs(p.lng).toFixed(digits)}°${p.lng >= 0 ? "E" : "W"}`;
  return `${lat}, ${lng}`;
}

// ---------------------------------------------------------------------------------------
// City & town directory — instant, offline autocomplete. Coordinates are city centres.
// ---------------------------------------------------------------------------------------

type DirectoryEntry = {
  name: string;
  region: string;
  country: string;
  lat: number;
  lng: number;
  aliases?: string[];
};

const DIRECTORY: DirectoryEntry[] = [
  // Germany
  { name: "Berlin", region: "Berlin", country: "Germany", lat: 52.52, lng: 13.405 },
  { name: "Hamburg", region: "Hamburg", country: "Germany", lat: 53.5511, lng: 9.9937 },
  { name: "Munich", region: "Bavaria", country: "Germany", lat: 48.1351, lng: 11.582, aliases: ["München", "Muenchen"] },
  { name: "Cologne", region: "North Rhine-Westphalia", country: "Germany", lat: 50.9375, lng: 6.9603, aliases: ["Köln", "Koeln"] },
  { name: "Frankfurt", region: "Hesse", country: "Germany", lat: 50.1109, lng: 8.6821, aliases: ["Frankfurt am Main"] },
  { name: "Stuttgart", region: "Baden-Württemberg", country: "Germany", lat: 48.7758, lng: 9.1829 },
  { name: "Düsseldorf", region: "North Rhine-Westphalia", country: "Germany", lat: 51.2277, lng: 6.7735, aliases: ["Duesseldorf"] },
  { name: "Leipzig", region: "Saxony", country: "Germany", lat: 51.3397, lng: 12.3731 },
  { name: "Dresden", region: "Saxony", country: "Germany", lat: 51.0504, lng: 13.7373 },
  { name: "Nuremberg", region: "Bavaria", country: "Germany", lat: 49.4521, lng: 11.0767, aliases: ["Nürnberg", "Nuernberg"] },
  { name: "Hanover", region: "Lower Saxony", country: "Germany", lat: 52.3759, lng: 9.732, aliases: ["Hannover"] },
  { name: "Bremen", region: "Bremen", country: "Germany", lat: 53.0793, lng: 8.8017 },
  { name: "Dortmund", region: "North Rhine-Westphalia", country: "Germany", lat: 51.5136, lng: 7.4653 },
  { name: "Essen", region: "North Rhine-Westphalia", country: "Germany", lat: 51.4556, lng: 7.0116 },
  { name: "Duisburg", region: "North Rhine-Westphalia", country: "Germany", lat: 51.4344, lng: 6.7623 },
  { name: "Bonn", region: "North Rhine-Westphalia", country: "Germany", lat: 50.7374, lng: 7.0982 },
  { name: "Münster", region: "North Rhine-Westphalia", country: "Germany", lat: 51.9607, lng: 7.6261, aliases: ["Muenster"] },
  { name: "Bielefeld", region: "North Rhine-Westphalia", country: "Germany", lat: 52.0302, lng: 8.5325 },
  { name: "Osnabrück", region: "Lower Saxony", country: "Germany", lat: 52.2799, lng: 8.0472, aliases: ["Osnabrueck"] },
  { name: "Aachen", region: "North Rhine-Westphalia", country: "Germany", lat: 50.7753, lng: 6.0839 },
  { name: "Mannheim", region: "Baden-Württemberg", country: "Germany", lat: 49.4875, lng: 8.466 },
  { name: "Heidelberg", region: "Baden-Württemberg", country: "Germany", lat: 49.3988, lng: 8.6724 },
  { name: "Karlsruhe", region: "Baden-Württemberg", country: "Germany", lat: 49.0069, lng: 8.4037 },
  { name: "Heilbronn", region: "Baden-Württemberg", country: "Germany", lat: 49.1427, lng: 9.2109 },
  { name: "Freiburg", region: "Baden-Württemberg", country: "Germany", lat: 47.999, lng: 7.8421, aliases: ["Freiburg im Breisgau"] },
  { name: "Ulm", region: "Baden-Württemberg", country: "Germany", lat: 48.4011, lng: 9.9876 },
  { name: "Darmstadt", region: "Hesse", country: "Germany", lat: 49.8728, lng: 8.6512 },
  { name: "Wiesbaden", region: "Hesse", country: "Germany", lat: 50.0782, lng: 8.2398 },
  { name: "Mainz", region: "Rhineland-Palatinate", country: "Germany", lat: 49.9929, lng: 8.2473 },
  { name: "Kassel", region: "Hesse", country: "Germany", lat: 51.3127, lng: 9.4797 },
  { name: "Fulda", region: "Hesse", country: "Germany", lat: 50.5558, lng: 9.6808 },
  { name: "Göttingen", region: "Lower Saxony", country: "Germany", lat: 51.5413, lng: 9.9158, aliases: ["Goettingen"] },
  { name: "Brunswick", region: "Lower Saxony", country: "Germany", lat: 52.2689, lng: 10.5268, aliases: ["Braunschweig"] },
  { name: "Wolfsburg", region: "Lower Saxony", country: "Germany", lat: 52.4227, lng: 10.7865 },
  { name: "Magdeburg", region: "Saxony-Anhalt", country: "Germany", lat: 52.1205, lng: 11.6276 },
  { name: "Halle (Saale)", region: "Saxony-Anhalt", country: "Germany", lat: 51.4828, lng: 11.9697, aliases: ["Halle"] },
  { name: "Potsdam", region: "Brandenburg", country: "Germany", lat: 52.3906, lng: 13.0645 },
  { name: "Erfurt", region: "Thuringia", country: "Germany", lat: 50.9848, lng: 11.0299 },
  { name: "Jena", region: "Thuringia", country: "Germany", lat: 50.9271, lng: 11.5892 },
  { name: "Chemnitz", region: "Saxony", country: "Germany", lat: 50.8278, lng: 12.9214 },
  { name: "Bayreuth", region: "Bavaria", country: "Germany", lat: 49.9456, lng: 11.5713 },
  { name: "Bamberg", region: "Bavaria", country: "Germany", lat: 49.8988, lng: 10.9028 },
  { name: "Würzburg", region: "Bavaria", country: "Germany", lat: 49.7913, lng: 9.9534, aliases: ["Wuerzburg"] },
  { name: "Ingolstadt", region: "Bavaria", country: "Germany", lat: 48.7665, lng: 11.4258 },
  { name: "Regensburg", region: "Bavaria", country: "Germany", lat: 49.0134, lng: 12.1016 },
  { name: "Augsburg", region: "Bavaria", country: "Germany", lat: 48.3705, lng: 10.8978 },
  { name: "Passau", region: "Bavaria", country: "Germany", lat: 48.5665, lng: 13.4312 },
  { name: "Rosenheim", region: "Bavaria", country: "Germany", lat: 47.8571, lng: 12.1181 },
  { name: "Lübeck", region: "Schleswig-Holstein", country: "Germany", lat: 53.8655, lng: 10.6866, aliases: ["Luebeck"] },
  { name: "Kiel", region: "Schleswig-Holstein", country: "Germany", lat: 54.3233, lng: 10.1228 },
  // Austria
  { name: "Vienna", region: "Vienna", country: "Austria", lat: 48.2082, lng: 16.3738, aliases: ["Wien"] },
  { name: "Salzburg", region: "Salzburg", country: "Austria", lat: 47.8095, lng: 13.055 },
  { name: "Linz", region: "Upper Austria", country: "Austria", lat: 48.3069, lng: 14.2858 },
  { name: "St. Pölten", region: "Lower Austria", country: "Austria", lat: 48.2047, lng: 15.6256, aliases: ["Sankt Pölten", "St. Poelten"] },
  { name: "Innsbruck", region: "Tyrol", country: "Austria", lat: 47.2692, lng: 11.4041 },
  { name: "Graz", region: "Styria", country: "Austria", lat: 47.0707, lng: 15.4395 },
  // Netherlands
  { name: "Amsterdam", region: "North Holland", country: "Netherlands", lat: 52.3676, lng: 4.9041 },
  { name: "Rotterdam", region: "South Holland", country: "Netherlands", lat: 51.9244, lng: 4.4777 },
  { name: "The Hague", region: "South Holland", country: "Netherlands", lat: 52.0705, lng: 4.3007, aliases: ["Den Haag"] },
  { name: "Utrecht", region: "Utrecht", country: "Netherlands", lat: 52.0907, lng: 5.1214 },
  { name: "Eindhoven", region: "North Brabant", country: "Netherlands", lat: 51.4416, lng: 5.4697 },
  { name: "Breda", region: "North Brabant", country: "Netherlands", lat: 51.5719, lng: 4.7683 },
  // Belgium & Luxembourg
  { name: "Brussels", region: "Brussels-Capital", country: "Belgium", lat: 50.8503, lng: 4.3517, aliases: ["Bruxelles", "Brussel"] },
  { name: "Antwerp", region: "Flanders", country: "Belgium", lat: 51.2194, lng: 4.4025, aliases: ["Antwerpen", "Anvers"] },
  { name: "Mechelen", region: "Flanders", country: "Belgium", lat: 51.0259, lng: 4.4776, aliases: ["Malines"] },
  { name: "Ghent", region: "Flanders", country: "Belgium", lat: 51.0543, lng: 3.7174, aliases: ["Gent"] },
  { name: "Liège", region: "Wallonia", country: "Belgium", lat: 50.6326, lng: 5.5797, aliases: ["Liege", "Luik"] },
  { name: "Luxembourg", region: "Luxembourg", country: "Luxembourg", lat: 49.6116, lng: 6.1319 },
  // Neighbours
  { name: "Zurich", region: "Zurich", country: "Switzerland", lat: 47.3769, lng: 8.5417, aliases: ["Zürich"] },
  { name: "Basel", region: "Basel-Stadt", country: "Switzerland", lat: 47.5596, lng: 7.5886 },
  { name: "Strasbourg", region: "Grand Est", country: "France", lat: 48.5734, lng: 7.7521, aliases: ["Straßburg"] },
  { name: "Paris", region: "Île-de-France", country: "France", lat: 48.8566, lng: 2.3522 },
  { name: "Prague", region: "Prague", country: "Czechia", lat: 50.0755, lng: 14.4378, aliases: ["Praha", "Prag"] },
  { name: "Copenhagen", region: "Capital Region", country: "Denmark", lat: 55.6761, lng: 12.5683, aliases: ["København"] },
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toPlace(entry: DirectoryEntry): Place {
  return {
    name: entry.name,
    detail: entry.region === entry.name ? entry.country : `${entry.region}, ${entry.country}`,
    lat: entry.lat,
    lng: entry.lng,
    source: "directory",
  };
}

/** Every directory city as a Place (used by the seed and the "nearest town" labeler). */
export const CITY_DIRECTORY: readonly Place[] = DIRECTORY.map(toPlace);

const SEARCH_INDEX = DIRECTORY.map((entry) => ({
  entry,
  keys: [entry.name, ...(entry.aliases ?? [])].map(normalize),
}));

/** Instant offline autocomplete: prefix matches first, then word and substring matches. */
export function searchDirectory(query: string, limit = 6): Place[] {
  const q = normalize(query);
  if (!q) return [];
  // Words of a longer query ("Leipzig Hbf", "Berlin Alexanderplatz") still find their city.
  const words = q.split(" ").filter((word) => word.length >= 3);
  const scored: { entry: DirectoryEntry; score: number }[] = [];
  for (const { entry, keys } of SEARCH_INDEX) {
    let score = 0;
    for (const key of keys) {
      if (key === q) score = Math.max(score, 5);
      else if (key.startsWith(q)) score = Math.max(score, 4);
      else if (key.split(" ").some((word) => word.startsWith(q))) score = Math.max(score, 3);
      else if (q.length >= 3 && key.includes(q)) score = Math.max(score, 2);
      else if (words.length > 1 && words.some((word) => key === word || key.startsWith(word))) {
        score = Math.max(score, 1);
      }
    }
    if (score > 0) scored.push({ entry, score });
  }
  return scored
    .sort((x, y) => y.score - x.score || x.entry.name.localeCompare(y.entry.name))
    .slice(0, limit)
    .map(({ entry }) => toPlace(entry));
}

/** Exact (normalised) lookup by city name or alias. */
export function findCity(name: string): Place | null {
  const q = normalize(name);
  const hit = SEARCH_INDEX.find(({ keys }) => keys.includes(q));
  return hit ? toPlace(hit.entry) : null;
}

/** Nearest directory city — used to label dropped pins when reverse geocoding is offline. */
export function nearestCity(point: LatLng): { place: Place; distanceKm: number } {
  let best = CITY_DIRECTORY[0];
  let bestDistance = Infinity;
  for (const place of CITY_DIRECTORY) {
    const d = haversineKm(point, place);
    if (d < bestDistance) {
      best = place;
      bestDistance = d;
    }
  }
  return { place: best, distanceKm: bestDistance };
}
