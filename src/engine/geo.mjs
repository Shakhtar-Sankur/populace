// Movement.
//
// People don't teleport. Each one gets a looping set of waypoints around their
// city and walks between them at their own speed, so the location updates your
// app receives look like a real shift rather than a random-number generator.

const R = 6371; // km

export function haversineKm(a, b) {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** A closed loop of waypoints around a centre, unique per seed. */
export function buildRoute(center, seed, legs = 6, radiusKm = 4) {
  const pts = [];
  const jitter = (n) => (Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453) % 1;
  for (let i = 0; i < legs; i++) {
    const angle = (i / legs) * Math.PI * 2 + jitter(i);
    const r = radiusKm * (0.55 + Math.abs(jitter(i + 7)) * 0.75);
    pts.push({
      lat: center.lat + (r / 111) * Math.cos(angle),
      lng: center.lng + (r / (111 * Math.cos((center.lat * Math.PI) / 180))) * Math.sin(angle),
    });
  }
  return pts;
}

/**
 * Advance along the route by `km`, returning the new position and leg index.
 * Wraps around the loop so a shift can run indefinitely.
 */
export function advance(route, legIndex, progressKm, km) {
  let leg = legIndex;
  let progress = progressKm + km;
  for (let guard = 0; guard < route.length * 2; guard++) {
    const from = route[leg % route.length];
    const to = route[(leg + 1) % route.length];
    const legKm = haversineKm(from, to);
    if (progress < legKm || legKm === 0) {
      const t = legKm === 0 ? 0 : progress / legKm;
      return {
        position: {
          lat: from.lat + (to.lat - from.lat) * t,
          lng: from.lng + (to.lng - from.lng) * t,
        },
        legIndex: leg,
        progressKm: progress,
      };
    }
    progress -= legKm;
    leg += 1;
  }
  return { position: route[0], legIndex: 0, progressKm: 0 };
}
