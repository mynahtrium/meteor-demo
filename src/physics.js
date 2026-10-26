// Shared impact math. Scene code and tests both use these so the
// displayed energy stays consistent with the simulation.

const JOULES_PER_KILOTON = 4.184e12;

export function meteorMassKg(density, radiusMeters) {
  const rho = Number(density);
  const radius = Number(radiusMeters);
  if (!(rho > 0) || !(radius > 0)) return 0;
  return rho * (4 / 3) * Math.PI * radius * radius * radius;
}

export function radiusFromMass(mass, density) {
  const m = Number(mass);
  const rho = Number(density);
  if (!(m > 0) || !(rho > 0)) return 0;
  return Math.cbrt((3 * m) / (4 * Math.PI * rho));
}

export function kilotonsFromJoules(joules) {
  const energy = Number(joules);
  if (!Number.isFinite(energy)) return 0;
  return energy / JOULES_PER_KILOTON;
}

// Angle from the local horizon. 90 is straight down, grazing impacts clamp to 5
// so crater scaling does not divide by zero.
export function impactAngleDegrees(velocity, surfaceNormal) {
  if (!velocity || velocity.lengthSq() === 0 || !surfaceNormal || surfaceNormal.lengthSq() === 0) {
    return 90;
  }
  const direction = velocity.clone().normalize();
  const normal = surfaceNormal.clone().normalize();
  const alignment = Math.min(1, Math.max(-1, direction.dot(normal)));
  const fromNormal = Math.acos(Math.abs(alignment)) * (180 / Math.PI);
  return Math.max(90 - fromNormal, 5);
}
