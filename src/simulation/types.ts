export type PresetKey = 'compound' | 'normal' | 'heatwave' | 'water' | 'sensor' | 'noheat';

export type ControllerType = 'thermos' | 'reactive' | 'physics' | 'none';
export type SystemMode = 'interactive' | 'demonstration';

export type FacilityViewMode = 'facility' | 'compute' | 'heat' | 'recovery' | 'cooling';

export type ThermosVisualState =
  | 'IDLE'
  | 'SCANNING'
  | 'ANALYSING'
  | 'COORDINATING'
  | 'INTERVENING'
  | 'MONITORING'
  | 'RESOLVED'
  | 'ESCALATION';

export type IncidentType =
  | 'RACK_OVERHEATING'
  | 'RAPID_TEMP_RISE'
  | 'PREDICTED_THERMAL_VIOLATION'
  | 'RESTRICTED_AIRFLOW'
  | 'SENSOR_FAILURE'
  | 'HIGH_COMPUTING_DEMAND'
  | 'COOLING_CAPACITY_PRESSURE'
  | 'WATER_BUDGET_PRESSURE'
  | 'ELECTRICITY_CONSUMPTION_INCREASE'
  | 'WORKLOAD_PLACEMENT_CONFLICT'
  | 'WORKLOAD_DEADLINE_RISK'
  | 'MIGRATION_ENERGY_TRADEOFF'
  | 'HEAT_RECOVERY_OPPORTUNITY'
  | 'INSUFFICIENT_TEMP_DIFFERENCE'
  | 'ACTION_VERIFICATION_DEFICIT';

export type IncidentSeverity = 'CRITICAL' | 'WARNING' | 'ADVISORY';

export type IncidentStatus =
  | 'DETECTED'
  | 'ASSESSED'
  | 'RESPONSE_PROPOSED'
  | 'APPROVED'
  | 'AUTO_AUTHORISED'
  | 'IN_PROGRESS'
  | 'VERIFYING'
  | 'RESOLVED'
  | 'REJECTED';

export interface FacilityIncident {
  id: string;
  type: IncidentType;
  title: string;
  affectedRacks: number[]; // 0-indexed rack numbers (0=R01 .. 11=R12)
  detectionMinute: number;
  detectionStep: number;
  severity: IncidentSeverity;
  observedEvidence: string;
  forecastEvidence: string;
  resourceConstraints: string[];
  uncertaintyDegC: number;
  status: IncidentStatus;
  recommendedAction: string;
  priorityRank: number;
  priorityReason: string;
  linkedIncidentIds: string[];
  appliedActions: string[];
  resolutionCondition: string;
  resolutionMinute?: number;
}

export type TimelineEventCategory =
  | 'HEATING'
  | 'DETECTION'
  | 'MIGRATION'
  | 'COOLING'
  | 'RECOVERY'
  | 'SENSOR'
  | 'VERIFICATION';

export interface FacilityTimelineEvent {
  id: string;
  minute: number;
  step: number;
  timeString: string;
  category: TimelineEventCategory;
  racks: number[];
  summary: string;
  detail: string;
}

export interface WorkloadTransferEdge {
  fromRack: number;
  toRack: number;
  fractionMoved: number; // fraction of single-rack capacity (0..1)
  shareOfSourcePct: number; // % of source rack load moved
}

export interface RackActionAssignment {
  rackId: number;
  rackLabel: string;
  role: 'SOURCE_RELIEF' | 'COOL_RECEIVER' | 'COOLING_BOOST' | 'VIRTUAL_SENSOR';
  actionSummary: string;
  loadBefore: number;
  loadAfter: number;
  predictedBeforeC: number;
  predictedAfterC: number;
}

export interface MultiRackInterventionAction {
  type: 'SHIFT_WORKLOAD' | 'ADJUST_COOLING' | 'BYPASS_SENSOR_RECALIBRATE' | 'ACTIVATE_HEAT_RECOVERY';
  targetRacks: number[];
  parameters: Record<string, any>;
  description: string;
}

export interface VerifiedInterventionOutcome {
  planId: string;
  completedMinute: number;
  completedStep: number;
  authorisationMode: SystemMode;
  targetedRacks: number[];
  stabilizedRacks: number[];
  unresolvedRacks: number[];
  peakBeforeC: number;
  peakAfterC: number;
  unmitigatedPeakC: number;
  perRackDeltas: Array<{
    rackId: number;
    label: string;
    tempBeforeC: number;
    tempAfterC: number;
    stabilized: boolean;
  }>;
  secondaryRiskCreated: boolean;
  waterUsedDeltaL: number;
  energyUsedDeltaKWh: number;
  slaViolations: number;
  summaryText: string;
}

