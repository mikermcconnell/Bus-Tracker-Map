const EARTH_RADIUS_METERS = 6371008.8;
export const DEFAULT_CLUSTER_THRESHOLD_METERS = 400;

function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) {
    return Infinity;
  }
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;
  const sinDeltaPhi = Math.sin(deltaPhi / 2);
  const sinDeltaLambda = Math.sin(deltaLambda / 2);
  const a = sinDeltaPhi * sinDeltaPhi +
    Math.cos(phi1) * Math.cos(phi2) *
    sinDeltaLambda * sinDeltaLambda;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

export function clusterVehicles(list, thresholdMeters = DEFAULT_CLUSTER_THRESHOLD_METERS) {
  const threshold = Math.max(0, Number(thresholdMeters) || DEFAULT_CLUSTER_THRESHOLD_METERS);
  const clusters = [];

  for (let i = 0; i < list.length; i += 1) {
    const vehicle = list[i];
    if (!vehicle || !Number.isFinite(vehicle.lat) || !Number.isFinite(vehicle.lon)) {
      continue;
    }
    let target = null;
    for (let j = 0; j < clusters.length; j += 1) {
      const candidate = clusters[j];
      const distance = haversineDistanceMeters(candidate.lat, candidate.lon, vehicle.lat, vehicle.lon);
      if (distance <= threshold) {
        target = candidate;
        break;
      }
    }
    if (!target) {
      target = {
        vehicles: [],
        lat: vehicle.lat,
        lon: vehicle.lon,
        count: 0
      };
      clusters.push(target);
    }
    target.vehicles.push(vehicle);
    target.count += 1;
    const weight = 1 / target.count;
    const invWeight = 1 - weight;
    target.lat = target.lat * invWeight + vehicle.lat * weight;
    target.lon = target.lon * invWeight + vehicle.lon * weight;
  }

  return clusters.map((cluster) => ({
    vehicles: cluster.vehicles,
    lat: cluster.lat,
    lon: cluster.lon
  }));
}

export function distanceBetweenMeters(lat1, lon1, lat2, lon2) {
  return haversineDistanceMeters(lat1, lon1, lat2, lon2);
}
