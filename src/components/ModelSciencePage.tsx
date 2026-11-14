import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import * as E from '../simulation/engine';
import modelMetrics from '../data/model_metrics.json';

export const ModelSciencePage: React.FC = () => {
  const [expandedSection, setExpandedSection] = useState<number | null>(0);

  const sections = [
    {
      num: '01',
      title: 'Per-Rack First-Law Thermal Capacitance ODE',
      summary:
        '1-minute sub-stepped enthalpy balance modeling individual rack thermal mass, local damper conductance, neighboring recirculation, and hydronic extraction.',
      equations: `P_compute_i = 0.36 + 3.84 · L_i                                   kW
f_eff_i     = max(0.16, F · damper_i · zoneFactor_i - B_i - ambientDerate)
G_air_i     = 1.06 · f_eff_i                                      kW / °C
dT_i / dt   = (P_compute_i + Q_recirc_i + Q_zone_i - Q_cool_i - Q_hydronic_i) / C_th_i`,
      notes:
        'Integrated across five 60-second sub-steps per 5-minute control interval. Rack thermal mass C_th_i spans 144–172 kJ/°C across R01–R12. R07 carries a 30% airflow restriction (B_6 = 0.30) and R08 carries 16.5% (B_7 = 0.165).',
    },
    {
      num: '02',
      title: 'Hybrid Random Forest & Enthalpy-Flux Forecasting',
      summary:
        '24-tree regression forest fused with local physics-informed enthalpy lookahead and calibrated 95th-percentile uncertainty bounds.',
      equations: `Inputs      = [T_est_i, L_i, n_i, S_supply, F_eff_i, T_ambient, B_i]
ΔT_hybrid_i = 0.28 · RF_24(Inputs) + 0.72 · ΔT_physics_15m(Inputs)
T_upper_i   = (T_est_i + ΔT_hybrid_i) + Q95_cal + Uncertainty_sensor_i`,
      notes:
        `The 24-tree Random Forest is evaluated across ${modelMetrics.metrics.test_episodes} synthetic held-out test episodes (${modelMetrics.metrics.test_samples.toLocaleString()} samples) with a simulated test MAE of ${modelMetrics.metrics.hybrid_mae_c.toFixed(3)}°C, R² of ${modelMetrics.metrics.hybrid_r2.toFixed(3)} (vs ${modelMetrics.metrics.persistence_mae_c.toFixed(2)}°C persistence), calibrated conformal Q95 margin of ±${modelMetrics.calibration_q95.toFixed(4)}°C, and ${modelMetrics.metrics.test_95_interval_coverage_pct.toFixed(1)}% empirical coverage. These are synthetic simulator evaluation metrics, not validated guarantees of real-world hardware performance.`,
    },
    {
      num: '03',
      title: 'Sparse-Sensor Spatial Reconstruction',
      summary:
        'Virtual sensor estimation for uninstrumented or failed rack probes using expected equilibrium priors and inverse-distance-squared residuals.',
      equations: `w_ij        = 1 / (1 + ManhattanDistance(i, j)²)
T_est_i     = T_prior_i + Σ [w_ij · (T_read_j - T_prior_j)] / Σ w_ij
Margin_i    = 0.12°C (sensed) | 0.75°C (unsensed) | +0.45°C (R07 fault)`,
      notes:
        'Physical probes include deterministic ±0.08°C measurement noise. Under the Sensor Fault scenario, R07 goes offline at 11:00 and its conservative safety margin widens automatically.',
    },
    {
      num: '04',
      title: '108-Candidate Multiobjective Control Search',
      summary:
        'Exhaustive evaluation of 108 discrete HVAC + compute placement combinations across immediate and +15-minute lookahead horizons.',
      equations: `Lattice = 3 Supply {20,22,24°C} × 3 Fan {0.58,0.80,1.00} × 2 Mode {dry,wet}
          × 2 Batch {0,1} × 3 Placement {original, spread, targeted} = 108 actions
Score   = P_cool + P_IT + P_mig + w_water · WaterRate + 100 · WaterExcess
          + 2000 · max(0, max_i(T_upper_i) - T_limit) + P_deadline + P_switch`,
      notes:
        'Water weight w_water adapts to operator priority (0.14 balanced, 1.25 water-saving, 0.02 energy-saving). Targeted placement evacuates movable load from hot/restricted racks to cool high-conductance receivers while engaging localized 1.38× damper boosts.',
    },
    {
      num: '05',
      title: 'Workload Conservation, Pinning & EDF Batch Scheduling',
      summary:
        'Strict conservation of mandatory compute demand with 45% pinned state and Earliest-Deadline-First flexible batch execution.',
      equations: `L_pinned_i  = 0.45 · L_raw_i
L_movable   = 0.55 · Σ L_raw_i + L_batch_EDF
E_migration = 0.018 · (0.5 · Σ |L_allocated_i - L_raw_i|)          kWh`,
      notes:
        '45% of mandatory rack workload is pinned locally to model stateful services, while 55% can shift toward cooler high-conductance racks with a 0.018 kWh per rack-equivalent migration energy cost. Three flexible batch jobs (J1, J2, J3) totaling 360 rack-minutes of work are dispatched by earliest deadline and deferred away from thermal peaks.',
    },
    {
      num: '06',
      title: 'Cubic Fan Law, Variable COP & Evaporative Water Accounting',
      summary:
        'Per-rack cubic fan affinity power and ambient-coupled chiller COP paired with net room sensible evaporative makeup water.',
      equations: `COP_dry     = clip(4.4 - 0.065·(T_amb - 25) + 0.10·(S - 20), 1.4, 6.0)
COP_wet     = COP_dry + 1.15
P_fan       = 0.30 + Σ [0.35 · (F · damper_i)³]                    kW
Q_sensible  = max(0, P_IT - Q_hydronic_extracted)                  kW_th
Water_wet   = (Q_sensible + P_fan + P_chiller) · 0.72              L / h (Dry = 0)`,
      notes:
        'Hydronic heat extracted directly from hot racks reduces room sensible cooling load before CRAH chiller rejection. Dry mode consumes zero site water at lower chiller COP.',
    },
    {
      num: '07',
      title: 'Dual-Pathway Thermal Recovery (Conceptual HX + Experimental TEG)',
      summary:
        'Central Path A hydronic heat recovery (88% HX effectiveness above 38°C) alongside Path B auxiliary Carnot-bounded thermoelectric generation.',
      equations: `Path A (Hydronic HX): Q_useful = 0.88 · Q_hx_in     when T_manifold ≥ 38.0°C (kWh_th)
Path B (Aux TEG):     Q_slip   = min(0.06 · Q_avail, max(0.0176 · P_IT, 0.06 · Q_gated))
                      η_Carnot = max(0, 1 - (T_cold + 273.15) / (T_hot + 273.15))
                      P_TEG    = max(0, Q_slip · η_Carnot · 0.12 · 0.85 - 0.0007) kW_e`,
      notes:
        'Path A models thermal energy (kWh_th) for potential external district/building pre-heating—not an already implemented physical building hookup—and is never subtracted from electrical kWh. Path B Seebeck TEG is strictly an auxiliary experimental stage (never a power supply for THERMOS) yielding 0 Wh during hot weather when high ambient cold-sink temperature eliminates usable ΔT.',
    },
  ];

  const disclaimers = [
    {
      title: 'Digital Twin Prototype',
      body: 'All telemetry is generated by a deterministic physics simulation, not live commercial data centre hardware.',
    },
    {
      title: 'Synthetic Model Training',
      body: 'The 24-tree Random Forest was trained and calibrated on synthetic trajectories sampled from the simulator.',
    },
    {
      title: 'Demonstration Thresholds',
      body: 'The 30.0°C rack inlet threshold and water budgets are configurable stress-testing bounds rather than ASHRAE certifications.',
    },
    {
      title: 'Carnot Harvesting Realism',
      body: 'Low-delta-T Seebeck thermoelectric output is bounded by Second-Law Carnot efficiency to auxiliary sensor-scale wattage.',
    },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 pb-3 border-b border-[#DCDED8]">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-[#18181B] tracking-tight">
            Model Formulation & Physical Governing Equations
          </h2>
          <p className="text-xs text-[#52565E] mt-1 max-w-2xl leading-relaxed">
            Mathematical specification of the First-Law rack thermal model, 24-tree Random Forest hybrid lookahead, virtual sensor interpolation, and dual-pathway heat recovery.
          </p>
        </div>

        <span className="text-xs font-mono text-[#646872] shrink-0">
          THERMOS Specification v{E.VERSION}
        </span>
      </div>

      {/* Scientific Disclaimers */}
      <section className="p-3.5 sm:p-5 rounded-lg bg-white border border-[#DCDED8] space-y-3">
        <h3 className="font-semibold text-sm text-[#18181B]">
          Scientific Scope & Modeling Boundaries
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-[#52565E] leading-relaxed">
          {disclaimers.map((d) => (
            <div key={d.title} className="space-y-0.5">
              <span className="font-semibold text-[#18181B] block">{d.title}</span>
              <p>{d.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Governing Equations Accordion */}
      <section className="rounded-lg bg-white border border-[#DCDED8] divide-y divide-[#ECEEE9] overflow-hidden">
        {sections.map((sec, idx) => {
          const isExpanded = expandedSection === idx;
          return (
            <div key={sec.num}>
              <button
                type="button"
                onClick={() => setExpandedSection(isExpanded ? null : idx)}
                className="w-full p-3.5 sm:p-4 flex items-start sm:items-center justify-between gap-3 text-left hover:bg-[#F9FAF7] transition-colors cursor-pointer"
              >
                <div className="flex items-baseline gap-3 min-w-0">
                  <span className="font-mono text-xs text-[#646872] shrink-0">{sec.num}.</span>
                  <div className="min-w-0">
                    <h4 className="font-semibold text-sm text-[#18181B]">{sec.title}</h4>
                    <p className="text-xs text-[#646872] mt-0.5 leading-relaxed">{sec.summary}</p>
                  </div>
                </div>
                <span className="text-[#646872] shrink-0 mt-0.5 sm:mt-0">
                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </span>
              </button>

              {isExpanded && (
                <div className="px-3.5 pb-4 sm:px-5 sm:pb-5 pt-1 bg-[#FAFAF7] space-y-3">
                  <div>
                    <span className="text-[11px] font-medium text-[#52565E] block mb-1.5">
                      Governing Formulation
                    </span>
                    <pre className="p-3 rounded-md bg-white border border-[#E2E4DE] font-mono text-[11px] sm:text-xs text-[#18181B] overflow-x-auto leading-relaxed">
                      {sec.equations}
                    </pre>
                  </div>

                  <div>
                    <span className="text-[11px] font-medium text-[#52565E] block mb-1">
                      Physical Parameters & Boundary Conditions
                    </span>
                    <p className="text-xs text-[#52565E] leading-relaxed">{sec.notes}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
};