export interface CoordinatedResponsePlan {
  id: string;
  timestamp: string;
  minute: number;
  step: number;
  addressedIncidentIds: string[];
  sourceRacks: number[];
  receiverRacks: number[];
  targetRacks: number[];
  evaluatedCandidatesCount: number;
  compatibleActionsCount: number;
  conflictResolutions: string[];
  rackAssignments: RackActionAssignment[];
  transfers: WorkloadTransferEdge[];
  actions: MultiRackInterventionAction[];
  workloadRedistribution?: {
    fromRack: number;
    fromRacks?: number[];
    toRacks: Array<{ rack: number; percentage: number }>;
    totalFractionMoved: number;
    migrationEnergyKWh: number;
  };
  coolingAdjustment: {
    fanSpeedDeltaPct: number;
    targetFanPct: number;
    supplyTempC: number;
    mode: 'dry' | 'wet';
  };
  sensorBypass?: {
    rackId: number;
    modelInferenceC: number;
    addedUncertaintyC: number;
  };
  predictedOutcomes: {
    peakTempReductionDegC: number;
    baselineProjectedPeakC: number;
    projectedPeakC: number;
    waterImpactLitres: number;
    pueImpact: number;
    slaViolations: number;
    migrationEnergyKWh: number;
    usefulHeatKWhTh: number;
    tegHarvestKWh: number;
  };
  resourceImpact: {
    waterConsumedL: number;
    waterRemainingL: number;
    waterBudgetL: number;
    coolingKW: number;
    gridKW: number;
  };
  engineAction: ControlAction;
  preInterventionTemps: number[];
  preInterventionWaterL: number;
  preInterventionEnergyKWh: number;
  rationale: string;
  safetyVerificationCheck: string;
  authorisationMode: SystemMode;
  status: 'PROPOSED' | 'APPROVED' | 'AUTO_AUTHORISED' | 'IN_PROGRESS' | 'VERIFYING' | 'RESOLVED' | 'FAILED';
  verificationStepsTotal: number;
  verificationStepsRemaining: number;
}

export interface RackStepTelemetry {
  rackId: number;
  inletTempC: number;
  exhaustTempC: number;
  mandatoryLoad: number;
  flexibleLoad: number;
  totalLoad: number;
  maxSafeLoad: number;
  idlePowerKW: number;
  workloadPowerKW: number;
  heatGeneratedKW: number;
  ambientRecircKW: number;
  coolingRemovedKW: number;
  recoveryExtractedKW: number;
  netHeatKW: number;
  localAirflowPct: number;
  localSupplyC: number;
  thermalMassKJPerC: number;
}

export interface MinuteSubStep {
  minuteOffset: number; // 1..5 within the 5-min decision epoch
  minute: number; // absolute simulated minutes from 09:00
  temps: number[];
  estimated: number[];
  rackHeatGenKW: number[];
  rackCoolKW: number[];
  rackRecKW: number[];
  rackNetHeatKW: number[];
  extractedRecoveryKW: number;
  usefulRecoveryKW: number;
  tegHarvestKW: number;
  hotManifoldC: number;
  waterL: number;
  energyKWh: number;
  heatKWhTh: number;
  generatedKWh: number;
}

export interface RackFacilityState {
  id: number;
  label: string; // 'R01'..'R12'
  row: number;
  col: number;
  simulatedInletC: number;
  estimatedInletC: number;
  predictedInletC: number;
  predictionHorizonMin: number;
  uncertaintyMarginC: number;
  temperatureLimitC: number;
  thermalRiskState: 'HEALTHY' | 'WARMING' | 'CRITICAL';
  workloadUtil: number;
  mandatoryWorkload: number;
  flexibleWorkload: number;
  maxSafeCapacityPct: number;
  workloadDeltaPct: number;
  idlePowerKW: number;
  workloadPowerKW: number;
  heatGeneratedKW: number;
  coolingRemovedKW: number;
  recoveryExtractedKW: number;
  netHeatKW: number;
  localAirflowPct: number;
  exhaustTempC: number;
  airflowRestriction: number;
  sensorAvailable: boolean;
  sensorStatus: 'ONLINE' | 'OFFLINE_SYNTHETIC';
  supplyAirC: number;
  activeIncidentIds: string[];
  activeActions: string[];
  currentActionLabel: string;
  thermosBranchState:
    | 'IDLE'
    | 'BLUE_SENSING'
    | 'BLUE_COORDINATING'
    | 'GREEN_INTERVENING'
    | 'GREEN_RECEIVING'
    | 'MONITORING'
    | 'ESCALATED';
  recentTemps: number[];
}

export interface ThermosIntelligenceStatus {
  enabled: boolean;
  visualState: ThermosVisualState;
  headline: string;
  subline: string;
  activeIncidentCount: number;
  affectedRackCount: number;
  evaluatedCandidatesCount: number;
  selectedActionsCount: number;
  inProgressActionsCount: number;
  resolvedCount: number;
  escalatedRackCount: number;
  inspectedRacks: number[];
  interveningRacks: number[];
  receivingRacks: number[];
  activeRecoveryRacks: number[];
  activeTransfers: WorkloadTransferEdge[];
}

