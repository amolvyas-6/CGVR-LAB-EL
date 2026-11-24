import { describe, expect, it } from 'vitest';
import { DEFAULT_PROPELLANT_SETTINGS, estimatePropellant } from '../../src/physics/propellant.js';

const DEFAULT_MARS_TRANSFER = {
  valid: true,
  target: 'Mars',
  vInfDeparture: 3.0451398193,
  vInfArrival: 2.5694586069,
};

describe('estimatePropellant', () => {
  it('converts the default Mars excess speeds into two burns and a propellant estimate', () => {
    const estimate = estimatePropellant(DEFAULT_MARS_TRANSFER);
    expect(estimate.departureAltitudeKm).toBe(300);
    expect(estimate.captureAltitudeKm).toBe(300);
    expect(estimate.departureDeltaVKmPerSec).toBeCloseTo(3.61656, 5);
    expect(estimate.captureDeltaVKmPerSec).toBeCloseTo(2.05355, 5);
    expect(estimate.totalDeltaVKmPerSec).toBeCloseTo(5.67011, 5);
    expect(estimate.propellantKg).toBeCloseTo(5091.2047, 3);
    expect(estimate.propellantCostUsd).toBeCloseTo(50912.0472, 3);
  });

  it('uses Venus and Jupiter capture presets', () => {
    const venus = estimatePropellant({ ...DEFAULT_MARS_TRANSFER, target: 'Venus' });
    const jupiter = estimatePropellant({ ...DEFAULT_MARS_TRANSFER, target: 'Jupiter' });
    expect(venus.captureAltitudeKm).toBe(300);
    expect(jupiter.captureAltitudeKm).toBe(10000);
    expect(jupiter.captureDeltaVKmPerSec).toBeGreaterThan(venus.captureDeltaVKmPerSec);
  });

  it('scales with dry mass, decreases with Isp, and keeps pricing optional', () => {
    const baseline = estimatePropellant(DEFAULT_MARS_TRANSFER);
    const estimateWith = (settings) => estimatePropellant(DEFAULT_MARS_TRANSFER, {
      ...DEFAULT_PROPELLANT_SETTINGS,
      ...settings,
    });
    expect(estimateWith({ dryMassKg: 2000 }).propellantKg).toBeCloseTo(2 * baseline.propellantKg);
    expect(estimateWith({ specificImpulseSeconds: 400 }).propellantKg).toBeLessThan(baseline.propellantKg);
    expect(estimateWith({ pricePerKgUsd: null }).propellantKg).toBe(baseline.propellantKg);
    expect(estimateWith({ pricePerKgUsd: null }).propellantCostUsd).toBeNull();
    expect(estimateWith({ pricePerKgUsd: 0 }).propellantCostUsd).toBe(0);
  });

  it('withholds invalid and unrepresentable mass estimates', () => {
    expect(estimatePropellant({ ...DEFAULT_MARS_TRANSFER, valid: false })).toBeNull();
    expect(estimatePropellant({ ...DEFAULT_MARS_TRANSFER, vInfArrival: -1 })).toBeNull();
    expect(estimatePropellant(DEFAULT_MARS_TRANSFER, {
      ...DEFAULT_PROPELLANT_SETTINGS, dryMassKg: 0,
    })).toBeNull();
    expect(estimatePropellant(DEFAULT_MARS_TRANSFER, {
      ...DEFAULT_PROPELLANT_SETTINGS, specificImpulseSeconds: 0.01,
    })).toBeNull();
  });
});
