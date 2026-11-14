import type {
  GlobalFacilityState,
  StepRecord,
  FacilityIncident,
  CoordinatedResponsePlan,
  VerifiedInterventionOutcome,
} from './types';
import * as E from './engine';

export type ExplainableTarget =
  | { type: 'none' }
  | { type: 'rack'; rackId: number }
  | { type: 'incident'; incidentId: string }
  | { type: 'core' }
  | { type: 'pathway'; kind: 'compute' | 'heat' | 'recovery' | 'cooling' };

export interface ConnectedExplorationLink {
  label: string;
  role?: string;
  target: ExplainableTarget;
}

export interface HighlightedPathways {
  compute?: boolean;
  heat?: boolean;
  cooling?: boolean;
  recovery?: boolean;
}

export interface ContextualExplanation {
  title: string;
  statusTag: string;
  /** Level 1 — What is happening? (Always visible) */
  level1: string;
  /** Level 2 — Why is it happening? (Expandable: measurements, physical causes, connected incidents) */
  level2: {
    summary: string;
    measurements: Array<{ label: string; value: string }>;
    causes: string[];
  };
  /** Level 3 — How does THERMOS respond? (Expandable: decision, proposed/applied actions, verification) */
  level3: {
    summary: string;
    planStatus: 'NONE' | 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'IN_PROGRESS' | 'VERIFYING' | 'VERIFIED' | 'PAUSED';
    steps: string[];
    verifiedOutcome?: VerifiedInterventionOutcome | null;
  };
  /** Causally connected rack IDs to highlight in 3D */
  connectedRackIds: number[];
  /** Physical pathways to illuminate in 3D */
  highlightedPathways: HighlightedPathways;
  /** Clickable links to causally connected objects */
  connectedLinks: ConnectedExplorationLink[];
}

function fmtRack(id: number): string {
  return `R${String(id + 1).padStart(2, '0')}`;
}

function derivePlanStatus(
  facility: GlobalFacilityState,
  relevantIncidents: FacilityIncident[]
): ContextualExplanation['level3']['planStatus'] {
  if (!facility.thermos.enabled) return 'PAUSED';
  const plan = facility.pendingPlan;
  if (plan) {
    if (plan.status === 'PROPOSED') return 'PROPOSED';
    if (plan.status === 'APPROVED' || plan.status === 'AUTO_AUTHORISED') return 'APPROVED';
    if (plan.status === 'IN_PROGRESS') return 'IN_PROGRESS';
    if (plan.status === 'VERIFYING') return 'VERIFYING';
  }
  if (relevantIncidents.some((i) => i.status === 'REJECTED')) {
    return 'REJECTED';
  }
  if (facility.lastVerifiedOutcome) {
    return 'VERIFIED';
  }
  return 'NONE';
}