export interface SelfAwarenessAction {
  id: string;
  minute: number;
  timeString: string;
  actor: 'THERMOS' | 'USER' | 'FACILITY';
  kind: 'JOB_MOVE' | 'COOLING' | 'SENSOR' | 'HEAT_REUSE' | 'CONTROL' | 'CONDITION';
  summary: string;
  target?:
    | { type: 'rack'; rackId: number }
    | { type: 'core' }
    | { type: 'pathway'; kind: 'compute' | 'heat' | 'recovery' | 'cooling' };
}

export interface SelfAwarenessState {
  currentIntent: string;
  activeActions: SelfAwarenessAction[];
  recentActions: SelfAwarenessAction[];
}

export interface GlobalFacilityState {
  // Global simulation progression
  step: number;
  minute: number;
  timeString: string;
  speed: number;
  isPlaying: boolean;
  isComplete: boolean;
  systemMode: SystemMode;
  decisionHoldReason: string | null;

  // Environment and inputs
  scenarioKey: PresetKey;
  scenarioLabel: string;
  outsideTempC: number;
  incomingDemandPct: number;
  totalWorkloadPct: number;

  // Power & Resource Ledgers
  computingPowerKW: number;
  coolingPowerKW: number;
  gridPowerKW: number;
  cumulativeEnergyKWh: number;
  externalHeatAvoidedKWh: number;
  pue: number;
  waterConsumedL: number;
  waterBudgetL: number;
  waterRemainingL: number;
  waterAllowanceRemainingPct: number;

  // Active Cooling Infrastructure
  activeCoolingMode: 'dry' | 'wet';
  coolingSupplyC: number;
  coolingFanPct: number;

  // Health summary
  rackCounts: {
    healthy: number;
    warming: number;
    critical: number;
    sensorUnavailable: number;
  };

  // THERMOS Physical Entity & Intelligence State
  thermos: ThermosIntelligenceStatus;

  // Incident & Response System
  activeIncidents: FacilityIncident[];
  resolvedIncidents: FacilityIncident[];
  pendingPlan: CoordinatedResponsePlan | null;
  activePlan: CoordinatedResponsePlan | null;
  appliedPlans: CoordinatedResponsePlan[];
  rejectedPlanIds: string[];
  lastVerifiedOutcome: VerifiedInterventionOutcome | null;

  // Compact Authentic State-Change Timeline
  timelineEvents: FacilityTimelineEvent[];

  // Live Self-Awareness of Internal & User Actions
  selfAwareness: SelfAwarenessState;

  // Waste Heat Recovery & Thermoelectrics
  heatRecovery: {
    availableHeatKW: number;
    extractedHeatKW: number;
    transferEfficiency: number;
    demandKW: number;
    thermalEnergyCapturedKW: number;
    usefulHeatKWhTh: number;
    pumpPowerKW: number;
    tegGenerationKW: number;
    tegHarvestKWh: number;
    hotLoopTempC: number;
    coldSinkTempC: number;
    deltaTC: number;
    isExporting: boolean;
    activeRackIds: number[];
    status: string;
  };

  // Per-rack tracking R01-R12
  racks: RackFacilityState[];

  // Dynamic Natural Language Situational Assessment
  situationalSummary: string;
}

export interface ScenarioPreset {
  label: string;
  outside: number;
  demand: number;
  water: number;
  sensors: number;
  restriction: number;
  heatDemand: number;
  heatwave: boolean;
  failure: boolean;
  multiHotspot?: boolean;
  seed: number;
}

export interface ThermosConfig extends ScenarioPreset {
  limit: number;
  priority: 'balanced' | 'water' | 'energy';
  recovery: boolean;
}

export type PlacementStyle = 'original' | 'spread' | 'consolidate' | 'targeted';

export interface ControlAction {
  supply: number;
  fan: number;
  mode: 'dry' | 'wet';
  fraction: number;
  style: PlacementStyle;
  rackFans?: number[];
  rackSupplyOffsets?: number[];
  recoveryValves?: number[];
  targetedRacks?: number[];
}

export interface Job {
  id: string;
  release: number;
  due: number;
  work: number;
  remaining: number;
  late: boolean;
}

export interface CoolingPowerResult {
  it: number;
  fan: number;
  chiller: number;
  cooling: number;
  water: number;
  cop: number;
}

export interface RecoveryMetrics {
  hot: number;
  cold: number;
  heatAvailable: number;
  extractedHeat: number;
  transferEfficiency: number;
  demandKW: number;
  tegHeat: number;
  gross: number;
  harvest: number;
  useful: number;
  pump: number;
  tegAux: number;
  avoidedExternal: number;
  activeRackIds: number[];
  perRackExtractedKW: number[];
}

