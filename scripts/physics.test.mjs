import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  impactAngleDegrees,
  kilotonsFromJoules,
  meteorMassKg,
  radiusFromMass
} from '../src/physics.js';

test('meteor mass uses sphere volume', () => {
  const density = 1600;
  const radius = 5000;
  const mass = meteorMassKg(density, radius);
  const expected = density * (4 / 3) * Math.PI * radius ** 3;
  assert.ok(Math.abs(mass - expected) / expected < 1e-12);
  const legacy = density * radius * Math.PI;
  assert.ok(mass > legacy * 1e6);
});

test('radius round-trips through mass', () => {
  const density = 3000;
  const radius = 12.5;
  assert.ok(Math.abs(radiusFromMass(meteorMassKg(density, radius), density) - radius) < 1e-6);
  assert.equal(radiusFromMass(0, density), 0);
  assert.equal(radiusFromMass(10, 0), 0);
  assert.equal(meteorMassKg(-1, 10), 0);
});

test('kilotons use the joule definition of a kiloton of TNT', () => {
  assert.ok(Math.abs(kilotonsFromJoules(4.184e12) - 1) < 1e-12);
  assert.equal(kilotonsFromJoules(Number.NaN), 0);
});

test('impact angle treats a head-on hit as vertical', () => {
  const downward = new THREE.Vector3(0, -1, 0);
  const outward = new THREE.Vector3(0, 1, 0);
  assert.ok(Math.abs(impactAngleDegrees(downward, outward) - 90) < 1e-6);
  assert.equal(impactAngleDegrees(new THREE.Vector3(1, 0, 0), outward), 5);
  assert.equal(impactAngleDegrees(new THREE.Vector3(), outward), 90);
});
