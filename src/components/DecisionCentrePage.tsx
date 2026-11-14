import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { StepRecord, ThermosConfig } from '../simulation/types';

interface DecisionCentrePageProps {
  currentRecord: StepRecord | null;
  config: ThermosConfig;
}

export const DecisionCentrePage: React.FC<DecisionCentrePageProps> = ({
  currentRecord,
  config,
}) => {
  const [showAlternatives, setShowAlternatives] = useState<boolean>(true);
  const [activeStepTab, setActiveStepTab] = useState<number>(5);

  if (!currentRecord) {
    return (
      <div className="max-w-xl mx-auto my-12 p-6 rounded-lg bg-white border border-[#DCDED8] text-center space-y-2">
        <h3 className="text-base font-semibold text-[#18181B]">Decision Ledger Standby</h3>
        <p className="text-xs text-[#52565E] leading-relaxed">
          Advance the simulation using <b>Play</b>, <b>+5m</b>, or <b>Compute Full 6h Run</b> to inspect the live 9-stage multiobjective optimization ledger and 108-candidate trade-off table.
        </p>
      </div>
    );
  }

  const {
    control,
    style,
    batch,
    coolingKW,
    water,
    power,
    upper,
    reasons,
    alternatives,
    score,
    waterExcess,
    sensors,
    temps,
    estimated,
    outside,
  } = currentRecord;

  const predictedMax = Math.max(...upper);
  const actualMax = Math.max(...temps);
  const maxEstError = Math.max(...temps.map((t, i) => Math.abs(t - estimated[i])));
  const isHighRisk = predictedMax > config.limit;
  const requiresEscalation = isHighRisk || waterExcess > 0.05;
  const stepWaterLitres = (power.water * 5) / 60;

  const steps9 = [
    {
      num: '01',
      title: 'Read Sensors',
      status: `${sensors.length} / 12 live`,
      detail: `Reads ${sensors.length} working rack temperature sensors at minute ${currentRecord.minute}m (outside air ${outside.toFixed(1)}°C).`,
    },
    {
      num: '02',
      title: 'Estimate Missing',
      status: `±${maxEstError.toFixed(2)}°C`,
      detail: `Estimates temperature for any offline rack sensor using physics + nearby racks.`,
    },
    {
      num: '03',
      title: 'Predict +15m',
      status: `15m Hybrid`,
      detail: `24-tree Random Forest (28%) + physics (72%) projects conservative worst-case temperature (${predictedMax.toFixed(1)}°C).`,
    },
    {
      num: '04',
      title: 'Test 108 Plans',
      status: `108 Plans`,
      detail: `Tests 3 supply temps (20/22/24°C) × 3 fan levels (58/80/100%) × 2 cooling modes (dry/wet) × 2 batch rates × 3 job layouts.`,
    },
    {
      num: '05',
      title: 'Score Trade-offs',
      status: `${config.priority}`,
      detail: `Scores every plan on overheating risk, electricity use, cooling water limit, and batch job deadlines.`,
    },
    {
      num: '06',
      title: 'Pick Best Plan',
      status: `Score ${score.toFixed(2)}`,
      detail: `Picked ${control.supply}°C air, ${Math.round(control.fan * 100)}% fans, ${control.mode.toUpperCase()} cooling, and ${style} job placement.`,
    },
    {
      num: '07',
      title: 'Explain Choice',
      status: `${reasons.length} reasons`,
      detail: `Generates plain reasons why this choice beat the other 107 plans.`,
    },
    {
      num: '08',
      title: 'Adjust Plant',
      status: `${coolingKW.toFixed(1)} kW cool`,
      detail: `Applies cooling fan/air settings, local rack airflow boosts, and flexible workload moves.`,
    },
    {
      num: '09',
      title: 'Check Results',
      status: `Peak ${actualMax.toFixed(1)}°C`,
      detail: `Runs 5 × 1-minute physics sub-steps and logs real temperatures, electricity, water, and heat capture.`,
    },
  ];

  const activeStage = steps9[activeStepTab] || steps9[5];

  return (
    <div className="max-w-5xl mx-auto space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 pb-3 border-b border-[#DCDED8]">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-[#18181B] tracking-tight">
            Decision Log &amp; 108-Plan Testing
          </h2>
          <p className="text-xs text-[#52565E] mt-1 max-w-2xl leading-relaxed">
            Shows how THERMOS tests 108 possible cooling and job-routing combinations at minute {currentRecord.minute}m before acting.
          </p>
        </div>

        <div className="text-xs font-mono shrink-0">
          {requiresEscalation ? (
            <span className="text-[#DC2626] font-semibold">
              High Heat / Water Pressure
            </span>
          ) : (
            <span className="text-[#047857] font-medium">
              Safe Limits Maintained
            </span>
          )}
        </div>
      </div>

      {/* Interactive 9-Stage Pipeline */}
      <section className="p-3.5 sm:p-5 rounded-lg bg-white border border-[#DCDED8] space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-sm text-[#18181B]">
            How Every 5-Minute Decision Works (9 Steps)
          </h3>
          <span className="text-[11px] font-mono text-[#646872]">
            Click any step to inspect
          </span>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-9 gap-1.5">
          {steps9.map((s, idx) => {
            const isSelected = activeStepTab === idx;
            return (
              <button
                key={s.num}
                type="button"
                onClick={() => setActiveStepTab(idx)}
                className={`p-2 rounded-md border text-left flex flex-col justify-between transition-colors cursor-pointer min-h-18 ${
                  isSelected
                    ? 'bg-[#18181B] border-[#18181B] text-white'
                    : 'bg-[#F9FAF7] border-[#E2E4DE] text-[#18181B] hover:bg-[#F1F2EE]'
                }`}
              >
                <div>
                  <span
                    className={`text-[10px] font-mono block ${
                      isSelected ? 'text-[#9CA3AF]' : 'text-[#646872]'
                    }`}
                  >
                    {s.num}
                  </span>
                  <span className="font-semibold text-[11px] leading-tight block mt-0.5 line-clamp-2">
                    {s.title}
                  </span>
                </div>
                <span
                  className={`mt-1.5 text-[10px] font-mono tabular-nums truncate block ${
                    isSelected ? 'text-[#60A5FA]' : 'text-[#0066FF]'
                  }`}
                >
                  {s.status}
                </span>
              </button>
            );
          })}
        </div>

        {/* Active Stage Live Inspection Readout */}
        <div className="pt-2.5 border-t border-[#ECEEE9] flex flex-col sm:flex-row sm:items-baseline justify-between gap-1 text-xs">
          <div className="text-[#18181B]">
            <span className="font-mono text-[#646872] mr-2">Stage {activeStage.num}:</span>
            <span className="font-semibold mr-2">{activeStage.title}</span>
            <span className="text-[#52565E]">{activeStage.detail}</span>
          </div>
          <span className="font-mono text-[11px] text-[#0066FF] shrink-0">{activeStage.status}</span>
        </div>
      </section>

      {/* Selected Optimal Action Readout */}
      <section className="p-3.5 sm:p-5 rounded-lg bg-white border border-[#DCDED8] space-y-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2.5 border-b border-[#ECEEE9]">
          <div>
            <h3 className="font-semibold text-sm text-[#18181B]">
              Selected Action Setpoint (Argmin of 108 Candidates)
            </h3>
            <p className="text-xs text-[#646872] mt-0.5">
              Multiobjective penalty score: <span className="font-mono font-semibold text-[#18181B]">{score.toFixed(2)}</span> · Optimization priority: <span className="font-mono text-[#18181B]">{config.priority}</span>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div className="space-y-0.5">
            <span className="text-[11px] text-[#646872] block">Supply Air Setpoint</span>
            <span className="text-lg font-semibold font-mono tabular-nums text-[#18181B] block">
              {control.supply}°C
            </span>
            <span className="text-[10px] font-mono text-[#8A8F99] block">Options: 20 / 22 / 24°C</span>
          </div>

          <div className="space-y-0.5">
            <span className="text-[11px] text-[#646872] block">Cooling Fan Speed</span>
            <span className="text-lg font-semibold font-mono tabular-nums text-[#18181B] block">
              {Math.round(control.fan * 100)}%
            </span>
            <span className="text-[10px] font-mono text-[#8A8F99] block">Options: 58% / 80% / 100%</span>
          </div>

          <div className="space-y-0.5">
            <span className="text-[11px] text-[#646872] block">Heat Rejection Mode</span>
            <span className="text-lg font-semibold font-mono tabular-nums text-[#0066FF] block">
              {control.mode.toUpperCase()}
            </span>
            <span className="text-[10px] font-mono text-[#8A8F99] block">Dry vs Wet (+1.15 COP)</span>
          </div>

          <div className="space-y-0.5">
            <span className="text-[11px] text-[#646872] block">Compute Placement</span>
            <span className="text-lg font-semibold font-mono tabular-nums text-[#18181B] capitalize block">
              {style}
            </span>
            <span className="text-[10px] font-mono text-[#8A8F99] block">Original / Spread / Targeted</span>
          </div>

          <div className="space-y-0.5 pt-2 border-t border-[#ECEEE9]">
            <span className="text-[11px] text-[#646872] block">EDF Batch Dispatch</span>
            <span className="text-lg font-semibold font-mono tabular-nums text-[#18181B] block">
              +{batch.toFixed(2)}
            </span>
            <span className="text-[10px] font-mono text-[#8A8F99] block">Rack-equivalents</span>
          </div>

          <div className="space-y-0.5 pt-2 border-t border-[#ECEEE9]">
            <span className="text-[11px] text-[#646872] block">Total Cooling Power</span>
            <span className="text-lg font-semibold font-mono tabular-nums text-[#18181B] block">
              {coolingKW.toFixed(2)} kW
            </span>
            <span className="text-[10px] font-mono text-[#8A8F99] block">Fans + Chiller compressor</span>
          </div>

          <div className="space-y-0.5 pt-2 border-t border-[#ECEEE9]">
            <span className="text-[11px] text-[#646872] block">Step Water Makeup</span>
            <span className="text-lg font-semibold font-mono tabular-nums text-[#18181B] block">
              {control.mode === 'wet' ? `${stepWaterLitres.toFixed(2)} L` : '0.00 L'}
            </span>
            <span className="text-[10px] font-mono text-[#8A8F99] block">
              Remaining: {Math.max(0, config.water - water).toFixed(1)} L
            </span>
          </div>

          <div className="space-y-0.5 pt-2 border-t border-[#ECEEE9]">
            <span className="text-[11px] text-[#646872] block">Conservative 15m Peak</span>
            <span
              className={`text-lg font-semibold font-mono tabular-nums block ${
                predictedMax > config.limit ? 'text-[#DC2626]' : 'text-[#047857]'
              }`}
            >
              {predictedMax.toFixed(1)}°C
            </span>
            <span className="text-[10px] font-mono text-[#8A8F99] block">Safety limit: {config.limit}°C</span>
          </div>
        </div>
      </section>

      {/* Contrastive Explanation */}
      <section className="p-3.5 sm:p-5 rounded-lg bg-white border border-[#DCDED8] space-y-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-semibold text-sm text-[#18181B]">
            Decision Rationale (Minute {currentRecord.minute}m)
          </h3>
          <span className="text-[11px] font-mono text-[#646872]">Synthesized from active cost terms</span>
        </div>

        <ul className="divide-y divide-[#ECEEE9] text-xs text-[#333740]">
          {reasons.map((r, i) => (
            <li key={i} className="py-2 first:pt-1 last:pb-0 leading-relaxed flex items-baseline gap-2.5">
              <span className="font-mono text-[10px] text-[#646872] shrink-0">0{i + 1}.</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Candidate Trade-off Comparison Table */}
      <section className="p-3.5 sm:p-5 rounded-lg bg-white border border-[#DCDED8] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-sm text-[#18181B]">
              Rejected Candidate Trade-offs
            </h3>
            <p className="text-xs text-[#646872]">
              Comparison against runner-up actions evaluated during the same control step.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowAlternatives(!showAlternatives)}
            className="flex items-center gap-1.5 px-3 py-1.5 min-h-8 rounded-md bg-[#F1F2EE] hover:bg-[#E6E8E2] text-xs font-medium text-[#18181B] cursor-pointer transition-colors"
          >
            <span>{showAlternatives ? 'Hide Runner-ups' : 'Show Runner-ups'}</span>
            {showAlternatives ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {showAlternatives && (
          <div className="overflow-x-auto -mx-3.5 px-3.5 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[660px] text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-[#DCDED8] text-[#646872] font-medium">
                  <th className="py-2 pr-3 font-medium">Candidate</th>
                  <th className="py-2 px-2.5 font-medium">Supply</th>
                  <th className="py-2 px-2.5 font-medium">Airflow</th>
                  <th className="py-2 px-2.5 font-medium">Mode</th>
                  <th className="py-2 px-2.5 font-medium">Placement</th>
                  <th className="py-2 px-2.5 font-medium">Batch</th>
                  <th className="py-2 px-2.5 font-medium">15m Peak</th>
                  <th className="py-2 px-2.5 font-medium">Score</th>
                  <th className="py-2 pl-2.5 text-right font-medium">Trade-off Delta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ECEEE9] font-mono tabular-nums">
                <tr className="bg-[#0066FF]/[0.04] font-semibold text-[#18181B]">
                  <td className="py-2.5 pr-3 font-sans text-[#0066FF] font-semibold">
                    Selected Action
                  </td>
                  <td className="py-2.5 px-2.5">{control.supply}°C</td>
                  <td className="py-2.5 px-2.5">{Math.round(control.fan * 100)}%</td>
                  <td className="py-2.5 px-2.5 uppercase text-[#0066FF]">{control.mode}</td>
                  <td className="py-2.5 px-2.5 capitalize">{style}</td>
                  <td className="py-2.5 px-2.5">+{batch.toFixed(2)}</td>
                  <td className="py-2.5 px-2.5">{predictedMax.toFixed(1)}°C</td>
                  <td className="py-2.5 px-2.5 text-[#0066FF]">{score.toFixed(2)}</td>
                  <td className="py-2.5 pl-2.5 text-right font-sans text-[#047857] font-medium">
                    Minimum total penalty
                  </td>
                </tr>

                {alternatives && alternatives.length > 0 ? (
                  alternatives.map((alt, idx) => {
                    const scoreDiff = alt.score - score;
                    const diffReason =
                      alt.mode !== control.mode
                        ? alt.mode === 'wet'
                          ? 'Higher evaporative water penalty'
                          : 'Higher chiller electrical draw'
                        : alt.style !== style
                        ? 'Less effective hotspot relief / migration cost'
                        : alt.batch !== batch
                        ? 'Suboptimal EDF batch deadline pacing'
                        : `Higher combined penalty (+${scoreDiff.toFixed(1)})`;

                    return (
                      <tr key={idx} className="hover:bg-[#F9FAF7] text-[#52565E]">
                        <td className="py-2.5 pr-3 font-sans text-[#18181B]">
                          Alternative #{idx + 1}
                        </td>
                        <td className="py-2.5 px-2.5">{alt.supply}°C</td>
                        <td className="py-2.5 px-2.5">{Math.round(alt.fan * 100)}%</td>
                        <td className="py-2.5 px-2.5 uppercase">{alt.mode}</td>
                        <td className="py-2.5 px-2.5 capitalize">{alt.style}</td>
                        <td className="py-2.5 px-2.5">+{alt.batch.toFixed(2)}</td>
                        <td
                          className={`py-2.5 px-2.5 ${
                            alt.predictedMax > config.limit ? 'text-[#DC2626] font-semibold' : ''
                          }`}
                        >
                          {alt.predictedMax.toFixed(1)}°C
                        </td>
                        <td className="py-2.5 px-2.5">
                          {alt.score.toFixed(2)}{' '}
                          <span className="text-[10px] text-[#9A5B04]">
                            (+{scoreDiff.toFixed(1)})
                          </span>
                        </td>
                        <td className="py-2.5 pl-2.5 text-right font-sans text-[11px] text-[#646872]">
                          {diffReason}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={9} className="py-3 text-center font-sans text-[#646872]">
                      No alternative candidates logged for this step.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Soft-Constraint Escalation Note */}
      <section className="p-4 rounded-lg bg-[#F1F2EE] border border-[#DCDED8] text-xs text-[#52565E] leading-relaxed">
        <span className="font-semibold text-[#18181B] block mb-1">
          Soft-Constraint Penalty Design & Escalation Transparency
        </span>
        THERMOS uses calibrated penalty weights (2000× per °C above safety limit) rather than brittle solver infeasibility cutoffs so control remains continuous under compound stress. Whenever every candidate exceeds thermal or water budgets, THERMOS selects the least-damaging action and logs an explicit operator escalation.
      </section>
    </div>
  );
};
