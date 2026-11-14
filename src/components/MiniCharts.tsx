import React, { useRef } from 'react';
import type { StepRecord } from '../simulation/types';

interface TimeseriesChartProps {
  traces: {
    thermos: StepRecord[];
    reactive: StepRecord[];
    physics?: StepRecord[];
    none?: StepRecord[];
  };
  metric: 'temp' | 'energy' | 'water' | 'violations' | 'batch';
  limit?: number;
  height?: number;
  cursor?: number;
  onScrub?: (step: number) => void;
}

export const MultiControllerChart: React.FC<TimeseriesChartProps> = ({
  traces,
  metric,
  limit = 30,
  height = 230,
  cursor = -1,
  onScrub,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const tThermos = traces.thermos || [];
  const tReactive = traces.reactive || [];
  const tPhysics = traces.physics || [];
  const tNone = traces.none || [];

  const maxSteps = 72;
  const padding = { top: 18, right: 24, bottom: 28, left: 46 };
  const width = 680;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const getMetricValue = (record: StepRecord, m: typeof metric): number => {
    switch (m) {
      case 'temp':
        return Math.max(...record.temps);
      case 'energy':
        return record.energy;
      case 'water':
        return record.water;
      case 'violations':
        return record.totals.over_limit_rack_minutes;
      case 'batch':
        return record.totals.batch_completed_rack_minutes;
    }
  };

  const allValues = [
    ...tThermos.map((r) => getMetricValue(r, metric)),
    ...tReactive.map((r) => getMetricValue(r, metric)),
    ...tPhysics.map((r) => getMetricValue(r, metric)),
    ...tNone.map((r) => getMetricValue(r, metric)),
  ];

  if (metric === 'temp') allValues.push(limit);
  if (allValues.length === 0) allValues.push(0);

  let minY = Math.min(...allValues);
  let maxY = Math.max(...allValues);

  if (metric === 'temp') {
    minY = Math.min(21, minY - 1);
    maxY = Math.max(32, maxY + 1);
  } else {
    minY = 0;
    maxY = maxY <= 0 ? 10 : maxY * 1.1;
  }

  const xScale = (step: number) => padding.left + (step / (maxSteps - 1)) * innerWidth;
  const yScale = (val: number) =>
    padding.top + innerHeight - ((val - minY) / (maxY - minY || 1)) * innerHeight;

  const buildPath = (records: StepRecord[]) => {
    if (records.length === 0) return '';
    return records
      .map(
        (r, i) =>
          `${i === 0 ? 'M' : 'L'} ${xScale(r.step).toFixed(1)} ${yScale(getMetricValue(r, metric)).toFixed(1)}`
      )
      .join(' ');
  };

  const pathThermos = buildPath(tThermos);
  const pathReactive = buildPath(tReactive);
  const pathPhysics = buildPath(tPhysics);
  const pathNone = buildPath(tNone);

  const limitY = limit ? yScale(limit) : null;
  const activeStep =
    cursor >= 0 && cursor < tThermos.length
      ? cursor
      : tThermos.length > 0
      ? tThermos[tThermos.length - 1].step
      : -1;

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onScrub || !svgRef.current || tThermos.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    const normalized = (relX - padding.left) / innerWidth;
    const rawStep = Math.round(normalized * (maxSteps - 1));
    const clampedStep = Math.max(0, Math.min(tThermos.length - 1, rawStep));
    onScrub(clampedStep);
  };

  return (
    <div className="w-full select-none space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px] text-[#52565E]">
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-0.5 bg-[#0066FF] inline-block" />
            <span className="text-[#18181B] font-semibold">THERMOS</span>
          </div>
          {tNone.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-0.5 border-t-2 border-dashed border-[#D97706] inline-block" />
              <span>No-Intervention</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-0.5 bg-[#64748B] inline-block" />
            <span>Reactive</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-0.5 bg-[#059669] inline-block" />
            <span>Engineering Model</span>
          </div>
          {metric === 'temp' && (
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-0.5 border-t border-dashed border-[#DC2626] inline-block" />
              <span className="text-[#DC2626]">Limit ({limit}°C)</span>
            </div>
          )}
        </div>
        <div className="text-[11px] text-[#646872] font-mono">
          {metric === 'temp' && 'Peak Inlet Temp (°C)'}
          {metric === 'energy' && 'Cumulative Grid Energy (kWh)'}
          {metric === 'water' && 'Site Cooling Water (L)'}
          {metric === 'violations' && 'Over-limit Rack-Minutes'}
          {metric === 'batch' && 'Batch Work Completed (min)'}
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        onPointerDown={handleSvgPointerDown}
        className={`w-full h-auto bg-[#FAFAF7] rounded-md border border-[#E5E7E1] ${
          onScrub && tThermos.length > 0 ? 'cursor-crosshair' : ''
        }`}
      >
        {/* Horizontal grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
          const val = minY + (maxY - minY) * (1 - pct);
          const y = padding.top + innerHeight * pct;
          return (
            <g key={i}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="#E4E6E0"
                strokeDasharray="2,2"
              />
              <text
                x={padding.left - 7}
                y={y + 3.5}
                fill="#646872"
                fontSize="10"
                fontFamily="IBM Plex Mono, monospace"
                textAnchor="end"
              >
                {val.toFixed(metric === 'temp' ? 1 : 0)}
              </text>
            </g>
          );
        })}

        {/* X axis time labels */}
        {[0, 18, 36, 54, 71].map((st) => {
          const x = xScale(st);
          const hours = 9 + (st * 5) / 60;
          const hStr = `${Math.floor(hours).toString().padStart(2, '0')}:${Math.floor((hours % 1) * 60)
            .toString()
            .padStart(2, '0')}`;
          return (
            <g key={st}>
              <line
                x1={x}
                y1={padding.top}
                x2={x}
                y2={height - padding.bottom}
                stroke="#EAECE6"
                strokeDasharray="1,3"
              />
              <text
                x={x}
                y={height - padding.bottom + 16}
                fill="#646872"
                fontSize="10"
                fontFamily="IBM Plex Mono, monospace"
                textAnchor="middle"
              >
                {hStr}
              </text>
            </g>
          );
        })}

        {/* Limit threshold line */}
        {metric === 'temp' && limitY !== null && (
          <line
            x1={padding.left}
            y1={limitY}
            x2={width - padding.right}
            y2={limitY}
            stroke="#DC2626"
            strokeWidth="1.25"
            strokeDasharray="4,4"
          />
        )}

        {/* Scrubbing cursor indicator */}
        {cursor >= 0 && cursor < tThermos.length && (
          <line
            x1={xScale(cursor)}
            y1={padding.top}
            x2={xScale(cursor)}
            y2={height - padding.bottom}
            stroke="#18181B"
            strokeWidth="1"
            strokeDasharray="3,2"
            strokeOpacity="0.45"
          />
        )}

        {/* No-Intervention baseline line */}
        {pathNone && (
          <path
            d={pathNone}
            fill="none"
            stroke="#D97706"
            strokeWidth="1.75"
            strokeDasharray="5,3"
            strokeOpacity="0.9"
          />
        )}

        {/* Reactive line */}
        {pathReactive && (
          <path
            d={pathReactive}
            fill="none"
            stroke="#64748B"
            strokeWidth="1.75"
            strokeOpacity="0.85"
          />
        )}

        {/* Engineering model line */}
        {pathPhysics && (
          <path
            d={pathPhysics}
            fill="none"
            stroke="#059669"
            strokeWidth="1.75"
            strokeOpacity="0.85"
          />
        )}

        {/* THERMOS primary line */}
        {pathThermos && (
          <path
            d={pathThermos}
            fill="none"
            stroke="#0066FF"
            strokeWidth="2.4"
          />
        )}

        {/* Active step marker dot */}
        {activeStep >= 0 && tThermos[activeStep] && (
          <circle
            cx={xScale(tThermos[activeStep].step)}
            cy={yScale(getMetricValue(tThermos[activeStep], metric))}
            r="4"
            fill="#0066FF"
            stroke="#FFFFFF"
            strokeWidth="1.5"
          />
        )}
      </svg>
    </div>
  );
};
