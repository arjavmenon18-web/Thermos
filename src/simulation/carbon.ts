/**
 * Operational Carbon Accounting Module for THERMOS (HOPE '26)
 *
 * Implements transparent, physically grounded operational carbon accounting:
 * Operational emissions (kg CO2e) = grid electricity (kWh) * intensity (g CO2e/kWh) / 1000
 * Emissions difference (kg CO2e) = baseline emissions - THERMOS emissions
 *
 * Sign convention:
 * Positive: lower estimated emissions with THERMOS
 * Negative: additional estimated emissions with THERMOS
 *
 * All regional factors are explicitly labelled illustrative scenarios based on
 * published regional grid averages (IEA, eGRID, EEA).
 */

export interface GridCarbonPreset {
  id: string;
  name: string;
  region: string;
  factorGPerKWh: number;
  source: string;
  notes: string;
}

export const REGIONAL_GRID_PRESETS: GridCarbonPreset[] = [
  {
    id: 'global',
    name: 'Global Grid Average',
    region: 'World (IEA 2024)',
    factorGPerKWh: 400,
    source: 'IEA World Energy Outlook (illustrative)',
    notes: 'Blended global average carbon intensity of electricity generation.',
  },
  {
    id: 'us_avg',
    name: 'US Grid Average',
    region: 'United States (EPA eGRID)',
    factorGPerKWh: 370,
    source: 'US EPA eGRID National Average (illustrative)',
    notes: 'US national generation mix (natural gas, renewables, nuclear, coal).',
  },
  {
    id: 'eu_mix',
    name: 'EU-27 Grid Mix',
    region: 'European Union (EEA)',
    factorGPerKWh: 230,
    source: 'European Environment Agency (illustrative)',
    notes: 'European mix with high renewable & nuclear generation share.',
  },
  {
    id: 'clean_hydro',
    name: 'Low-Carbon Hydro / Nuclear',
    region: 'Nordic / Hydro Region',
    factorGPerKWh: 30,
    source: 'Life-cycle low-carbon baseline (illustrative)',
    notes: 'Near-zero generation emissions typical of hydro or nuclear heavy grids.',
  },
  {
    id: 'coal_heavy',
    name: 'Coal-Dominant Regional Grid',
    region: 'High-Carbon Region',
    factorGPerKWh: 820,
    source: 'Subcritical coal fleet average (illustrative)',
    notes: 'Demonstrates high emissions sensitivity in regions reliant on coal power.',
  },
];

/**
 * Calculates total operational carbon emissions from electrical consumption.
 * @param gridKWh Total electrical energy consumed from the grid (kWh)
 * @param intensityGPerKWh Grid emission factor (g CO2e / kWh)
 * @returns Operational emissions in kilograms of CO2 equivalent (kg CO2e)
 */
export function calculateOperationalEmissionsKg(
  gridKWh: number,
  intensityGPerKWh: number
): number {
  if (gridKWh <= 0 || intensityGPerKWh <= 0) return 0;
  return (gridKWh * intensityGPerKWh) / 1000;
}

/**
 * Calculates emissions difference between a baseline controller and THERMOS.
 * Preserves mathematical sign:
 *   Positive: lower estimated emissions (savings)
 *   Negative: additional estimated emissions (overhead)
 */
export function calculateEmissionsDifferenceKg(
  baselineKWh: number,
  thermosKWh: number,
  intensityGPerKWh: number
): number {
  const baselineKg = calculateOperationalEmissionsKg(baselineKWh, intensityGPerKWh);
  const thermosKg = calculateOperationalEmissionsKg(thermosKWh, intensityGPerKWh);
  return baselineKg - thermosKg;
}

/**
 * Separately estimates external heat recipient displaced boiler emissions.
 * CRITICAL: This is strictly kept separate from data-centre operational emissions
 * to avoid double-counting or misleading carbon neutrality claims.
 * @param avoidedExternalThermalKWh Thermal energy delivered that displaced on-site heating
 * @param displacedBoilerFactorGPerKWh Reference heating fuel factor (e.g. natural gas boiler ~202 g CO2e / kWh_th)
 */
export function calculateExternalHeatDisplacedEmissionsKg(
  avoidedExternalThermalKWh: number,
  displacedBoilerFactorGPerKWh = 202
): number {
  if (avoidedExternalThermalKWh <= 0) return 0;
  return (avoidedExternalThermalKWh * displacedBoilerFactorGPerKWh) / 1000;
}