function buildThermosResponseLevel3(
  facility: GlobalFacilityState,
  _currentRecord: StepRecord | null,
  relevantIncidents: FacilityIncident[],
  rackId?: number
): ContextualExplanation['level3'] {
  const thermosOn = facility.thermos.enabled;
  const planStatus = derivePlanStatus(facility, relevantIncidents);
  const plan: CoordinatedResponsePlan | null = thermosOn ? facility.pendingPlan : null;
  const outcome = thermosOn && !plan ? facility.lastVerifiedOutcome : null;

  if (!thermosOn) {
    return {
      summary: 'THERMOS is paused. Fixed cooling rules are active with no smart shifts.',
      planStatus: 'PAUSED',
      steps: [
        'Turn on THERMOS to move jobs off hot racks and save water.',
      ],
    };
  }

  const steps: string[] = [];

  if (plan && plan.status === 'PROPOSED') {
    if (plan.transfers.length > 0) {
      const trText = plan.transfers
        .slice(0, 3)
        .map((t) => `${fmtRack(t.fromRack)} → ${fmtRack(t.toRack)} (${t.shareOfSourcePct.toFixed(0)}%)`)
        .join(', ');
      steps.push(`Move jobs: ${trText}`);
    }
    if (plan.coolingAdjustment.fanSpeedDeltaPct !== 0) {
      steps.push(
        `Fan speed ${plan.coolingAdjustment.fanSpeedDeltaPct > 0 ? '+' : ''}${plan.coolingAdjustment.fanSpeedDeltaPct}%`
      );
    }
    steps.push(
      `Peak temp drops ${plan.predictedOutcomes.baselineProjectedPeakC.toFixed(1)}° → ${plan.predictedOutcomes.projectedPeakC.toFixed(1)}°C`
    );
    return {
      summary: 'Plan ready — waiting for your approval to run.',
      planStatus: 'PROPOSED',
      steps,
    };
  }

  if (planStatus === 'REJECTED') {
    steps.push('Keeping current layout and watching temperatures.');
    return {
      summary: 'Plan rejected — no changes applied.',
      planStatus: 'REJECTED',
      steps,
    };
  }

  if (plan && (plan.status === 'APPROVED' || plan.status === 'AUTO_AUTHORISED' || plan.status === 'IN_PROGRESS' || plan.status === 'VERIFYING')) {
    if (rackId !== undefined) {
      const assignment = plan.rackAssignments.find((a) => a.rackId === rackId);
      if (assignment) {
        steps.push(`${assignment.rackLabel}: ${assignment.actionSummary}`);
      }
    }
    if (facility.thermos.activeTransfers.length > 0) {
      const trText = facility.thermos.activeTransfers
        .slice(0, 3)
        .map((t) => `${fmtRack(t.fromRack)} → ${fmtRack(t.toRack)} (${t.shareOfSourcePct.toFixed(0)}%)`)
        .join(', ');
      steps.push(`Moving jobs: ${trText}`);
    }
    if (plan.status === 'VERIFYING') {
      steps.push(
        `Checking stability (${plan.verificationStepsTotal - plan.verificationStepsRemaining}/${plan.verificationStepsTotal})`
      );
    }
    return {
      summary:
        plan.status === 'VERIFYING'
          ? 'Changes applied — checking that racks stay cool.'
          : 'Applying smart job shifts and cooling adjustments now.',
      planStatus,
      steps: steps.length > 0 ? steps : ['Balancing heat and workload across all 12 racks.'],
    };
  }

  if (outcome) {
    steps.push(
      `Peak cooled: ${outcome.peakBeforeC.toFixed(1)}° → ${outcome.peakAfterC.toFixed(1)}°C`
    );
    if (rackId !== undefined) {
      const delta = outcome.perRackDeltas.find((d) => d.rackId === rackId);
      if (delta) {
        steps.push(
          `${delta.label}: ${delta.tempBeforeC.toFixed(1)}° → ${delta.tempAfterC.toFixed(1)}°C`
        );
      }
    }
    return {
      summary: `Done — peak heat dropped to ${outcome.peakAfterC.toFixed(1)}°C.`,
      planStatus: 'VERIFIED',
      steps,
      verifiedOutcome: outcome,
    };
  }

  const liveActions = facility.selfAwareness?.activeActions ?? [];
  const liveSteps = liveActions.map((a) => a.summary);

  return {
    summary: facility.selfAwareness?.currentIntent || 'Watching all 12 racks 15 minutes ahead.',
    planStatus: 'NONE',
    steps: liveSteps.length > 0 ? liveSteps : ['Watching all 12 racks and cooling balance.'],
  };
}