export interface LoadBalanceResult {
  loads: number[];
  moved: number;
  unserved: number;
  transfers?: WorkloadTransferEdge[];
  sourceRacks?: number[];
  receiverRacks?: number[];
}

export interface Observation {
  estimated: number[];
  uncertainty: number[];
  ids: number[];
  readings: Record<number, number>;
}

export interface PlanEvaluation extends ControlAction {
  layout: LoadBalanceResult;
  extra: number;
  power: CoolingPowerResult;
  predictions: number[];
  upper: number[];
  risk: number;
  waterExcess: number;
  score: number;
  alternatives?: Array<{
    supply: number;
    fan: number;
    mode: 'dry' | 'wet';
    style: PlacementStyle;
    batch: number;
    predictedMax: number;
    score: number;
    waterExcess: number;
  }>;
}

export interface ControllerSummary {
  controller: string;
  minutes: number;
  grid_kwh: number;
  cooling_kwh: number;
  it_kwh: number;
  monitoring_kwh: number;
  migration_kwh: number;
  recovery_aux_kwh: number;
  water_l: number;
  water_budget_l: number;
  water_budget_exceeded: boolean;
  peak_inlet_c: number;
  over_limit_rack_minutes: number;
  mandatory_rack_minutes: number;
  batch_completed_rack_minutes: number;
  batch_remaining_rack_minutes: number;
  missed_deadlines: number;
  useful_heat_kwh_th: number;
  recovered_electricity_kwh: number;
  monitoring_covered_kwh: number;
  monitoring_coverage_pct: number;
  storage_initial_kwh: number;
  storage_final_kwh: number;
  external_heat_user_avoided_kwh: number;
}

export interface LogEntry {
  minute: number;
  text: string;
}

export interface StepRecord {
  step: number;
  minute: number;
  outside: number;
  temps: number[];
  estimated: number[];
  uncertainty: number[];
  sensors: number[];
  rawLoads: number[];
  loads: number[];
  transfers?: WorkloadTransferEdge[];
  targetedRacks: number[];
  rackTelemetry: RackStepTelemetry[];
  minuteSnapshots: MinuteSubStep[];
  predictions: number[];
  upper: number[];
  control: { supply: number; fan: number; mode: 'dry' | 'wet' };
  style: string;
  batch: number;
  energy: number;
  water: number;
  heat: number;
  generated: number;
  stored: number;
  monitorEnergy: number;
  usedHarvest: number;
  peak: number;
  gridKW: number;
  coolingKW: number;
  rec: RecoveryMetrics;
  violations: number;
  backlog: number;
  deadlineMisses: number;
  reasons: string[];
  alternatives: Array<{
    supply: number;
    fan: number;
    mode: 'dry' | 'wet';
    style: string;
    batch: number;
    predictedMax: number;
    score: number;
    waterExcess: number;
  }>;
  score: number;
  waterExcess: number;
  power: CoolingPowerResult;
  unserved: number;
  totals: ControllerSummary;
}

export interface SimulationState {
  controller?: ControllerType;
  t: number;
  temps: number[];
  expected: number[];
  rackFans: number[];
  jobs: Job[];
  control: { supply: number; fan: number; mode: 'dry' | 'wet' };
  water: number;
  energy: number;
  itEnergy: number;
  coolingEnergy: number;
  monitorEnergy: number;
  recoveryEnergy: number;
  generated: number;
  usedHarvest: number;
  stored: number;
  heat: number;
  externalAvoided: number;
  completed: number;
  mandatory: number;
  missed: number;
  violationRackMinutes: number;
  peak: number;
  migrationEnergy: number;
  logs: LogEntry[];
  trace: StepRecord[];
  lastPlan: StepRecord | null;
}

export interface ForestNode {
  0: number; // feature index (-2 for leaf)
  1: number; // threshold
  2: number; // left child index
  3: number; // right child index
  4: number; // leaf value
}

export interface ForestModel {
  metadata: {
    name: string;
    target: string;
    seed: number;
    dataset_seed: number;
    horizon_minutes: number;
    trees: number;
    max_depth: number;
    calibration_q95: number;
    features: string[];
    feature_ranges: number[][];
    metrics: {
      mae_c: number;
      rmse_c: number;
      r2_temperature: number;
      test_95_interval_coverage: number;
      persistence_mae_c: number;
      test_samples: number;
      train_samples: number;
      calibration_samples: number;
      train_episodes: number;
      calibration_episodes: number;
      test_episodes: number;
    };
    feature_importance: number[];
    data_source: string;
    split: string;
    scope: string;
    sklearn_version: string;
    python_version: string;
  };
  trees: number[][][];
}