export function buildContextualExplanation(
  target: ExplainableTarget,
  facility: GlobalFacilityState,
  currentRecord: StepRecord | null,
  revealTruth: boolean
): ContextualExplanation | null {
  if (target.type === 'none') return null;

  const thermosOn = facility.thermos.enabled;

  if (target.type === 'rack') {
    const rack = facility.racks[target.rackId];
    if (!rack) return null;

    const rackIncidents = facility.activeIncidents.filter(
      (inc) => inc.affectedRacks.length <= 6 && inc.affectedRacks.includes(rack.id)
    );
    const transfers = thermosOn
      ? facility.thermos.activeTransfers.filter(
          (tr) => tr.fromRack === rack.id || tr.toRack === rack.id
        )
      : [];
    const pendingTransfers =
      thermosOn && facility.pendingPlan
        ? facility.pendingPlan.transfers.filter(
            (tr) => tr.fromRack === rack.id || tr.toRack === rack.id
          )
        : [];
    const allTransfers = transfers.length > 0 ? transfers : pendingTransfers;

    const connectedSet = new Set<number>();
    const connectedLinks: ConnectedExplorationLink[] = [];

    for (const inc of rackIncidents) {
      for (const r of inc.affectedRacks) {
        if (r !== rack.id) connectedSet.add(r);
      }
      connectedLinks.push({
        label: inc.title,
        role: inc.severity,
        target: { type: 'incident', incidentId: inc.id },
      });
    }

    for (const tr of allTransfers) {
      const partner = tr.fromRack === rack.id ? tr.toRack : tr.fromRack;
      connectedSet.add(partner);
      connectedLinks.push({
        label: `${fmtRack(partner)} (${tr.shareOfSourcePct.toFixed(0)}%)`,
        role: transfers.length > 0 ? 'Active' : 'Planned',
        target: { type: 'rack', rackId: partner },
      });
    }

    if (!rack.sensorAvailable && thermosOn) {
      for (const nb of E.adjacent(rack.id)) {
        connectedSet.add(nb);
      }
    }

    connectedLinks.push({
      label: 'THERMOS Core',
      role: thermosOn ? facility.thermos.visualState : 'PAUSED',
      target: { type: 'core' },
    });

    const isBlindOffline = !rack.sensorAvailable && !thermosOn && !revealTruth;
    const displayTemp =
      rack.sensorAvailable || revealTruth ? rack.simulatedInletC : rack.estimatedInletC;
    const utilPct = Math.round(rack.workloadUtil * 100);
    const deltaPct = thermosOn ? Math.round(rack.workloadDeltaPct) : 0;

    // Level 1: Short, simple "What's happening"
    const l1Parts: string[] = [];
    if (isBlindOffline) {
      l1Parts.push(`${rack.label} sensor is offline and THERMOS is paused (unmonitored).`);
    } else if (!rack.sensorAvailable && thermosOn) {
      l1Parts.push(
        `${rack.label} sensor is offline (not repaired) — virtual estimate ~${displayTemp.toFixed(1)}°C (±${rack.uncertaintyMarginC.toFixed(2)}°C) from model + neighbor racks.`
      );
    } else {
      const mood =
        rack.thermalRiskState === 'CRITICAL'
          ? 'running hot'
          : rack.thermalRiskState === 'WARMING'
          ? 'warming up'
          : 'cool & healthy';
      l1Parts.push(`${rack.label} is ${mood} at ${displayTemp.toFixed(1)}°C (${utilPct}% busy).`);
    }

    if (rack.airflowRestriction >= 0.12) {
      l1Parts.push(`Airflow is ${Math.round(rack.airflowRestriction * 100)}% blocked.`);
    } else if (deltaPct >= 2) {
      l1Parts.push(`Taking +${deltaPct}% extra work from warmer racks.`);
    } else if (deltaPct <= -2) {
      l1Parts.push(`Moving ${Math.abs(deltaPct)}% work to cooler racks.`);
    }

    // Level 2: Why
    const measurements: Array<{ label: string; value: string }> = [
      {
        label: rack.sensorAvailable ? 'Inlet Temp' : thermosOn ? 'Estimated Temp' : 'Inlet Sensor',
        value: isBlindOffline ? 'OFFLINE' : `${displayTemp.toFixed(1)}°C`,
      },
      { label: 'Exhaust Temp', value: `${rack.exhaustTempC.toFixed(1)}°C` },
      { label: 'Server Load', value: `${utilPct}% (${rack.workloadPowerKW.toFixed(1)} kW)` },
      { label: 'Airflow', value: `${Math.round(rack.localAirflowPct)}%` },
    ];

    const causes: string[] = [];
    if (rack.airflowRestriction >= 0.12) {
      causes.push(
        `Front vents are ${Math.round(rack.airflowRestriction * 100)}% blocked, trapping heat inside.`
      );
    }
    if (!rack.sensorAvailable) {
      causes.push(
        thermosOn
          ? `Hardware probe offline (not physically repaired) — estimating from physics model and neighbors (${E.adjacent(rack.id).map(fmtRack).join(', ')}) with ±${rack.uncertaintyMarginC.toFixed(2)}°C margin.`
          : 'Hardware probe offline — turn on THERMOS to estimate temp from model + neighbors.'
      );
    }
    if (deltaPct >= 2) {
      causes.push(`${rack.label} has cool room to spare, so it took extra jobs.`);
    } else if (deltaPct <= -2) {
      causes.push(`Moved flexible jobs off ${rack.label} so it can cool down.`);
    }
    if (causes.length === 0) {
      causes.push('Cooling air matches server heat, keeping temps steady.');
    }

    const highlightedPathways: HighlightedPathways = {
      compute: allTransfers.length > 0 || Math.abs(deltaPct) >= 2,
      cooling: rack.airflowRestriction >= 0.12 || rack.thermalRiskState !== 'HEALTHY',
      recovery: thermosOn && facility.heatRecovery.isExporting && facility.heatRecovery.activeRackIds.includes(rack.id),
    };

    return {
      title: rack.label,
      statusTag: rack.thermalRiskState,
      level1: l1Parts.join(' '),
      level2: {
        summary: causes[0],
        measurements,
        causes,
      },
      level3: buildThermosResponseLevel3(facility, currentRecord, rackIncidents, rack.id),
      connectedRackIds: Array.from(connectedSet),
      highlightedPathways,
      connectedLinks,
    };
  }

  if (target.type === 'incident') {
    const inc = facility.activeIncidents.find((i) => i.id === target.incidentId);
    if (!inc) return null;

    const connectedLinks: ConnectedExplorationLink[] = inc.affectedRacks.slice(0, 6).map((r) => ({
      label: fmtRack(r),
      role: 'Affected',
      target: { type: 'rack', rackId: r },
    }));
    connectedLinks.push({
      label: 'THERMOS Core',
      role: thermosOn ? facility.thermos.visualState : 'PAUSED',
      target: { type: 'core' },
    });

    const plainMap: Record<string, { what: string; why: string }> = {
      RACK_OVERHEATING: {
        what: 'One or more racks passed the safe 30°C limit.',
        why: 'High server work and hot outside air outpaced cooling.',
      },
      PREDICTED_THERMAL_VIOLATION: {
        what: 'A rack is heading above 30°C in the next 15 minutes.',
        why: 'THERMOS spotted heat building up early.',
      },
      RESTRICTED_AIRFLOW: {
        what: 'Cooling air is partly blocked at the rack front.',
        why: 'Blocked intake cuts airflow, so heat stays trapped.',
      },
      SENSOR_FAILURE: {
        what: 'A rack temperature sensor is offline (not physically repaired).',
        why: thermosOn
          ? 'THERMOS estimates missing telemetry from the thermal model + neighbor sensors with widened uncertainty.'
          : 'Unmonitored until THERMOS virtual sensing is enabled.',
      },
      HIGH_COMPUTING_DEMAND: {
        what: 'A burst of computing jobs hit multiple racks at once.',
        why: 'More server work turns straight into extra heat.',
      },
      WATER_BUDGET_PRESSURE: {
        what: 'Cooling water allowance is running low.',
        why: 'Holding back water mist to avoid breaching the facility water cap.',
      },
      HEAT_RECOVERY_OPPORTUNITY: {
        what: 'Central hydronic recovery threshold (≥38°C) reached.',
        why: 'Rear hydronic coils extract heat (88% HX concept, kWh_th) to model potential external pre-heat reuse.',
      },
    };
    const plain = plainMap[inc.type] ?? {
      what: inc.observedEvidence,
      why: inc.forecastEvidence,
    };

    return {
      title: inc.title,
      statusTag: `${inc.severity} · ${thermosOn ? inc.status : 'UNMITIGATED'}`,
      level1: plain.what,
      level2: {
        summary: plain.why,
        measurements: [
          { label: 'Started', value: `${inc.detectionMinute}m in` },
          { label: 'Where', value: inc.affectedRacks.length > 6 ? 'Whole Hall' : inc.affectedRacks.map(fmtRack).join(', ') },
        ],
        causes: [plain.why],
      },
      level3: buildThermosResponseLevel3(facility, currentRecord, [inc]),
      connectedRackIds: inc.affectedRacks,
      highlightedPathways: {
        cooling: inc.type === 'RESTRICTED_AIRFLOW' || inc.type === 'WATER_BUDGET_PRESSURE',
        compute: inc.type === 'RACK_OVERHEATING' || inc.type === 'HIGH_COMPUTING_DEMAND',
      },
      connectedLinks,
    };
  }

  if (target.type === 'core') {
    const plan = thermosOn ? facility.pendingPlan : null;
    const outcome = thermosOn && !plan ? facility.lastVerifiedOutcome : null;
    const connectedSet = new Set<number>();
    const connectedLinks: ConnectedExplorationLink[] = [];

    if (plan) {
      plan.targetRacks.forEach((r) => connectedSet.add(r));
      plan.sourceRacks.slice(0, 3).forEach((r) =>
        connectedLinks.push({ label: `${fmtRack(r)} (Hot)`, role: 'Source', target: { type: 'rack', rackId: r } })
      );
      plan.receiverRacks.slice(0, 3).forEach((r) =>
        connectedLinks.push({ label: `${fmtRack(r)} (Cool)`, role: 'Receiver', target: { type: 'rack', rackId: r } })
      );
    } else if (outcome) {
      outcome.targetedRacks.forEach((r) => connectedSet.add(r));
      outcome.perRackDeltas.slice(0, 4).forEach((d) =>
        connectedLinks.push({
          label: `${d.label} (${d.tempBeforeC.toFixed(1)}°→${d.tempAfterC.toFixed(1)}°)`,
          role: d.stabilized ? 'Cooled' : 'Watching',
          target: { type: 'rack', rackId: d.rackId },
        })
      );
    } else {
      facility.thermos.inspectedRacks.forEach((r) => connectedSet.add(r));
    }

    const peakInletC = Math.max(...facility.racks.map((r) => r.simulatedInletC));
    const totalItKW = facility.racks.reduce((s, r) => s + r.workloadPowerKW, 0);
    const alertCount = facility.activeIncidents.filter((i) => i.severity !== 'ADVISORY').length;

    const whatSummary = !thermosOn
      ? 'THERMOS is paused. All 12 racks run on basic fixed cooling.'
      : alertCount > 0
      ? `Handling ${alertCount} active alert${alertCount > 1 ? 's' : ''} across the hall (peak ${peakInletC.toFixed(1)}°C).`
      : `All 12 racks are steady and cool (peak ${peakInletC.toFixed(1)}°C).`;

    return {
      title: 'THERMOS Core',
      statusTag: thermosOn ? facility.thermos.visualState : 'PAUSED',
      level1: whatSummary,
      level2: {
        summary: `Outside air is ${facility.outsideTempC.toFixed(1)}°C with ${facility.waterRemainingL.toFixed(0)}L cooling water left.`,
        measurements: [
          { label: 'Warmest Rack', value: `${peakInletC.toFixed(1)}°C` },
          { label: 'Server Power', value: `${totalItKW.toFixed(1)} kW` },
          { label: 'Cooling Power', value: `${facility.coolingPowerKW.toFixed(1)} kW` },
          { label: 'Heat Recovery', value: `${facility.heatRecovery.thermalEnergyCapturedKW.toFixed(1)} kW_th` },
        ],
        causes: [
          `Cooling mode: ${facility.activeCoolingMode === 'wet' ? 'Water-Mist' : 'Dry Air'} at ${Math.round(facility.coolingFanPct)}% fan.`,
          facility.waterRemainingL <= 25
            ? 'Low water budget limits evaporative misting.'
            : `${facility.waterRemainingL.toFixed(0)}L water reserve available.`,
        ],
      },
      level3: buildThermosResponseLevel3(facility, currentRecord, facility.activeIncidents),
      connectedRackIds: Array.from(connectedSet),
      highlightedPathways: {
        compute: Boolean(plan?.transfers.length || facility.thermos.activeTransfers.length),
        recovery: facility.heatRecovery.isExporting,
      },
      connectedLinks,
    };
  }

  // Pathway / Equipment targets
  const kind = target.kind;
  if (kind === 'compute') {
    const activeTr = thermosOn ? facility.thermos.activeTransfers : [];
    const propTr = thermosOn && activeTr.length === 0 ? facility.pendingPlan?.transfers ?? [] : [];
    const transfers = activeTr.length > 0 ? activeTr : propTr;
    const connectedSet = new Set<number>();
    const connectedLinks: ConnectedExplorationLink[] = [];

    transfers.forEach((tr) => {
      connectedSet.add(tr.fromRack);
      connectedSet.add(tr.toRack);
      connectedLinks.push({
        label: `${fmtRack(tr.fromRack)} → ${fmtRack(tr.toRack)} (${tr.shareOfSourcePct.toFixed(0)}%)`,
        role: activeTr.length > 0 ? 'Active' : 'Planned',
        target: { type: 'rack', rackId: tr.fromRack },
      });
    });

    const totalItKW = facility.racks.reduce((s, r) => s + r.workloadPowerKW, 0);

    return {
      title: 'Job Routing',
      statusTag: !thermosOn ? 'FIXED' : activeTr.length > 0 ? 'MOVING' : propTr.length > 0 ? 'PLANNED' : 'BALANCED',
      level1: !thermosOn
        ? 'THERMOS is paused — jobs stay wherever they land, even on hot racks.'
        : activeTr.length > 0
        ? `Moving ${activeTr.length} batch job stream${activeTr.length > 1 ? 's' : ''} from hot racks to cool racks.`
        : propTr.length > 0
        ? `${propTr.length} job move${propTr.length > 1 ? 's' : ''} ready to cool warming racks.`
        : 'Server work is balanced safely across all 12 racks.',
      level2: {
        summary: `Servers use ${totalItKW.toFixed(1)} kW total across 12 racks.`,
        measurements: [
          { label: 'Server Power', value: `${totalItKW.toFixed(1)} kW` },
          { label: 'Active Moves', value: `${activeTr.length}` },
        ],
        causes: [
          transfers.length > 0
            ? 'Flexible batch jobs move away from warm racks while critical jobs stay put.'
            : 'No rack is hot enough to need job shifting right now.',
        ],
      },
      level3: buildThermosResponseLevel3(facility, currentRecord, facility.activeIncidents),
      connectedRackIds: Array.from(connectedSet),
      highlightedPathways: { compute: true },
      connectedLinks,
    };
  }

  if (kind === 'cooling') {
    const restricted = facility.racks.filter((r) => r.airflowRestriction >= 0.12);
    const warm = facility.racks.filter((r) => r.thermalRiskState !== 'HEALTHY');
    const connectedSet = new Set<number>([...restricted.map((r) => r.id), ...warm.map((r) => r.id)]);
    const connectedLinks: ConnectedExplorationLink[] = Array.from(connectedSet)
      .slice(0, 5)
      .map((r) => ({
        label: fmtRack(r),
        role: facility.racks[r].airflowRestriction >= 0.12 ? 'Blocked' : facility.racks[r].thermalRiskState,
        target: { type: 'rack', rackId: r },
      }));

    const modeName = facility.activeCoolingMode === 'wet' ? 'Water-Mist' : 'Dry Air';
    return {
      title: 'Smart Cooling',
      statusTag: `${modeName} · ${Math.round(facility.coolingFanPct)}%`,
      level1: `Coolers blow ${facility.coolingSupplyC.toFixed(1)}°C air in ${modeName} mode (${Math.round(facility.coolingFanPct)}% fan).`,
      level2: {
        summary: `Cooling uses ${facility.coolingPowerKW.toFixed(1)} kW with ${facility.waterRemainingL.toFixed(0)}L water left.`,
        measurements: [
          { label: 'Air Temp', value: `${facility.coolingSupplyC.toFixed(1)}°C` },
          { label: 'Fan Speed', value: `${Math.round(facility.coolingFanPct)}%` },
          { label: 'Water Left', value: `${facility.waterRemainingL.toFixed(0)} / ${facility.waterBudgetL} L` },
        ],
        causes: [
          restricted.length > 0
            ? `Blocked vents on ${restricted.map((r) => r.label).join(', ')} slow down local cooling.`
            : 'Cold air reaches all 12 racks smoothly.',
        ],
      },
      level3: buildThermosResponseLevel3(facility, currentRecord, facility.activeIncidents),
      connectedRackIds: Array.from(connectedSet),
      highlightedPathways: { cooling: true },
      connectedLinks,
    };
  }

  if (kind === 'recovery' || kind === 'heat') {
    const hr = facility.heatRecovery;
    const connectedSet = new Set<number>(hr.activeRackIds);
    const connectedLinks: ConnectedExplorationLink[] = hr.activeRackIds.slice(0, 5).map((r) => ({
      label: `${fmtRack(r)} (+${facility.racks[r]?.recoveryExtractedKW.toFixed(1) ?? '0.0'} kW)`,
      role: 'Warm',
      target: { type: 'rack', rackId: r },
    }));

    return {
      title: kind === 'recovery' ? 'Thermal Recovery' : 'Heat Capture',
      statusTag: hr.isExporting ? 'ACTIVE (88% HX)' : 'STANDBY',
      level1: hr.isExporting
        ? `Hydronic recovery captures ${hr.extractedHeatKW.toFixed(1)} kW_th (${hr.thermalEnergyCapturedKW.toFixed(1)} kW_th conceptual reuse @ 88% HX; ${(hr.tegGenerationKW * 1000).toFixed(0)} W aux TEG).`
        : 'Waiting for manifold temperature ≥38.0°C and modeled heat demand before capturing thermal energy.',
      level2: {
        summary: `Hydronic manifold is ${hr.hotLoopTempC.toFixed(1)}°C vs ${hr.coldSinkTempC.toFixed(1)}°C outdoor sink.`,
        measurements: [
          { label: 'Captured', value: `${hr.extractedHeatKW.toFixed(1)} kW_th` },
          { label: 'Conceptual Reuse', value: `${hr.thermalEnergyCapturedKW.toFixed(1)} kW_th` },
          { label: 'Aux TEG (Exp.)', value: `${(hr.tegGenerationKW * 1000).toFixed(0)} W` },
        ],
        causes: [
          hr.isExporting
            ? `Central hydronic coils extract heat from ${hr.activeRackIds.map(fmtRack).join(', ')}. External pre-heat is conceptual (kWh_th); TEG yields 0 W when outdoor air limits ΔT.`
            : 'Racks are below the 38°C manifold threshold or external heat demand is 0.',
        ],
      },
      level3: buildThermosResponseLevel3(facility, currentRecord, facility.activeIncidents),
      connectedRackIds: Array.from(connectedSet),
      highlightedPathways: { recovery: kind === 'recovery', heat: kind === 'heat' },
      connectedLinks,
    };
  }

  return null;
}
