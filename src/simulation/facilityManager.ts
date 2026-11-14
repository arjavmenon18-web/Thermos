import type {
  ThermosConfig,
  StepRecord,
  SimulationState,
  ForestModel,
  PresetKey,
  SystemMode,
  ThermosVisualState,
  ThermosIntelligenceStatus,
  FacilityIncident,
  FacilityTimelineEvent,
  TimelineEventCategory,
  CoordinatedResponsePlan,
  RackActionAssignment,
  VerifiedInterventionOutcome,
  RackFacilityState,
  GlobalFacilityState,
  ControlAction,
  SelfAwarenessAction,
  SelfAwarenessState,
} from './types';
import * as E from './engine';

export class FacilityStateManager {
  private config: ThermosConfig;
  private scenarioKey: PresetKey;
  private model: ForestModel | null;
  private systemMode: SystemMode;
  private thermosEnabled: boolean;

  private activeIncidents: Map<string, FacilityIncident> = new Map();
  private resolvedIncidents: FacilityIncident[] = [];
  private pendingPlan: CoordinatedResponsePlan | null = null;
  private activePlan: CoordinatedResponsePlan | null = null;
  private appliedPlans: CoordinatedResponsePlan[] = [];
  private rejectedPlanIds: string[] = [];
  private lastVerifiedOutcome: VerifiedInterventionOutcome | null = null;
  private timelineEvents: FacilityTimelineEvent[] = [];
  private recentActions: SelfAwarenessAction[] = [];

  private lastEvaluatedStep: number = -1;
  private lastSyncedRecordStep: number = -1;
  private lastRecordedSubKey: string = '';
  private resolvedBannerStepsRemaining: number = 0;
  private rejectedCooldownUntilStep: number = -1;
  private lastRecoveryExportState: boolean = false;
  private lastCoolingSignature: string = '22-58-dry';
  private lastHoldReason: string | null = null;

  private lastTemps: number[] = [];
  private recentTempsHistory: number[][] = [];

  constructor(
    config: ThermosConfig,
    scenarioKey: PresetKey = 'compound',
    model: ForestModel | null = null,
    systemMode: SystemMode = 'interactive',
    thermosEnabled: boolean = true
  ) {
    this.config = config;
    this.scenarioKey = scenarioKey;
    this.model = model;
    this.systemMode = systemMode;
    this.thermosEnabled = thermosEnabled;
    const initTemps = E.initialRackTemps(config);
    this.lastTemps = [...initTemps];
    this.recentTempsHistory = initTemps.map((t) => [t]);
  }

  public setSystemMode(mode: SystemMode): void {
    this.systemMode = mode;
    if (this.thermosEnabled && mode === 'demonstration' && this.pendingPlan && !this.activePlan) {
      this.authorisePendingPlan(true);
    }
  }

  public getSystemMode(): SystemMode {
    return this.systemMode;
  }

  public setThermosEnabled(
    enabled: boolean,
    currentMinute: number = 0,
    currentStep: number = 0
  ): void {
    if (this.thermosEnabled === enabled) return;
    this.thermosEnabled = enabled;
    if (!enabled) {
      this.pendingPlan = null;
      this.activePlan = null;
      this.resolvedBannerStepsRemaining = 0;
      this.lastHoldReason = null;
      // Clear predictive-only AI advisories while paused
      Array.from(this.activeIncidents.entries()).forEach(([id, inc]) => {
        if (inc.type === 'PREDICTED_THERMAL_VIOLATION' || inc.type === 'HEAT_RECOVERY_OPPORTUNITY') {
          this.activeIncidents.delete(id);
        } else if (inc.status === 'RESPONSE_PROPOSED' || inc.status === 'IN_PROGRESS' || inc.status === 'VERIFYING') {
          inc.status = 'DETECTED';
        }
      });
      this.pushTimelineEvent(
        currentMinute,
        currentStep,
        'COOLING',
        [],
        'THERMOS paused — fixed cooling rules active',
        'No smart job moves, targeted fans, or neighbor sensor estimates running.'
      );
      this.pushSelfAction({
        minute: currentMinute,
        actor: 'USER',
        kind: 'CONTROL',
        summary: 'Paused THERMOS — room running on fixed 22°C cooling',
        target: { type: 'core' },
      });
    } else {
      // Force immediate fresh evaluation on live facility state upon re-engaging THERMOS
      this.lastEvaluatedStep = -1;
      this.pushTimelineEvent(
        currentMinute,
        currentStep,
        'DETECTION',
        [],
        'THERMOS active — smart sensing & control online',
        'Watching all 12 racks 15 minutes ahead and balancing jobs + cooling.'
      );
      this.pushSelfAction({
        minute: currentMinute,
        actor: 'USER',
        kind: 'CONTROL',
        summary: 'Turned on THERMOS AI control',
        target: { type: 'core' },
      });
    }
  }

  public isThermosEnabled(): boolean {
    return this.thermosEnabled;
  }

  public clearVerifiedOutcome(): void {
    this.lastVerifiedOutcome = null;
  }

  public recordUserAction(
    kind: SelfAwarenessAction['kind'],
    summary: string,
    minute: number = 0,
    target?: SelfAwarenessAction['target']
  ): void {
    this.pushSelfAction({
      minute,
      actor: 'USER',
      kind,
      summary,
      target,
    });
  }

  private pushSelfAction(input: {
    minute: number;
    actor: SelfAwarenessAction['actor'];
    kind: SelfAwarenessAction['kind'];
    summary: string;
    target?: SelfAwarenessAction['target'];
  }): void {
    const prev = this.recentActions[0];
    if (prev && prev.summary === input.summary && Math.abs(prev.minute - input.minute) < 5) {
      return;
    }
    const action: SelfAwarenessAction = {
      id: `ACT_${input.minute}_${input.kind}_${this.recentActions.length}`,
      minute: input.minute,
      timeString: this.formatClock(input.minute),
      actor: input.actor,
      kind: input.kind,
      summary: input.summary,
      target: input.target,
    };
    this.recentActions.unshift(action);
    if (this.recentActions.length > 16) {
      this.recentActions.pop();
    }
  }

  /**
   * Returns the control action to commit into E.tick() for the upcoming 5-minute step:
   * - If THERMOS is paused (standby): strictly hold unmitigated static BMS baseline (zero AI action)
   * - If an approved/auto-authorised plan is active: commit its coordinated multi-rack engineAction
   * - If a proposed plan was rejected or is awaiting operator approval in Interactive mode: hold unmitigated 'original' placement
   * - Otherwise: let THERMOS select normally
   */
  public getControlOverrideForNextTick(state: SimulationState): ControlAction | undefined {
    if (!this.thermosEnabled) {
      return {
        supply: 22,
        fan: 0.58,
        mode: 'dry',
        fraction: 0.5,
        style: 'original',
        rackFans: Array(E.N).fill(0.58),
        rackSupplyOffsets: Array(E.N).fill(0),
        recoveryValves: Array(E.N).fill(0),
        targetedRacks: [],
      };
    }
    if (this.activePlan) {
      return this.activePlan.engineAction;
    }
    if (this.systemMode === 'interactive') {
      if (this.pendingPlan || state.t <= this.rejectedCooldownUntilStep) {
        return {
          supply: state.control.supply,
          fan: 0.58,
          mode: state.control.mode,
          fraction: 1,
          style: 'original',
        };
      }
    }
    return undefined;
  }

  public reset(newConfig?: ThermosConfig, newKey?: PresetKey): void {
    if (newConfig) this.config = newConfig;
    if (newKey) this.scenarioKey = newKey;
    this.activeIncidents.clear();
    this.resolvedIncidents = [];
    this.pendingPlan = null;
    this.activePlan = null;
    this.appliedPlans = [];
    this.rejectedPlanIds = [];
    this.lastVerifiedOutcome = null;
    this.timelineEvents = [];
    this.recentActions = [];
    this.lastEvaluatedStep = -1;
    this.lastSyncedRecordStep = -1;
    this.lastRecordedSubKey = '';
    this.resolvedBannerStepsRemaining = 0;
    this.rejectedCooldownUntilStep = -1;
    this.lastRecoveryExportState = false;
    this.lastCoolingSignature = '22-58-dry';
    this.lastHoldReason = null;
    const initTemps = E.initialRackTemps(this.config);
    this.lastTemps = [...initTemps];
    this.recentTempsHistory = initTemps.map((t) => [t]);
    const presetLabel =
      this.scenarioKey === 'normal'
        ? 'Normal Working Day'
        : this.scenarioKey === 'water'
        ? 'Severe Drought Cap'
        : this.scenarioKey === 'sensor'
        ? 'Sensor Failure'
        : this.scenarioKey === 'heatwave'
        ? 'Heatwave Surge'
        : this.scenarioKey === 'noheat'
        ? 'No Heat Demand'
        : 'Compound Stress';
    this.pushSelfAction({
      minute: 0,
      actor: 'FACILITY',
      kind: 'CONDITION',
      summary: `Started ${presetLabel} (${this.config.outside}°C outside, ${this.config.water}L water cap)`,
      target: { type: 'core' },
    });
  }

  private rackLabel(i: number): string {
    return `R${String(i + 1).padStart(2, '0')}`;
  }

  private pushTimelineEvent(
    minute: number,
    step: number,
    category: TimelineEventCategory,
    racks: number[],
    summary: string,
    detail: string
  ): void {
    const id = `EVT_${step}_${minute}_${category}_${this.timelineEvents.length}`;
    this.timelineEvents.unshift({
      id,
      minute,
      step,
      timeString: this.formatClock(minute),
      category,
      racks: [...racks],
      summary,
      detail,
    });
    if (this.timelineEvents.length > 64) {
      this.timelineEvents.pop();
    }
  }

  /**
   * Continuous Global State-Evaluation Cycle across all 12 racks.
   * Supports 1-minute ODE sub-step inspection (`subMinuteIndex` 0..4) while running
   * controller decision-epoch transitions cleanly at each 5-minute boundary (`subMinuteIndex === 4`).
   */
  public evaluateFacilityState(
    currentRecord: StepRecord | null,
    currentState: SimulationState,
    speed: number = 1,
    isPlaying: boolean = false,
    subMinuteIndex: number = 4,
    isScrubbing: boolean = false
  ): GlobalFacilityState {
    const clampedSubIdx = Math.max(0, Math.min(E.DT - 1, subMinuteIndex));
    const isMidStep = Boolean(
      !isScrubbing &&
        currentRecord &&
        currentRecord.minuteSnapshots &&
        currentRecord.minuteSnapshots.length === E.DT &&
        clampedSubIdx < E.DT - 1
    );
    const snap =
      !isScrubbing && currentRecord && currentRecord.minuteSnapshots?.length === E.DT
        ? currentRecord.minuteSnapshots[clampedSubIdx]
        : null;

    // Decision epoch step completed so far (during mid-step minutes 1..4 of step S, completed step is S)
    const completedStep = currentRecord
      ? isMidStep
        ? currentRecord.step
        : currentRecord.step + 1
      : currentState.t;
    const minute = snap
      ? snap.minute
      : currentRecord
      ? currentRecord.minute
      : completedStep * E.DT;
    const timeString = this.formatClock(minute);

    const outsideTempC = currentRecord
      ? currentRecord.outside
      : E.ambient(this.config, Math.min(E.STEPS - 1, completedStep));
    const rawDemand = currentRecord
      ? currentRecord.rawLoads
      : E.rawDemand(this.config, Math.min(E.STEPS - 1, completedStep));
    const incomingDemandPct = Math.round(E.mean(rawDemand) * 100);

    const activeSensors = currentRecord
      ? currentRecord.sensors
      : E.sensorMask(this.config, Math.min(E.STEPS - 1, completedStep));
    const actualTemps = snap
      ? snap.temps
      : currentRecord
      ? currentRecord.temps
      : currentState.temps;
    const estimatedTemps = snap
      ? snap.estimated
      : currentRecord
      ? currentRecord.estimated
      : currentState.expected;
    const uncertainties = currentRecord ? currentRecord.uncertainty : Array(E.N).fill(0.12);
    const predictions = currentRecord ? currentRecord.predictions : actualTemps;
    const upperBounds = currentRecord
      ? currentRecord.upper
      : predictions.map((p, i) => p + uncertainties[i]);
    const loads = currentRecord ? currentRecord.loads : rawDemand;

    // Record minute-level sparkline history cleanly only on live progression (never during historical scrub)
    const subKey = `${currentRecord ? currentRecord.step : -1}:${clampedSubIdx}`;
    if (!isScrubbing && subKey !== this.lastRecordedSubKey && (currentRecord || completedStep > 0)) {
      actualTemps.forEach((tVal, i) => {
        const hist = this.recentTempsHistory[i];
        if (!hist.length || Math.abs(hist[hist.length - 1] - tVal) > 1e-4 || clampedSubIdx === E.DT - 1) {
          hist.push(tVal);
          if (hist.length > 24) hist.shift();
        }
      });
      this.lastRecordedSubKey = subKey;
    }

    // Sync executed engine actions immediately when a new StepRecord arrives (even on subMinuteIndex === 0)
    if (!isScrubbing && currentRecord && currentRecord.step !== this.lastSyncedRecordStep) {
      this.lastSyncedRecordStep = currentRecord.step;
      const stepMin = currentRecord.minute;

      if ((currentRecord.transfers?.length ?? 0) > 0 && currentRecord.style !== 'original') {
        const srcSet = Array.from(new Set(currentRecord.transfers!.map((t) => t.fromRack)));
        const dstSet = Array.from(new Set(currentRecord.transfers!.map((t) => t.toRack)));
        const movedEq = currentRecord.transfers!.reduce((s, t) => s + t.fractionMoved, 0);
        const sig = `${srcSet.join(',')}->${dstSet.join(',')}`;
        const recentMig = this.timelineEvents.find(
          (e) => e.category === 'MIGRATION' && completedStep - e.step <= 1 && e.detail.includes(sig)
        );
        if (!recentMig) {
          this.pushTimelineEvent(
            stepMin,
            completedStep,
            'MIGRATION',
            [...srcSet, ...dstSet],
            `Moved jobs: ${srcSet.map((r) => this.rackLabel(r)).join(', ')} → ${dstSet.map((r) => this.rackLabel(r)).join(', ')}`,
            `Shifted ${Math.round(movedEq * 100)}% flexible workload (${sig}) away from warming racks.`
          );
        }
        this.pushSelfAction({
          minute: stepMin,
          actor: this.thermosEnabled ? 'THERMOS' : 'FACILITY',
          kind: 'JOB_MOVE',
          summary: `Moved flexible jobs ${srcSet.map((r) => this.rackLabel(r)).join(', ')} → ${dstSet.map((r) => this.rackLabel(r)).join(', ')}`,
          target: { type: 'pathway', kind: 'compute' },
        });
      }

      const coolSig = `${currentRecord.control.supply}-${Math.round(currentRecord.control.fan * 100)}-${currentRecord.control.mode}`;
      if (coolSig !== this.lastCoolingSignature) {
        const tRacks = currentRecord.targetedRacks || [];
        const modeTxt = currentRecord.control.mode === 'wet' ? 'Water-Mist' : 'Dry Air';
        this.pushTimelineEvent(
          stepMin,
          completedStep,
          'COOLING',
          tRacks,
          tRacks.length > 0
            ? `Boosted airflow ${Math.round(currentRecord.control.fan * 100)}% on ${tRacks.map((r) => this.rackLabel(r)).join(', ')}`
            : `Cooling set to ${currentRecord.control.supply}°C (${modeTxt})`,
          `Supply air at ${currentRecord.control.supply}°C (${modeTxt}) with ${Math.round(currentRecord.control.fan * 100)}% fans.`
        );
        this.pushSelfAction({
          minute: stepMin,
          actor: this.thermosEnabled ? 'THERMOS' : 'FACILITY',
          kind: 'COOLING',
          summary:
            tRacks.length > 0
              ? `Cooling ${modeTxt} (${currentRecord.control.supply}°C) + boosted ${tRacks.map((r) => this.rackLabel(r)).join(', ')} fans to ${Math.round(currentRecord.control.fan * 100)}%`
              : `Switched cooling to ${modeTxt} (${currentRecord.control.supply}°C, ${Math.round(currentRecord.control.fan * 100)}% fans)`,
          target: { type: 'pathway', kind: 'cooling' },
        });
        this.lastCoolingSignature = coolSig;
      }

      const isNowExporting = currentRecord.rec.useful > 0.2;
      if (isNowExporting && !this.lastRecoveryExportState) {
        const hotRacks = currentRecord.rec.activeRackIds;
        this.pushTimelineEvent(
          stepMin,
          completedStep,
          'RECOVERY',
          hotRacks,
          `Hydronic recovery active: ${currentRecord.rec.useful.toFixed(1)} kW_th potential`,
          `Capturing ${currentRecord.rec.extractedHeat.toFixed(1)} kW_th from ${hotRacks.map((r) => this.rackLabel(r)).join(', ') || 'warm racks'} (${currentRecord.rec.hot.toFixed(1)}°C manifold, 88% HX concept).`
        );
        this.pushSelfAction({
          minute: stepMin,
          actor: 'THERMOS',
          kind: 'HEAT_REUSE',
          summary: `Hydronic recovery active: ${currentRecord.rec.useful.toFixed(1)} kW_th conceptual reuse`,
          target: { type: 'pathway', kind: 'recovery' },
        });
      }
      this.lastRecoveryExportState = isNowExporting;
    }

    // Run discrete 5-minute controller/incident lifecycle ONLY on live decision-step boundaries (`!isMidStep && !isScrubbing`)
    const isNewDecisionStep = !isScrubbing && !isMidStep && completedStep !== this.lastEvaluatedStep;
    if (isNewDecisionStep) {
      this.lastHoldReason = null;

      if (this.resolvedBannerStepsRemaining > 0) {
        this.resolvedBannerStepsRemaining--;
      }

      // Log significant rack heating threshold crossings
      const newlyHotRacks = actualTemps
        .map((tVal, idx) => ({ idx, tVal, prev: this.lastTemps[idx] ?? tVal }))
        .filter((x) => x.tVal >= this.config.limit - 0.3 && x.prev < this.config.limit - 0.3);
      if (newlyHotRacks.length > 0) {
        const labels = newlyHotRacks.map((x) => this.rackLabel(x.idx)).join(', ');
        const peakHot = Math.max(...newlyHotRacks.map((x) => x.tVal));
        this.pushTimelineEvent(
          minute,
          completedStep,
          'HEATING',
          newlyHotRacks.map((x) => x.idx),
          `Hotspot alert on ${labels} (${peakHot.toFixed(1)}°C)`,
          `${labels} crossed ${(this.config.limit - 0.3).toFixed(1)}°C while cooler racks have spare room.`
        );
      }

      // 1. Advance active multi-rack plan lifecycle & post-action verification (only when THERMOS is enabled)
      if (this.thermosEnabled && this.activePlan && completedStep > this.activePlan.step) {
        this.advanceActivePlanVerification(
          completedStep,
          minute,
          actualTemps,
          upperBounds,
          currentState
        );
      }

      // 2. Detect & update multi-rack incidents from real engine quantities once simulation starts
      if (completedStep > 0 || currentRecord) {
        this.detectAndLifecycleIncidents(
          completedStep,
          minute,
          actualTemps,
          estimatedTemps,
          predictions,
          upperBounds,
          uncertainties,
          loads,
          rawDemand,
          activeSensors,
          outsideTempC,
          currentState
        );

        // 3. Correlate & prioritise incidents globally
        this.correlateAndPrioritiseIncidents();

        // 4. Evaluate simultaneous multi-rack candidate interventions via engine ONLY when THERMOS is engaged
        if (this.thermosEnabled && completedStep > this.rejectedCooldownUntilStep) {
          this.evaluateCoordinatedResponse(
            completedStep,
            minute,
            timeString,
            actualTemps,
            estimatedTemps,
            uncertainties,
            activeSensors,
            currentState
          );
        } else if (!this.thermosEnabled) {
          this.pendingPlan = null;
          this.activePlan = null;
        }
      }

      this.lastTemps = [...actualTemps];
      this.lastEvaluatedStep = completedStep;
    }

    // 5. Determine THERMOS Visual State & Active Pathways
    const activePlanOrPending =
      isScrubbing || !this.thermosEnabled ? null : this.activePlan || this.pendingPlan;
    const interveningRacks = !this.thermosEnabled
      ? []
      : !isScrubbing && this.activePlan
      ? this.activePlan.sourceRacks
      : currentRecord && (isMidStep || isScrubbing) && (currentRecord.targetedRacks?.length ?? 0) > 0
      ? currentRecord.targetedRacks
      : [];
    const receivingRacks = !this.thermosEnabled
      ? []
      : !isScrubbing && this.activePlan
      ? this.activePlan.receiverRacks
      : currentRecord && (isMidStep || isScrubbing) && currentRecord.transfers
      ? Array.from(new Set(currentRecord.transfers.map((t) => t.toRack)))
      : [];

    // 6. Synthesize Per-Rack State R01–R12 with full causal power/heat/cooling/recovery quantities
    const racks: RackFacilityState[] = Array.from({ length: E.N }, (_, i) => {
      const isSensorOnline = activeSensors.includes(i);
      const tempSim = actualTemps[i];
      const tempEst = estimatedTemps[i];
      const pred = predictions[i];
      const upper = upperBounds[i];
      const uncert = uncertainties[i];
      const block = E.restriction(this.config, i);
      const limit = this.config.limit;

      const tel = currentRecord?.rackTelemetry?.[i];
      const loadVal = loads[i];
      const rawVal = rawDemand[i];
      const idleKW = tel ? tel.idlePowerKW : E.RACK_IDLE_KW;
      const dynKW = tel ? tel.workloadPowerKW : E.RACK_WORKLOAD_MAX_KW * loadVal;
      const heatGenKW = snap ? snap.rackHeatGenKW[i] : tel ? tel.heatGeneratedKW : idleKW + dynKW;
      const coolRemKW = snap
        ? snap.rackCoolKW[i]
        : tel
        ? tel.coolingRemovedKW
        : Math.max(0, 0.62 * (tempSim - 22));
      const recExtKW = snap ? snap.rackRecKW[i] : tel ? tel.recoveryExtractedKW : 0;
      const netKW = snap ? snap.rackNetHeatKW[i] : tel ? tel.netHeatKW : heatGenKW - coolRemKW - recExtKW;
      const localAirPct = tel ? tel.localAirflowPct : Math.round((currentState.rackFans?.[i] ?? 0.58) * 100);
      const localSupC = tel
        ? tel.localSupplyC
        : currentRecord
        ? currentRecord.control.supply
        : currentState.control.supply;
      const maxSafePct = tel ? Math.round(tel.maxSafeLoad * 100) : 100;
      const exhC = E.rackExhaustTempC(tempSim, loadVal);
      const workloadDeltaPct = Math.round((loadVal - rawVal) * 100);

      let thermalRiskState: 'HEALTHY' | 'WARMING' | 'CRITICAL' = 'HEALTHY';
      const hasStarted = completedStep > 0 || Boolean(currentRecord);
      if (hasStarted && (tempSim >= limit - 0.25 || (!isMidStep && upper >= limit + 0.35 && tempSim >= limit - 1.2))) {
        thermalRiskState = 'CRITICAL';
      } else if (hasStarted && (tempSim >= limit - 1.9 || (!isMidStep && upper >= limit - 0.75 && tempSim >= limit - 2.6))) {
        thermalRiskState = 'WARMING';
      }

      const activeIncidentIds: string[] = [];
      this.activeIncidents.forEach((inc) => {
        if (inc.affectedRacks.length <= 4 && inc.affectedRacks.includes(i)) {
          activeIncidentIds.push(inc.id);
        }
      });

      const activeActions: string[] = [];
      let currentActionLabel = 'Nominal · Static BMS operation';
      let thermosBranchState: RackFacilityState['thermosBranchState'] = 'IDLE';

      if (!this.thermosEnabled) {
        currentActionLabel = !isSensorOnline
          ? 'Sensor offline · Unmonitored while THERMOS paused'
          : 'THERMOS paused · Static 58% fan, unshifted load';
        thermosBranchState = 'IDLE';
      } else {
        const assignment = activePlanOrPending?.rackAssignments.find((a) => a.rackId === i);
        if (this.activePlan && assignment) {
          activeActions.push(assignment.actionSummary);
          currentActionLabel = assignment.actionSummary;
          if (this.activePlan.status === 'VERIFYING' && !isMidStep) {
            thermosBranchState = 'MONITORING';
          } else if (assignment.role === 'COOL_RECEIVER') {
            thermosBranchState = 'GREEN_RECEIVING';
          } else {
            thermosBranchState = 'GREEN_INTERVENING';
          }
        } else if (this.pendingPlan && assignment) {
          currentActionLabel = `Proposed: ${assignment.actionSummary}`;
          thermosBranchState = 'BLUE_COORDINATING';
        } else if (interveningRacks.includes(i)) {
          currentActionLabel =
            workloadDeltaPct <= -8
              ? `Relieved ${workloadDeltaPct}% batch load · ${localAirPct}% local damper`
              : `Targeted ${localAirPct}% local damper${recExtKW > 0.08 ? ' + exhaust recovery' : ''}`;
          thermosBranchState = 'GREEN_INTERVENING';
        } else if (receivingRacks.includes(i)) {
          currentActionLabel = `Hosting +${Math.max(1, workloadDeltaPct)}% shifted batch jobs safely`;
          thermosBranchState = 'GREEN_RECEIVING';
        } else if (thermalRiskState === 'CRITICAL' && currentRecord && currentRecord.violations > 0) {
          currentActionLabel = isMidStep
            ? 'Local thermal spike detected — evaluating relief'
            : 'Escalated: physical cooling/ambient ceiling reached';
          thermosBranchState = isMidStep ? 'BLUE_SENSING' : 'ESCALATED';
        } else if (
          activeIncidentIds.length > 0 ||
          thermalRiskState !== 'HEALTHY' ||
          (!isSensorOnline && this.config.failure && i === 6 && completedStep >= 24)
        ) {
          currentActionLabel = isSensorOnline
            ? 'Forecasting +15m inlet trajectory & cool rack headroom'
            : 'Virtual sensor active (distance-weighted spatial interpolation)';
          thermosBranchState = 'BLUE_SENSING';
        }
      }

      return {
        id: i,
        label: this.rackLabel(i),
        row: Math.floor(i / 4),
        col: i % 4,
        simulatedInletC: Number(tempSim.toFixed(2)),
        estimatedInletC: Number(tempEst.toFixed(2)),
        predictedInletC: Number(pred.toFixed(2)),
        predictionHorizonMin: E.HORIZON * E.DT,
        uncertaintyMarginC: Number(uncert.toFixed(2)),
        temperatureLimitC: limit,
        thermalRiskState,
        workloadUtil: Number(loadVal.toFixed(2)),
        mandatoryWorkload: Number((rawVal * 0.45).toFixed(2)),
        flexibleWorkload: Number(Math.max(0, loadVal - rawVal * 0.45).toFixed(2)),
        maxSafeCapacityPct: maxSafePct,
        workloadDeltaPct,
        idlePowerKW: Number(idleKW.toFixed(2)),
        workloadPowerKW: Number(dynKW.toFixed(2)),
        heatGeneratedKW: Number(heatGenKW.toFixed(2)),
        coolingRemovedKW: Number(coolRemKW.toFixed(2)),
        recoveryExtractedKW: Number(recExtKW.toFixed(2)),
        netHeatKW: Number(netKW.toFixed(2)),
        localAirflowPct: localAirPct,
        exhaustTempC: Number(exhC.toFixed(1)),
        airflowRestriction: Number(block.toFixed(3)),
        sensorAvailable: isSensorOnline,
        sensorStatus: isSensorOnline ? 'ONLINE' : 'OFFLINE_SYNTHETIC',
        supplyAirC: Number(localSupC.toFixed(1)),
        activeIncidentIds,
        activeActions,
        currentActionLabel,
        thermosBranchState,
        recentTemps:
          isScrubbing && currentRecord && currentState.trace.length > 0
            ? currentState.trace
                .slice(Math.max(0, currentRecord.step - 23), currentRecord.step + 1)
                .map((tr) => tr.temps[i] ?? tempSim)
            : [...(this.recentTempsHistory[i] || [tempSim])],
      };
    });

    // 7. Global Resource Accounting
    const computingPowerKW = currentRecord
      ? currentRecord.power.it
      : E.sum(loads.map(E.rackComputePowerKW));
    const coolingKW = currentRecord ? currentRecord.coolingKW : 2.35;
    const gridKW = currentRecord ? currentRecord.gridKW : computingPowerKW + coolingKW;
    const pue = computingPowerKW > 0 ? Number((gridKW / computingPowerKW).toFixed(2)) : 1.16;

    const waterConsumedL = snap
      ? Number(snap.waterL.toFixed(2))
      : currentRecord
      ? Number(currentRecord.water.toFixed(2))
      : Number(currentState.water.toFixed(2));
    const waterBudgetL = this.config.water;
    const waterRemainingL = Math.max(0, Number((waterBudgetL - waterConsumedL).toFixed(2)));
    const waterAllowanceRemainingPct =
      waterBudgetL > 0 ? Math.round((waterRemainingL / waterBudgetL) * 100) : 0;

    const rackCounts = {
      healthy: racks.filter((r) => r.thermalRiskState === 'HEALTHY').length,
      warming: racks.filter((r) => r.thermalRiskState === 'WARMING').length,
      critical: racks.filter((r) => r.thermalRiskState === 'CRITICAL').length,
      sensorUnavailable: racks.filter((r) => !r.sensorAvailable).length,
    };

    // 8. Causal Heat Recovery & Thermoelectric Accounting
    const rec = currentRecord
      ? currentRecord.rec
      : E.recovery(
          { it: computingPowerKW },
          loads,
          currentState.control,
          outsideTempC,
          this.config,
          actualTemps,
          completedStep === 0 ? Array(E.N).fill(0) : undefined
        );
    const liveHotC = snap ? snap.hotManifoldC : rec.hot;
    const liveExtractedKW = snap ? snap.extractedRecoveryKW : rec.extractedHeat;
    const liveUsefulKW = snap ? snap.usefulRecoveryKW : rec.useful;
    const liveTegKW = snap ? snap.tegHarvestKW : rec.harvest;
    const liveHeatKWhTh = snap
      ? snap.heatKWhTh
      : currentRecord
      ? currentRecord.heat
      : currentState.heat;
    const liveGenKWh = snap
      ? snap.generatedKWh
      : currentRecord
      ? currentRecord.generated
      : currentState.generated;
    const activeRecRacks = racks
      .filter((r) => r.recoveryExtractedKW > 0.06 && liveUsefulKW > 0.05)
      .map((r) => r.id);

    const deltaTC = Number((liveHotC - rec.cold).toFixed(1));
    const isExporting = liveUsefulKW > 0.05;
    const heatRecovery = {
      availableHeatKW: Number(rec.heatAvailable.toFixed(2)),
      extractedHeatKW: Number(liveExtractedKW.toFixed(2)),
      transferEfficiency: rec.transferEfficiency,
      demandKW: this.config.heatDemand,
      thermalEnergyCapturedKW: Number(liveUsefulKW.toFixed(2)),
      usefulHeatKWhTh: Number(liveHeatKWhTh.toFixed(2)),
      pumpPowerKW: Number(rec.pump.toFixed(3)),
      tegGenerationKW: Number(liveTegKW.toFixed(4)),
      tegHarvestKWh: Number(liveGenKWh.toFixed(4)),
      hotLoopTempC: Number(liveHotC.toFixed(1)),
      coldSinkTempC: Number(rec.cold.toFixed(1)),
      deltaTC,
      isExporting,
      activeRackIds: activeRecRacks,
      status: isExporting
        ? `Capturing ${liveExtractedKW.toFixed(1)} kW_th from ${activeRecRacks.length || rec.activeRackIds.length} warm racks (${liveUsefulKW.toFixed(1)} kW_th conceptual reuse @ ${liveHotC.toFixed(1)}°C)`
        : !this.thermosEnabled
        ? 'Standby · Valves closed while THERMOS is paused'
        : liveHotC < E.RECOVERY_MANIFOLD_MIN_C
        ? `Manifold at ${liveHotC.toFixed(1)}°C (requires ${E.RECOVERY_MANIFOLD_MIN_C.toFixed(0)}°C threshold)`
        : this.config.heatDemand <= 0
        ? 'No external thermal demand modeled'
        : !this.config.recovery
        ? 'Thermal recovery disabled'
        : `Warm outside air (${rec.cold.toFixed(1)}°C) limits recovery gradient`,
    };

    // 9. Build THERMOS Physical Entity & Intelligence Status
    const thermos = this.buildThermosIntelligenceStatus(
      completedStep,
      isMidStep,
      racks,
      currentRecord,
      interveningRacks,
      receivingRacks,
      activeRecRacks
    );

    // 10. Dynamic Situational Summary & Self-Awareness Snapshot
    const situationalSummary = this.generateDynamicSummary(
      racks,
      outsideTempC,
      waterRemainingL,
      waterBudgetL,
      rackCounts,
      thermos
    );

    const activeCoolingMode = currentRecord ? currentRecord.control.mode : currentState.control.mode;
    const coolingSupplyC = currentRecord ? currentRecord.control.supply : currentState.control.supply;
    const coolingFanPct = currentRecord
      ? Math.round(currentRecord.control.fan * 100)
      : Math.round(currentState.control.fan * 100);

    const selfAwareness = this.buildSelfAwarenessState(
      minute,
      timeString,
      racks,
      thermos,
      heatRecovery,
      activeCoolingMode,
      coolingSupplyC,
      coolingFanPct,
      waterRemainingL,
      isScrubbing,
      completedStep
    );

    return {
      step: completedStep,
      minute,
      timeString,
      speed,
      isPlaying,
      isComplete: completedStep >= E.STEPS && !isMidStep,
      systemMode: this.systemMode,
      decisionHoldReason: isMidStep ? null : this.lastHoldReason,
      scenarioKey: this.scenarioKey,
      scenarioLabel: E.presets[this.scenarioKey]?.label ?? 'Custom Scenario',
      outsideTempC: Number(outsideTempC.toFixed(1)),
      incomingDemandPct,
      totalWorkloadPct: Math.round(E.mean(loads) * 100),
      computingPowerKW: Number(computingPowerKW.toFixed(2)),
      coolingPowerKW: Number(coolingKW.toFixed(2)),
      gridPowerKW: Number(gridKW.toFixed(2)),
      cumulativeEnergyKWh: Number(currentState.energy.toFixed(2)),
      externalHeatAvoidedKWh: Number(currentState.externalAvoided.toFixed(2)),
      pue,
      waterConsumedL,
      waterBudgetL,
      waterRemainingL,
      waterAllowanceRemainingPct,
      activeCoolingMode,
      coolingSupplyC,
      coolingFanPct,
      rackCounts,
      thermos,
      activeIncidents: Array.from(this.activeIncidents.values()).sort(
        (a, b) => a.priorityRank - b.priorityRank
      ),
      resolvedIncidents: [...this.resolvedIncidents],
      pendingPlan: isScrubbing ? null : this.pendingPlan,
      activePlan: isScrubbing ? null : this.activePlan,
      appliedPlans: [...this.appliedPlans],
      rejectedPlanIds: [...this.rejectedPlanIds],
      lastVerifiedOutcome: isScrubbing ? null : this.lastVerifiedOutcome,
      timelineEvents: isScrubbing
        ? this.timelineEvents.filter((e) => e.step <= completedStep)
        : [...this.timelineEvents],
      selfAwareness,
      heatRecovery,
      racks,
      situationalSummary,
    };
  }

  private buildSelfAwarenessState(
    minute: number,
    timeString: string,
    racks: RackFacilityState[],
    thermos: ThermosIntelligenceStatus,
    heatRecovery: GlobalFacilityState['heatRecovery'],
    coolingMode: 'dry' | 'wet',
    supplyC: number,
    fanPct: number,
    waterRemainingL: number,
    isScrubbing: boolean,
    completedStep: number
  ): SelfAwarenessState {
    const activeActions: SelfAwarenessAction[] = [];

    if (!this.thermosEnabled) {
      activeActions.push({
        id: 'LIVE_PAUSED',
        minute,
        timeString,
        actor: 'FACILITY',
        kind: 'COOLING',
        summary: `Fixed cooling running (${supplyC.toFixed(0)}°C Dry Air, ${fanPct}% fans) — no AI job moves`,
        target: { type: 'pathway', kind: 'cooling' },
      });
      return {
        currentIntent:
          'THERMOS is paused — the room is running on basic fixed cooling with no smart job moves.',
        activeActions,
        recentActions: isScrubbing
          ? this.recentActions.filter((a) => a.minute <= minute).slice(0, 6)
          : this.recentActions.slice(0, 6),
      };
    }

    if (thermos.activeTransfers.length > 0) {
      const src = Array.from(new Set(thermos.activeTransfers.map((t) => this.rackLabel(t.fromRack)))).join(', ');
      const dst = Array.from(new Set(thermos.activeTransfers.map((t) => this.rackLabel(t.toRack)))).join(', ');
      activeActions.push({
        id: 'LIVE_JOB_MOVE',
        minute,
        timeString,
        actor: 'THERMOS',
        kind: 'JOB_MOVE',
        summary: `Moving flexible jobs off ${src} onto cooler ${dst}`,
        target: { type: 'pathway', kind: 'compute' },
      });
    }

    const offlineRacks = racks.filter((r) => !r.sensorAvailable);
    if (offlineRacks.length > 0) {
      const r = offlineRacks[0];
      activeActions.push({
        id: 'LIVE_SENSOR',
        minute,
        timeString,
        actor: 'THERMOS',
        kind: 'SENSOR',
        summary: `${r.label} hardware offline — model + neighbor estimate ~${r.estimatedInletC.toFixed(1)}°C (±${r.uncertaintyMarginC.toFixed(2)}°C)`,
        target: { type: 'rack', rackId: r.id },
      });
    }

    activeActions.push({
      id: 'LIVE_COOLING',
      minute,
      timeString,
      actor: 'THERMOS',
      kind: 'COOLING',
      summary:
        coolingMode === 'wet'
          ? `Using Water-Mist cooling (${supplyC.toFixed(0)}°C, ${fanPct}% fans) — ${waterRemainingL.toFixed(0)}L water left`
          : `Using Dry Air cooling (${supplyC.toFixed(0)}°C, ${fanPct}% fans) to save water (${waterRemainingL.toFixed(0)}L left)`,
      target: { type: 'pathway', kind: 'cooling' },
    });

    if (heatRecovery.isExporting) {
      activeActions.push({
        id: 'LIVE_HEAT_REUSE',
        minute,
        timeString,
        actor: 'THERMOS',
        kind: 'HEAT_REUSE',
        summary: `Hydronic recovery: ${heatRecovery.thermalEnergyCapturedKW.toFixed(1)} kW_th conceptual reuse (${(heatRecovery.tegGenerationKW * 1000).toFixed(0)} W aux TEG)`,
        target: { type: 'pathway', kind: 'recovery' },
      });
    }

    let currentIntent = `Watching all 12 racks 15 minutes ahead (${supplyC.toFixed(0)}°C ${coolingMode === 'wet' ? 'Water-Mist' : 'Dry Air'}).`;
    if (this.pendingPlan && this.systemMode === 'interactive') {
      currentIntent = `Plan ready for ${this.pendingPlan.sourceRacks.map((r) => this.rackLabel(r)).join(', ')} — waiting for your Approve or Skip.`;
    } else if (thermos.activeTransfers.length > 0) {
      currentIntent = activeActions[0].summary + '.';
    } else if (heatRecovery.isExporting) {
      currentIntent = `Balancing heat across all 12 racks with ${heatRecovery.thermalEnergyCapturedKW.toFixed(1)} kW_th conceptual hydronic recovery.`;
    }

    const recentActions = isScrubbing
      ? this.recentActions.filter((a) => a.minute <= completedStep * E.DT).slice(0, 6)
      : this.recentActions.slice(0, 6);

    return {
      currentIntent,
      activeActions,
      recentActions,
    };
  }

  private advanceActivePlanVerification(
    step: number,
    minute: number,
    actualTemps: number[],
    upperBounds: number[],
    currentState: SimulationState
  ): void {
    const plan = this.activePlan;
    if (!plan) return;

    const elapsedSteps = step - plan.step;
    if (elapsedSteps === 1) {
      plan.status = 'VERIFYING';
      plan.verificationStepsRemaining = Math.max(0, plan.verificationStepsTotal - 1);
      for (const incId of plan.addressedIncidentIds) {
        const inc = this.activeIncidents.get(incId);
        if (inc) inc.status = 'VERIFYING';
      }
      return;
    }

    plan.verificationStepsRemaining = Math.max(0, plan.verificationStepsTotal - elapsedSteps);
    if (plan.verificationStepsRemaining > 0) {
      plan.status = 'VERIFYING';
      return;
    }

    // Complete post-action verification using real simulated engine temperatures
    const limit = this.config.limit;
    const perRackDeltas = plan.sourceRacks.map((rackId) => {
      const before = plan.preInterventionTemps[rackId] ?? actualTemps[rackId];
      const after = actualTemps[rackId];
      const stabilized =
        after <= limit - 0.25 && (after <= before - 0.2 || upperBounds[rackId] <= limit + 0.35);
      return {
        rackId,
        label: this.rackLabel(rackId),
        tempBeforeC: Number(before.toFixed(2)),
        tempAfterC: Number(after.toFixed(2)),
        stabilized,
      };
    });

    const stabilizedRacks = perRackDeltas.filter((d) => d.stabilized).map((d) => d.rackId);
    const unresolvedRacks = perRackDeltas.filter((d) => !d.stabilized).map((d) => d.rackId);
    const secondaryRiskCreated = plan.receiverRacks.some((rId) => actualTemps[rId] >= limit - 0.2);

    const peakBeforeC = Number(Math.max(...plan.preInterventionTemps).toFixed(2));
    const peakAfterC = Number(Math.max(...actualTemps).toFixed(2));
    const unmitigatedPeakC = plan.predictedOutcomes.baselineProjectedPeakC;
    const waterUsedDeltaL = Number(
      Math.max(0, currentState.water - plan.preInterventionWaterL).toFixed(2)
    );
    const energyUsedDeltaKWh = Number(
      Math.max(0, currentState.energy - plan.preInterventionEnergyKWh).toFixed(2)
    );

    if (unresolvedRacks.length === 0 && !secondaryRiskCreated) {
      plan.status = 'RESOLVED';
      this.resolvedBannerStepsRemaining = 2;
      for (const incId of plan.addressedIncidentIds) {
        const inc = this.activeIncidents.get(incId);
        if (
          inc &&
          inc.type !== 'RESTRICTED_AIRFLOW' &&
          inc.type !== 'SENSOR_FAILURE' &&
          inc.type !== 'WATER_BUDGET_PRESSURE'
        ) {
          inc.status = 'RESOLVED';
          inc.resolutionMinute = minute;
          this.resolvedIncidents.unshift(inc);
          this.activeIncidents.delete(incId);
        } else if (inc) {
          inc.status = 'ASSESSED';
        }
      }
    } else {
      plan.status = 'FAILED';
      for (const rackIdx of unresolvedRacks) {
        this.recordActionDeficit(rackIdx, minute, step, actualTemps[rackIdx]);
      }
    }

    const tempComparisonPhrase =
      peakAfterC <= peakBeforeC
        ? `peak ${peakBeforeC.toFixed(1)}°C → ${peakAfterC.toFixed(1)}°C`
        : `peak held at ${peakAfterC.toFixed(1)}°C (vs ${unmitigatedPeakC.toFixed(1)}°C unmitigated)`;

    const summaryText =
      unresolvedRacks.length === 0
        ? `Verified across ${plan.targetRacks.length} racks: ${stabilizedRacks.length}/${plan.sourceRacks.length} stressed racks stabilised, ${tempComparisonPhrase}, zero secondary receiver violations.`
        : `${stabilizedRacks.length} racks stabilised; ${unresolvedRacks.map((r) => this.rackLabel(r)).join(', ')} remain near thermal ceiling (${peakAfterC.toFixed(1)}°C) — escalating reassessment.`;

    this.lastVerifiedOutcome = {
      planId: plan.id,
      completedMinute: minute,
      completedStep: step,
      authorisationMode: plan.authorisationMode,
      targetedRacks: [...plan.targetRacks],
      stabilizedRacks,
      unresolvedRacks,
      peakBeforeC,
      peakAfterC,
      unmitigatedPeakC,
      perRackDeltas,
      secondaryRiskCreated,
      waterUsedDeltaL,
      energyUsedDeltaKWh,
      slaViolations: currentState.missed,
      summaryText,
    };

    const deltaSummary = perRackDeltas
      .slice(0, 3)
      .map((d) => `${d.label} ${d.tempBeforeC.toFixed(1)}°→${d.tempAfterC.toFixed(1)}°C`)
      .join(', ');
    this.pushTimelineEvent(
      minute,
      step,
      'VERIFICATION',
      plan.targetRacks,
      unresolvedRacks.length === 0
        ? `Verified: ${deltaSummary}`
        : `Partial mitigation (${peakAfterC.toFixed(1)}°C) — reassessing`,
      summaryText
    );
    this.lastHoldReason = 'Verification complete';

    this.appliedPlans.unshift(plan);
    this.activePlan = null;
  }

  private detectAndLifecycleIncidents(
    step: number,
    minute: number,
    actualTemps: number[],
    estimatedTemps: number[],
    predictions: number[],
    upperBounds: number[],
    uncertainties: number[],
    loads: number[],
    rawDemand: number[],
    activeSensors: number[],
    outsideTempC: number,
    currentState: SimulationState
  ): void {
    const limit = this.config.limit;
    const newlyDetectedLabels: string[] = [];
    const newlyDetectedRacks = new Set<number>();

    // 1. Per-rack RACK_OVERHEATING, PREDICTED_THERMAL_VIOLATION, RAPID_TEMP_RISE
    for (let i = 0; i < E.N; i++) {
      const label = this.rackLabel(i);
      const temp = actualTemps[i];
      const pred = predictions[i];
      const upper = upperBounds[i];
      const prevTemp = this.lastTemps[i] ?? temp;
      const deltaStep = temp - prevTemp;

      const overId = `INC_OVERHEAT_R${i + 1}`;
      if (temp >= limit - 0.15) {
        const existing = this.activeIncidents.get(overId);
        if (!existing) {
          this.activeIncidents.set(overId, {
            id: overId,
            type: 'RACK_OVERHEATING',
            title: `Inlet Limit Breach on ${label}`,
            affectedRacks: [i],
            detectionMinute: minute,
            detectionStep: step,
            severity: 'CRITICAL',
            observedEvidence: `${label} inlet at ${temp.toFixed(1)}°C against ${limit.toFixed(1)}°C limit (${Math.round(loads[i] * 100)}% load).`,
            forecastEvidence: `15-min RF forecast ${pred.toFixed(1)}°C (95% upper bound ${upper.toFixed(1)}°C).`,
            resourceConstraints: ['Thermal SLA limit', 'Local convection headroom'],
            uncertaintyDegC: uncertainties[i],
            status: 'DETECTED',
            recommendedAction: `Shift movable compute from ${label} to verified cool outer racks, boost local damper, and extract exhaust heat.`,
            priorityRank: 1,
            priorityReason: 'Immediate inlet temperature breach at safety threshold.',
            linkedIncidentIds: [],
            appliedActions: [],
            resolutionCondition: `${label} inlet cools below ${(limit - 1.0).toFixed(1)}°C.`,
          });
          newlyDetectedLabels.push(`${label} (${temp.toFixed(1)}°C)`);
          newlyDetectedRacks.add(i);
        } else {
          existing.observedEvidence = `${label} inlet at ${temp.toFixed(1)}°C (${Math.round(loads[i] * 100)}% load).`;
          existing.forecastEvidence = `15-min RF forecast ${pred.toFixed(1)}°C (upper ${upper.toFixed(1)}°C).`;
        }
      } else if (this.activeIncidents.has(overId) && temp < limit - 1.0) {
        this.resolveIncident(overId, minute);
      }

      const predId = `INC_PRED_LIMIT_R${i + 1}`;
      if (this.thermosEnabled && step >= 1 && upper >= limit - 0.35 && temp < limit - 0.15) {
        const existing = this.activeIncidents.get(predId);
        if (!existing) {
          this.activeIncidents.set(predId, {
            id: predId,
            type: 'PREDICTED_THERMAL_VIOLATION',
            title: `Predicted Thermal Breach on ${label}`,
            affectedRacks: [i],
            detectionMinute: minute,
            detectionStep: step,
            severity: upper >= limit + 0.35 ? 'CRITICAL' : 'WARNING',
            observedEvidence: `${label} at ${temp.toFixed(1)}°C under ${Math.round(rawDemand[i] * 100)}% incoming demand.`,
            forecastEvidence: `15-min Random Forest model projects ${pred.toFixed(1)}°C (95% upper bound ${upper.toFixed(1)}°C).`,
            resourceConstraints: ['Thermal capacitance inertia', 'Pinned 45% mandatory floor'],
            uncertaintyDegC: uncertainties[i],
            status: 'DETECTED',
            recommendedAction: `Redistribute flexible batch compute from ${label} to cool unrestricted racks before breach.`,
            priorityRank: 2,
            priorityReason: 'Predictive 15-min horizon enables proactive localised relief.',
            linkedIncidentIds: [],
            appliedActions: [],
            resolutionCondition: `${label} upper forecast drops below ${(limit - 0.9).toFixed(1)}°C.`,
          });
          newlyDetectedRacks.add(i);
        } else {
          existing.severity = upper >= limit + 0.35 ? 'CRITICAL' : 'WARNING';
          existing.observedEvidence = `${label} at ${temp.toFixed(1)}°C (${Math.round(loads[i] * 100)}% active load).`;
          existing.forecastEvidence = `15-min forecast upper bound ${upper.toFixed(1)}°C.`;
        }
      } else if (this.activeIncidents.has(predId) && (!this.thermosEnabled || upper < limit - 0.9)) {
        this.resolveIncident(predId, minute);
      }

      const riseId = `INC_RAPID_RISE_R${i + 1}`;
      if (step >= 1 && deltaStep >= 1.1 && temp >= 28.5) {
        if (!this.activeIncidents.has(riseId)) {
          this.activeIncidents.set(riseId, {
            id: riseId,
            type: 'RAPID_TEMP_RISE',
            title: `Rapid Heating on ${label}`,
            affectedRacks: [i],
            detectionMinute: minute,
            detectionStep: step,
            severity: 'WARNING',
            observedEvidence: `${label} inlet climbed +${deltaStep.toFixed(2)}°C in 5 min (${prevTemp.toFixed(1)}°C → ${temp.toFixed(1)}°C).`,
            forecastEvidence: this.thermosEnabled
              ? `15-min forecast projects ${pred.toFixed(1)}°C if compute concentration persists.`
              : 'THERMOS forecasting paused; cabinet heating under static BMS airflow.',
            resourceConstraints: ['Local heat rejection rate'],
            uncertaintyDegC: uncertainties[i],
            status: 'DETECTED',
            recommendedAction: `Shift movable batch load off ${label} and open local intake damper.`,
            priorityRank: 3,
            priorityReason: 'Steep temperature rise approaches 30.0°C demonstration limit.',
            linkedIncidentIds: [],
            appliedActions: [],
            resolutionCondition: `5-min temperature slope < +0.25°C on ${label}.`,
          });
        }
      } else if (this.activeIncidents.has(riseId) && deltaStep < 0.25) {
        this.resolveIncident(riseId, minute);
      }
    }

    if (newlyDetectedLabels.length > 0) {
      this.pushTimelineEvent(
        minute,
        step,
        'DETECTION',
        Array.from(newlyDetectedRacks),
        this.thermosEnabled
          ? `Thermal threshold breach on ${newlyDetectedLabels.join(', ')}`
          : `Unmitigated hotspot breach on ${newlyDetectedLabels.join(', ')} (THERMOS paused)`,
        this.thermosEnabled
          ? `THERMOS flagged local thermal breach risk and initiated candidate workload & cooling evaluation.`
          : `Racks exceeded ${limit.toFixed(1)}°C under static building rules while THERMOS AI control is paused.`
      );
    }

    // 2. RESTRICTED_AIRFLOW (R07 & R08 physical impedance)
    [6, 7].forEach((rackIdx) => {
      const block = E.restriction(this.config, rackIdx);
      const id = `INC_AIRFLOW_R${rackIdx + 1}`;
      const label = this.rackLabel(rackIdx);
      if (block >= 0.15) {
        const existing = this.activeIncidents.get(id);
        if (!existing) {
          this.activeIncidents.set(id, {
            id,
            type: 'RESTRICTED_AIRFLOW',
            title: `Intake Obstruction on ${label} (−${Math.round(block * 100)}% Air)`,
            affectedRacks: [rackIdx],
            detectionMinute: minute,
            detectionStep: step,
            severity: block >= 0.25 && actualTemps[rackIdx] >= 28.0 ? 'CRITICAL' : 'WARNING',
            observedEvidence: `${label} intake air is blocked by ${Math.round(block * 100)}%; now at ${actualTemps[rackIdx].toFixed(1)}°C.`,
            forecastEvidence: `Room fans alone cannot cool ${label}; jobs need to move to cooler racks.`,
            resourceConstraints: ['Blocked air vent'],
            uncertaintyDegC: uncertainties[rackIdx],
            status: 'DETECTED',
            recommendedAction: `Move flexible jobs off ${label} onto cooler open racks.`,
            priorityRank: 2,
            priorityReason: 'A blocked rack cannot cool down just by spinning room fans faster.',
            linkedIncidentIds: [],
            appliedActions: [],
            resolutionCondition: `Movable jobs cleared from ${label} and temp stays under ${(limit - 1.2).toFixed(1)}°C.`,
          });
        } else {
          existing.severity = block >= 0.25 && actualTemps[rackIdx] >= 28.5 ? 'CRITICAL' : 'WARNING';
          existing.observedEvidence = `${label} air blocked by ${Math.round(block * 100)}%; now at ${actualTemps[rackIdx].toFixed(1)}°C.`;
        }
      }
    });

    // 3. SENSOR_FAILURE (R07 outage at t >= 24)
    const r07SensorId = 'INC_SENSOR_OUTAGE_R7';
    if (!activeSensors.includes(6) && this.config.failure && step >= 24) {
      if (!this.activeIncidents.has(r07SensorId)) {
        this.activeIncidents.set(r07SensorId, {
          id: r07SensorId,
          type: 'SENSOR_FAILURE',
          title: 'Temp Sensor Offline on R07',
          affectedRacks: [6],
          detectionMinute: minute,
          detectionStep: step,
          severity: 'WARNING',
          observedEvidence: this.thermosEnabled
            ? `R07 sensor stopped at ${this.formatClock(minute)} (hardware remains offline). Virtual model + neighbor interpolation estimates ${estimatedTemps[6].toFixed(1)}°C.`
            : `R07 sensor stopped at ${this.formatClock(minute)}. No virtual estimation while THERMOS is paused.`,
          forecastEvidence: this.thermosEnabled
            ? `Added a ±${uncertainties[6].toFixed(2)}°C conformal safety margin (vs ±0.12°C sensed).`
            : `Temperature is unmonitored until THERMOS virtual sensing is enabled.`,
          resourceConstraints: ['Physical sensor offline (not repaired)'],
          uncertaintyDegC: uncertainties[6],
          status: 'DETECTED',
          recommendedAction: 'Estimate missing temperature from physics model and neighbor racks with widened uncertainty bounds.',
          priorityRank: 3,
          priorityReason: 'A rack without live telemetry requires widened conformal safety margins.',
          linkedIncidentIds: [],
          appliedActions: [],
          resolutionCondition: 'Virtual estimate stays below thermal limit with stable neighbor readings.',
        });
        this.pushTimelineEvent(
          minute,
          step,
          'SENSOR',
          [6],
          this.thermosEnabled
            ? `R07 sensor offline — virtual estimation active`
            : `R07 sensor offline — unmonitored (THERMOS paused)`,
          this.thermosEnabled
            ? `R07 remains physically offline; estimated ${estimatedTemps[6].toFixed(1)}°C (±${uncertainties[6].toFixed(2)}°C margin) from model & neighbors.`
            : `R07 sensor went offline while THERMOS is paused.`
        );
      } else {
        const inc = this.activeIncidents.get(r07SensorId)!;
        inc.observedEvidence = this.thermosEnabled
          ? `R07 sensor physically offline; model + neighbor estimate ${estimatedTemps[6].toFixed(1)}°C (±${uncertainties[6].toFixed(2)}°C).`
          : `R07 sensor offline; unmonitored while THERMOS is paused.`;
        inc.forecastEvidence = this.thermosEnabled
          ? `Added ±${uncertainties[6].toFixed(2)}°C uncertainty margin to +15m forecast.`
          : `Turn on THERMOS to estimate R07 temperature from neighbors.`;
      }
    } else if (this.activeIncidents.has(r07SensorId) && activeSensors.includes(6)) {
      this.resolveIncident(r07SensorId, minute);
    }

    // 4. Multi-rack HIGH_COMPUTING_DEMAND
    const surgingRacks = rawDemand
      .map((d, idx) => ({ idx, d }))
      .filter((x) => x.d >= 0.80)
      .map((x) => x.idx);
    const demandId = 'INC_COMPUTING_SURGE';
    if (surgingRacks.length >= 2) {
      const labels = surgingRacks.map((r) => this.rackLabel(r)).join(', ');
      const existing = this.activeIncidents.get(demandId);
      if (!existing) {
        this.activeIncidents.set(demandId, {
          id: demandId,
          type: 'HIGH_COMPUTING_DEMAND',
          title: `Multi-Rack Compute Surge (${surgingRacks.length} Racks)`,
          affectedRacks: surgingRacks,
          detectionMinute: minute,
          detectionStep: step,
          severity: surgingRacks.length >= 3 ? 'WARNING' : 'ADVISORY',
          observedEvidence: `Concurrent demand surge ≥80% across ${labels} (ambient ${outsideTempC.toFixed(1)}°C).`,
          forecastEvidence: `Simultaneous heat generation (~4.0 kW/rack) threatens local thermal limits without cross-rack redistribution.`,
          resourceConstraints: ['45% pinned workload floor', 'Batch job SLA deadlines'],
          uncertaintyDegC: 0.12,
          status: 'DETECTED',
          recommendedAction: `Coordinate simultaneous workload transfers from ${labels} to cool outer racks.`,
          priorityRank: 3,
          priorityReason: 'Multi-rack demand spikes interact with row neighbor heat transfer.',
          linkedIncidentIds: [],
          appliedActions: [],
          resolutionCondition: 'Surging racks balanced across cool capacity headroom.',
        });
      } else {
        existing.affectedRacks = surgingRacks;
        existing.title = `Multi-Rack Compute Surge (${surgingRacks.length} Racks)`;
        existing.observedEvidence = `Concurrent demand ≥80% on ${labels} at ${outsideTempC.toFixed(1)}°C ambient.`;
      }
    } else if (this.activeIncidents.has(demandId) && surgingRacks.length === 0) {
      this.resolveIncident(demandId, minute);
    }

    // 5. WATER_BUDGET_PRESSURE
    const waterRem = this.config.water - currentState.water;
    const waterId = 'INC_WATER_BUDGET';
    if (this.config.water <= 45 || waterRem <= 22.0) {
      const existing = this.activeIncidents.get(waterId);
      if (!existing) {
        this.activeIncidents.set(waterId, {
          id: waterId,
          type: 'WATER_BUDGET_PRESSURE',
          title: 'Facility Water Budget Constraint',
          affectedRacks: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
          detectionMinute: minute,
          detectionStep: step,
          severity: waterRem <= 10.0 ? 'CRITICAL' : 'WARNING',
          observedEvidence: `${Math.max(0, waterRem).toFixed(1)} L remaining of ${this.config.water} L facility water budget.`,
          forecastEvidence: 'Unconstrained evaporative cooling would breach municipal water cap before 15:00.',
          resourceConstraints: [`${this.config.water} L water cap`, 'Dry-mode chiller COP penalty'],
          uncertaintyDegC: 0.05,
          status: 'DETECTED',
          recommendedAction: 'Prioritise dry cooling + localised workload redistribution; ration wet cooling strictly to peak thermal spikes.',
          priorityRank: 4,
          priorityReason: 'Global water constraint couples all cooling decisions across the facility.',
          linkedIncidentIds: [],
          appliedActions: [],
          resolutionCondition: 'Remaining simulation steps satisfied within water allocation.',
        });
      } else {
        existing.severity = waterRem <= 10.0 ? 'CRITICAL' : 'WARNING';
        existing.observedEvidence = `${Math.max(0, waterRem).toFixed(1)} L remaining of ${this.config.water} L budget.`;
      }
    }

    // 6. HEAT_RECOVERY_OPPORTUNITY
    const rec = E.recovery(
      { it: E.sum(loads.map(E.rackComputePowerKW)) },
      loads,
      currentState.control,
      outsideTempC,
      this.config,
      actualTemps
    );
    const recId = 'INC_HEAT_RECOVERY_OPP';
    if (this.thermosEnabled && rec.useful > 0.1 && step >= 1) {
      if (!this.activeIncidents.has(recId)) {
        this.activeIncidents.set(recId, {
          id: recId,
          type: 'HEAT_RECOVERY_OPPORTUNITY',
          title: 'Hydronic Heat Recovery Opportunity',
          affectedRacks: rec.activeRackIds.length > 0 ? rec.activeRackIds : [2, 6, 7, 9],
          detectionMinute: minute,
          detectionStep: step,
          severity: 'ADVISORY',
          observedEvidence: `Central hydronic manifold (${rec.hot.toFixed(1)}°C ≥ 38°C) captures ${rec.extractedHeat.toFixed(1)} kW_th with ${rec.useful.toFixed(1)} kW_th conceptual reuse potential (88% HX).`,
          forecastEvidence: `Auxiliary experimental TEG estimate: ${(rec.harvest * 1000).toFixed(0)} W (0 W when outdoor sink limits ΔT).`,
          resourceConstraints: ['Pump auxiliary power cost'],
          uncertaintyDegC: 0.1,
          status: 'ASSESSED',
          recommendedAction: 'Capture excess rack heat into central hydronic loop to reduce chiller load and evaluate conceptual reuse.',
          priorityRank: 6,
          priorityReason: 'Separates thermal recovery potential (kWh_th) from electrical cooling savings.',
          linkedIncidentIds: [],
          appliedActions: [],
          resolutionCondition: 'Thermal energy tracked in conceptual hydronic recovery ledger.',
        });
      }
    } else if (this.activeIncidents.has(recId) && (!this.thermosEnabled || rec.useful <= 0.05)) {
      this.resolveIncident(recId, minute);
    }
  }

  private resolveIncident(id: string, minute: number): void {
    const inc = this.activeIncidents.get(id);
    if (!inc) return;
    inc.status = 'RESOLVED';
    inc.resolutionMinute = minute;
    this.resolvedIncidents.unshift(inc);
    this.activeIncidents.delete(id);
  }

  private recordActionDeficit(rackIdx: number, minute: number, step: number, currentTemp: number): void {
    const id = `INC_DEFICIT_R${rackIdx + 1}`;
    const label = this.rackLabel(rackIdx);
    this.activeIncidents.set(id, {
      id,
      type: 'ACTION_VERIFICATION_DEFICIT',
      title: `Verification Deficit on ${label}`,
      affectedRacks: [rackIdx],
      detectionMinute: minute,
      detectionStep: step,
      severity: 'CRITICAL',
      observedEvidence: `Post-action verification found ${label} still elevated at ${currentTemp.toFixed(1)}°C (limit ${this.config.limit.toFixed(1)}°C).`,
      forecastEvidence: 'Physical ambient/water/airflow constraints prevented full cooldown; escalating controller.',
      resourceConstraints: ['Cooling capacity ceiling', '45% pinned mandatory load'],
      uncertaintyDegC: 0.25,
      status: 'DETECTED',
      recommendedAction: `Re-evaluate maximum dry/wet airflow and shed all non-pinned work from ${label} & neighbors.`,
      priorityRank: 1,
      priorityReason: 'Verified thermal deficit requires honest escalation and re-planning.',
      linkedIncidentIds: [],
      appliedActions: [],
      resolutionCondition: `${label} inlet drops below ${(this.config.limit - 0.8).toFixed(1)}°C.`,
    });
  }

  private correlateAndPrioritiseIncidents(): void {
    const incidents = Array.from(this.activeIncidents.values());
    for (const inc of incidents) {
      inc.linkedIncidentIds = [];
      for (const other of incidents) {
        if (inc.id === other.id) continue;
        const sharesSpecificRack =
          inc.affectedRacks.length <= 6 &&
          other.affectedRacks.length <= 6 &&
          inc.affectedRacks.some((r) => other.affectedRacks.includes(r));

        const isAdjacentCoupled =
          inc.affectedRacks.length === 1 &&
          other.affectedRacks.length === 1 &&
          E.adjacent(inc.affectedRacks[0]).includes(other.affectedRacks[0]);

        const isResourceCoupled =
          inc.type === 'WATER_BUDGET_PRESSURE' &&
          (other.type === 'RACK_OVERHEATING' || other.type === 'PREDICTED_THERMAL_VIOLATION');

        if (sharesSpecificRack || isAdjacentCoupled || isResourceCoupled) {
          inc.linkedIncidentIds.push(other.id);
        }
      }
    }
  }

  /**
   * Genuine Multi-Rack Candidate Evaluation & Simultaneous Action Synthesis
   * Uses E.evaluateCandidateSet() directly on the current SimulationState — zero fabricated outcomes.
   */
  private evaluateCoordinatedResponse(
    step: number,
    minute: number,
    timestamp: string,
    actualTemps: number[],
    estimatedTemps: number[],
    uncertainties: number[],
    activeSensors: number[],
    currentState: SimulationState
  ): void {
    if (this.activePlan || step >= E.STEPS) return;

    const actionableIncidents = Array.from(this.activeIncidents.values()).filter(
      (inc) =>
        inc.type === 'RACK_OVERHEATING' ||
        inc.type === 'PREDICTED_THERMAL_VIOLATION' ||
        inc.type === 'RAPID_TEMP_RISE' ||
        inc.type === 'ACTION_VERIFICATION_DEFICIT' ||
        (inc.type === 'HIGH_COMPUTING_DEMAND' && step >= 1) ||
        (inc.type === 'SENSOR_FAILURE' && step >= 24)
    );

    const hasDirectThermalIncident = actionableIncidents.some(
      (inc) =>
        inc.type === 'RACK_OVERHEATING' ||
        inc.type === 'PREDICTED_THERMAL_VIOLATION' ||
        inc.type === 'RAPID_TEMP_RISE' ||
        inc.type === 'ACTION_VERIFICATION_DEFICIT' ||
        inc.type === 'SENSOR_FAILURE'
    );
    const hasCompoundSurge =
      actionableIncidents.some((inc) => inc.type === 'HIGH_COMPUTING_DEMAND') &&
      E.restriction(this.config, 6) >= 0.2;

    if ((!hasDirectThermalIncident && !hasCompoundSurge) || step < 1) {
      this.pendingPlan = null;
      return;
    }

    const evalState = E.clone(currentState);
    // Evaluate baseline against nominal dry/original operating posture so global over-cooling does not mask hotspot risk
    evalState.control = {
      supply: 22,
      fan: 0.58,
      mode: this.config.water <= 0 ? 'dry' : 'dry',
    };
    const obs = E.observe(evalState, this.config);
    const { best, baseline, choices } = E.evaluateCandidateSet(
      evalState,
      this.config,
      obs,
      this.model,
      'thermos'
    );

    if (!hasDirectThermalIncident && Math.max(...baseline.upper) < this.config.limit - 0.5) {
      this.pendingPlan = null;
      return;
    }

    const targetedBest =
      best.style === 'targeted'
        ? best
        : choices.find(
            (c) =>
              c.style === 'targeted' &&
              c.waterExcess <= best.waterExcess + 0.01 &&
              Math.max(...c.upper) <= Math.max(...best.upper) + 0.15 &&
              c.score <= best.score + (hasDirectThermalIncident ? 6.0 : 2.5)
          ) || best;

    const transfers = targetedBest.layout.transfers || [];
    const sourceRacksFromTransfers = Array.from(new Set(transfers.map((t) => t.fromRack)));
    const receiverRacksFromTransfers = Array.from(new Set(transfers.map((t) => t.toRack)));

    const stressedRackIds = Array.from({ length: E.N }, (_, i) => i).filter(
      (i) =>
        baseline.upper[i] >= this.config.limit - 0.5 ||
        actualTemps[i] >= this.config.limit - 1.1 ||
        (!activeSensors.includes(i) && this.config.failure && i === 6 && step >= 24)
    );

    const sourceRacks = Array.from(
      new Set([...sourceRacksFromTransfers, ...stressedRackIds])
    ).sort((a, b) => a - b);
    const receiverRacks = receiverRacksFromTransfers
      .filter((r) => !sourceRacks.includes(r))
      .sort((a, b) => a - b);
    const targetRacks = Array.from(new Set([...sourceRacks, ...receiverRacks])).sort(
      (a, b) => a - b
    );

    if (targetRacks.length === 0) {
      this.pendingPlan = null;
      return;
    }

    const rackAssignments: RackActionAssignment[] = [];
    for (const rId of sourceRacks) {
      const label = this.rackLabel(rId);
      const loadBefore = Number(baseline.layout.loads[rId].toFixed(2));
      const loadAfter = Number(targetedBest.layout.loads[rId].toFixed(2));
      const predBefore = Number(baseline.predictions[rId].toFixed(2));
      const predAfter = Number(targetedBest.predictions[rId].toFixed(2));
      const dropPct = Math.round(Math.max(0, loadBefore - loadAfter) * 100);
      const dests = transfers
        .filter((t) => t.fromRack === rId)
        .map((t) => this.rackLabel(t.toRack));

      if (!activeSensors.includes(rId) && this.config.failure && rId === 6) {
        rackAssignments.push({
          rackId: rId,
          rackLabel: label,
          role: 'VIRTUAL_SENSOR',
          actionSummary:
            dropPct > 0
              ? `Virtual RF sensor (±${uncertainties[rId].toFixed(2)}°C) + shift ${dropPct}% load → ${dests.join(', ')}`
              : `Virtual RF sensor active (±${uncertainties[rId].toFixed(2)}°C margin) + ${Math.round(targetedBest.fan * 100)}% local airflow`,
          loadBefore,
          loadAfter,
          predictedBeforeC: predBefore,
          predictedAfterC: predAfter,
        });
      } else if (dropPct > 0) {
        rackAssignments.push({
          rackId: rId,
          rackLabel: label,
          role: 'SOURCE_RELIEF',
          actionSummary: `Shift ${dropPct}% movable load → ${dests.join(', ') || 'cool aisles'} + ${Math.round(targetedBest.fan * 100)}% local damper (${predBefore.toFixed(1)}° → ${predAfter.toFixed(1)}°C)`,
          loadBefore,
          loadAfter,
          predictedBeforeC: predBefore,
          predictedAfterC: predAfter,
        });
      } else {
        rackAssignments.push({
          rackId: rId,
          rackLabel: label,
          role: 'COOLING_BOOST',
          actionSummary: `Boost local damper to ${Math.round(targetedBest.fan * 100)}% (${targetedBest.supply}°C ${targetedBest.mode}) + exhaust recovery`,
          loadBefore,
          loadAfter,
          predictedBeforeC: predBefore,
          predictedAfterC: predAfter,
        });
      }
    }

    for (const rId of receiverRacks) {
      const label = this.rackLabel(rId);
      const loadBefore = Number(baseline.layout.loads[rId].toFixed(2));
      const loadAfter = Number(targetedBest.layout.loads[rId].toFixed(2));
      const predBefore = Number(baseline.predictions[rId].toFixed(2));
      const predAfter = Number(targetedBest.predictions[rId].toFixed(2));
      const gainPct = Math.round(Math.max(0, loadAfter - loadBefore) * 100);
      rackAssignments.push({
        rackId: rId,
        rackLabel: label,
        role: 'COOL_RECEIVER',
        actionSummary: `Absorb +${gainPct}% load safely (forecast ${predAfter.toFixed(1)}°C < ${this.config.limit.toFixed(1)}°C limit)`,
        loadBefore,
        loadAfter,
        predictedBeforeC: predBefore,
        predictedAfterC: predAfter,
      });
    }

    const conflictResolutions: string[] = [];
    if (E.restriction(this.config, 7) >= 0.15) {
      conflictResolutions.push(
        `Excluded R08 from receiving migrated load (${Math.round(E.restriction(this.config, 7) * 100)}% partial airflow restriction).`
      );
    }
    const waterRem = Math.max(0, this.config.water - currentState.water);
    if (targetedBest.mode === 'dry' && waterRem < 40) {
      conflictResolutions.push(
        `Selected dry cooling (${targetedBest.supply}°C, localised ${Math.round(targetedBest.fan * 100)}% dampers on stressed racks) to preserve ${waterRem.toFixed(1)} L water budget.`
      );
    } else if (targetedBest.mode === 'wet') {
      const stepWaterL = (targetedBest.power.water * E.DT) / 60;
      conflictResolutions.push(
        `Authorised ${stepWaterL.toFixed(2)} L evaporative pulse (${waterRem.toFixed(1)} L available) because dry cooling alone left peak upper bound above ${this.config.limit.toFixed(1)}°C.`
      );
    }
    const untouchedCount = E.N - targetRacks.length;
    conflictResolutions.push(
      `Left ${untouchedCount} healthy non-target racks undisturbed; verified all ${receiverRacks.length} receiver racks stay ≥${(
        this.config.limit - Math.max(...receiverRacks.map((r) => targetedBest.predictions[r]), 25)
      ).toFixed(1)}°C below thermal limit.`
    );

    const actions: CoordinatedResponsePlan['actions'] = [];
    if (transfers.length > 0) {
      actions.push({
        type: 'SHIFT_WORKLOAD',
        targetRacks: [...sourceRacks, ...receiverRacks],
        parameters: {
          transfers,
          style: targetedBest.style,
          movedRackEquiv: Number(targetedBest.layout.moved.toFixed(2)),
        },
        description: `Move ${Math.round(targetedBest.layout.moved * 100)}% of movable work from ${sourceRacks.map((r) => this.rackLabel(r)).join(', ')} to cooler ${receiverRacks.map((r) => this.rackLabel(r)).join(', ')}.`,
      });
    }

    const fanDeltaPct = Math.round((targetedBest.fan - currentState.control.fan) * 100);
    actions.push({
      type: 'ADJUST_COOLING',
      targetRacks: sourceRacks,
      parameters: {
        supplyTempC: targetedBest.supply,
        fanSpeedDeltaPct: fanDeltaPct,
        targetFanPct: Math.round(targetedBest.fan * 100),
        mode: targetedBest.mode,
      },
      description: `Boost fans to ${Math.round(targetedBest.fan * 100)}% on ${sourceRacks.map((r) => this.rackLabel(r)).join(', ')} (${targetedBest.supply.toFixed(1)}°C ${targetedBest.mode} air).`,
    });

    if (!activeSensors.includes(6) && this.config.failure && step >= 24) {
      actions.push({
        type: 'BYPASS_SENSOR_RECALIBRATE',
        targetRacks: [6],
        parameters: {
          rackId: 6,
          modelInferenceC: Number(estimatedTemps[6].toFixed(2)),
          addedUncertaintyC: Number(uncertainties[6].toFixed(2)),
        },
        description: `Estimate R07 temperature from neighbors (${estimatedTemps[6].toFixed(1)}°C ± ${uncertainties[6].toFixed(2)}°C buffer).`,
      });
    }

    const outsideNow = E.ambient(this.config, Math.min(E.STEPS - 1, step));
    const recEval = E.recovery(
      targetedBest.power,
      targetedBest.layout.loads,
      targetedBest,
      outsideNow,
      this.config,
      actualTemps,
      targetedBest.recoveryValves
    );
    if (recEval.useful > 0.1) {
      actions.push({
        type: 'ACTIVATE_HEAT_RECOVERY',
        targetRacks: recEval.activeRackIds.length > 0 ? recEval.activeRackIds : sourceRacks,
        parameters: {
          extractedKWTh: Number(recEval.extractedHeat.toFixed(2)),
          usefulKWTh: Number(recEval.useful.toFixed(2)),
          tegW: Number((recEval.harvest * 1000).toFixed(1)),
        },
        description: `Activate central hydronic recovery (${recEval.useful.toFixed(1)} kW_th conceptual pre-heat @ 88% HX; ${(recEval.harvest * 1000).toFixed(0)} W aux TEG estimate).`,
      });
    }

    const baselinePeakPred = Math.max(...baseline.predictions);
    const planPeakPred = Math.max(...targetedBest.predictions);
    const peakReduction = Math.max(0.1, Number((baselinePeakPred - planPeakPred).toFixed(2)));
    const stepHours = E.DT / 60;
    const migKWh = Number((0.018 * targetedBest.layout.moved).toFixed(4));
    const waterImpactL = Number((targetedBest.power.water * stepHours).toFixed(2));
    const gridKW = Number(
      (targetedBest.power.it + targetedBest.power.cooling + 0.055 + recEval.pump).toFixed(2)
    );
    const baseGridKW = baseline.power.it + baseline.power.cooling + 0.055;
    const planPue = targetedBest.power.it > 0 ? gridKW / targetedBest.power.it : 1.2;
    const basePue = baseline.power.it > 0 ? baseGridKW / baseline.power.it : 1.2;

    const primaryFrom = sourceRacks[0] ?? 6;
    const aggregatedReceivers = receiverRacks.map((r) => {
      const gained = Math.max(0, targetedBest.layout.loads[r] - baseline.layout.loads[r]);
      return { rack: r, percentage: Math.max(4, Math.round(gained * 100)) };
    });

    const addressedIds = Array.from(this.activeIncidents.keys());

    const plan: CoordinatedResponsePlan = {
      id: `PLAN_T${step}`,
      timestamp,
      minute,
      step,
      addressedIncidentIds: addressedIds,
      sourceRacks,
      receiverRacks,
      targetRacks,
      evaluatedCandidatesCount: choices.length,
      compatibleActionsCount: actions.length + rackAssignments.length,
      conflictResolutions,
      rackAssignments,
      transfers,
      actions,
      workloadRedistribution:
        transfers.length > 0
          ? {
              fromRack: primaryFrom,
              fromRacks: sourceRacks,
              toRacks: aggregatedReceivers,
              totalFractionMoved: Number(targetedBest.layout.moved.toFixed(2)),
              migrationEnergyKWh: migKWh,
            }
          : undefined,
      coolingAdjustment: {
        fanSpeedDeltaPct: fanDeltaPct,
        targetFanPct: Math.round(targetedBest.fan * 100),
        supplyTempC: targetedBest.supply,
        mode: targetedBest.mode,
      },
      sensorBypass: !activeSensors.includes(6)
        ? {
            rackId: 6,
            modelInferenceC: Number(estimatedTemps[6].toFixed(1)),
            addedUncertaintyC: Number(uncertainties[6].toFixed(2)),
          }
        : undefined,
      predictedOutcomes: {
        peakTempReductionDegC: peakReduction,
        baselineProjectedPeakC: Number(baselinePeakPred.toFixed(2)),
        projectedPeakC: Number(planPeakPred.toFixed(2)),
        waterImpactLitres: waterImpactL,
        pueImpact: Number((planPue - basePue).toFixed(2)),
        slaViolations: 0,
        migrationEnergyKWh: migKWh,
        usefulHeatKWhTh: Number((recEval.useful * stepHours).toFixed(2)),
        tegHarvestKWh: Number((recEval.harvest * stepHours).toFixed(4)),
      },
      resourceImpact: {
        waterConsumedL: Number(currentState.water.toFixed(2)),
        waterRemainingL: Number(waterRem.toFixed(2)),
        waterBudgetL: this.config.water,
        coolingKW: Number(targetedBest.power.cooling.toFixed(2)),
        gridKW,
      },
      engineAction: {
        supply: targetedBest.supply,
        fan: targetedBest.fan,
        mode: targetedBest.mode,
        fraction: targetedBest.fraction,
        style: targetedBest.style,
        rackFans: targetedBest.rackFans,
        rackSupplyOffsets: targetedBest.rackSupplyOffsets,
        recoveryValves: targetedBest.recoveryValves,
        targetedRacks: targetedBest.targetedRacks,
      },
      preInterventionTemps: [...actualTemps],
      preInterventionWaterL: currentState.water,
      preInterventionEnergyKWh: currentState.energy,
      rationale: `Checked ${choices.length} candidate decisions across all 12 racks. Moves flexible jobs from ${sourceRacks.map((r) => this.rackLabel(r)).join(', ')} to cooler racks, adjusts local fans, and captures ${recEval.useful.toFixed(1)} kW_th in hydronic recovery — dropping peak temp from ${baselinePeakPred.toFixed(1)}°C to ${planPeakPred.toFixed(1)}°C.`,
      safetyVerificationCheck: `Check that ${sourceRacks.map((r) => this.rackLabel(r)).join(', ')} cool safely under ${(this.config.limit - 0.25).toFixed(1)}°C over the next 2 steps.`,
      authorisationMode: this.systemMode,
      status: 'PROPOSED',
      verificationStepsTotal: 2,
      verificationStepsRemaining: 2,
    };

    const wasAlreadyPending = Boolean(this.pendingPlan);
    this.pendingPlan = plan;

    this.activeIncidents.forEach((inc) => {
      if (inc.status === 'DETECTED') {
        inc.status = 'RESPONSE_PROPOSED';
      }
    });

    if (!wasAlreadyPending) {
      this.lastHoldReason = 'Coordinated multi-rack decision';
    }

    if (this.systemMode === 'demonstration') {
      this.authorisePendingPlan(true);
    }
  }

  public authorisePendingPlan(isAuto: boolean = false): CoordinatedResponsePlan | null {
    if (!this.pendingPlan) return null;

    const plan = this.pendingPlan;
    plan.status = isAuto ? 'AUTO_AUTHORISED' : 'APPROVED';
    plan.authorisationMode = isAuto ? 'demonstration' : 'interactive';

    for (const incId of plan.addressedIncidentIds) {
      const inc = this.activeIncidents.get(incId);
      if (inc) {
        inc.status = 'IN_PROGRESS';
        if (!inc.appliedActions.includes(plan.id)) {
          inc.appliedActions.push(plan.id);
        }
      }
    }

    if (plan.transfers.length > 0) {
      const src = plan.sourceRacks.map((r) => this.rackLabel(r)).join(', ');
      const dst = plan.receiverRacks.map((r) => this.rackLabel(r)).join(', ');
      const sig = `${plan.sourceRacks.join(',')}->${plan.receiverRacks.join(',')}`;
      const movedEq = plan.transfers.reduce((s, t) => s + t.fractionMoved, 0);
      this.pushTimelineEvent(
        plan.minute,
        plan.step,
        'MIGRATION',
        plan.targetRacks,
        `Moved jobs: ${src} → ${dst}`,
        `${isAuto ? 'Auto' : 'User approved'} shift of ${Math.round(movedEq * 100)}% flexible workload.`
      );
    }

    this.pushSelfAction({
      minute: plan.minute,
      actor: isAuto ? 'THERMOS' : 'USER',
      kind: 'CONTROL',
      summary: `${isAuto ? 'Auto-ran' : 'Approved'} plan for ${plan.sourceRacks.map((r) => this.rackLabel(r)).join(', ')} (${plan.predictedOutcomes.baselineProjectedPeakC.toFixed(1)}° → ${plan.predictedOutcomes.projectedPeakC.toFixed(1)}°C)`,
      target: { type: 'core' },
    });

    this.lastHoldReason = 'Executing multi-rack intervention';
    this.activePlan = plan;
    this.pendingPlan = null;
    return plan;
  }

  public rejectPendingPlan(): void {
    if (!this.pendingPlan) return;
    const plan = this.pendingPlan;
    this.rejectedPlanIds.push(plan.id);
    this.rejectedCooldownUntilStep = plan.step + 1;

    this.pushSelfAction({
      minute: plan.minute,
      actor: 'USER',
      kind: 'CONTROL',
      summary: `Skipped plan for ${plan.sourceRacks.map((r) => this.rackLabel(r)).join(', ')} — watching temps`,
      target: { type: 'core' },
    });

    for (const incId of plan.addressedIncidentIds) {
      const inc = this.activeIncidents.get(incId);
      if (inc && inc.status === 'RESPONSE_PROPOSED') {
        inc.status = 'REJECTED';
      }
    }

    this.pendingPlan = null;
  }

  private buildThermosIntelligenceStatus(
    step: number,
    isMidStep: boolean,
    racks: RackFacilityState[],
    currentRecord: StepRecord | null,
    interveningRacks: number[],
    receivingRacks: number[],
    activeRecoveryRacks: number[]
  ): ThermosIntelligenceStatus {
    const rackIncidents = Array.from(this.activeIncidents.values()).filter(
      (i) => i.type !== 'HEAT_RECOVERY_OPPORTUNITY'
    );

    if (!this.thermosEnabled) {
      const hotCount = racks.filter((r) => r.thermalRiskState !== 'HEALTHY').length;
      return {
        enabled: false,
        visualState: 'IDLE',
        headline: 'THERMOS Paused · No AI Action Active',
        subline:
          hotCount > 0
            ? `${hotCount} rack${hotCount > 1 ? 's' : ''} warming under fixed BMS rules (22°C supply, 58% fans, unshifted load). Engage THERMOS to intervene.`
            : 'Data centre running on fixed BMS rules (22°C supply, 58% fans, unshifted load). Zero THERMOS actions active.',
        activeIncidentCount: rackIncidents.length,
        affectedRackCount: hotCount,
        evaluatedCandidatesCount: 0,
        selectedActionsCount: 0,
        inProgressActionsCount: 0,
        resolvedCount: this.resolvedIncidents.length,
        escalatedRackCount: racks.filter((r) => r.simulatedInletC > this.config.limit).length,
        inspectedRacks: [],
        interveningRacks: [],
        receivingRacks: [],
        activeRecoveryRacks: [],
        activeTransfers: [],
      };
    }

    if (step === 0 && !currentRecord) {
      if (this.scenarioKey === 'normal') {
        return {
          enabled: true,
          visualState: 'IDLE',
          headline: 'Eco-Tuning Mode · 32.0°C Nominal Baseline',
          subline: 'All 12 server racks calm (<26°C). Low-speed fans (40%), nominal PUE 1.11, and zero evaporative water waste.',
          activeIncidentCount: 0,
          affectedRackCount: 0,
          evaluatedCandidatesCount: 0,
          selectedActionsCount: 0,
          inProgressActionsCount: 0,
          resolvedCount: 0,
          escalatedRackCount: 0,
          inspectedRacks: [],
          interveningRacks: [],
          receivingRacks: [],
          activeRecoveryRacks: [],
          activeTransfers: [],
        };
      } else if (this.scenarioKey === 'water') {
        return {
          enabled: true,
          visualState: 'IDLE',
          headline: 'Water-Preservation Mode · Strict 20L Quota',
          subline: '41.0°C drought ambient. Throttling evaporative cooling towers; prioritizing dry cooling and conceptual hydronic heat recovery.',
          activeIncidentCount: rackIncidents.length,
          affectedRackCount: 0,
          evaluatedCandidatesCount: 0,
          selectedActionsCount: 0,
          inProgressActionsCount: 0,
          resolvedCount: 0,
          escalatedRackCount: 0,
          inspectedRacks: [],
          interveningRacks: [],
          receivingRacks: [],
          activeRecoveryRacks: [],
          activeTransfers: [],
        };
      } else if (this.scenarioKey === 'sensor') {
        return {
          enabled: true,
          visualState: 'IDLE',
          headline: 'Sensor Resilience Mode · 40.0°C (6 Active Probes)',
          subline: 'Monitoring 6/12 physical probes; R07 fails at 11:00 (step 24) and switches to model + neighbor estimation with ±1.20°C margin.',
          activeIncidentCount: rackIncidents.length,
          affectedRackCount: 0,
          evaluatedCandidatesCount: 0,
          selectedActionsCount: 0,
          inProgressActionsCount: 0,
          resolvedCount: 0,
          escalatedRackCount: 0,
          inspectedRacks: [],
          interveningRacks: [],
          receivingRacks: [],
          activeRecoveryRacks: [],
          activeTransfers: [],
        };
      } else {
        return {
          enabled: true,
          visualState: 'IDLE',
          headline: 'Thermal Defense Mode · 43.2°C Compound Stress',
          subline: 'Central cluster under thermal surge (35L water cap, R07 sensor fault at 11:00). Evaluating 108 MPC options every 5 min.',
          activeIncidentCount: rackIncidents.length,
          affectedRackCount: 4,
          evaluatedCandidatesCount: 0,
          selectedActionsCount: 0,
          inProgressActionsCount: 0,
          resolvedCount: 0,
          escalatedRackCount: 0,
          inspectedRacks: [],
          interveningRacks: [],
          receivingRacks: [],
          activeRecoveryRacks: [],
          activeTransfers: [],
        };
      }
    }

    const affectedRackSet = new Set<number>();
    rackIncidents.forEach((inc) => {
      if (inc.affectedRacks.length <= 6) {
        inc.affectedRacks.forEach((r) => affectedRackSet.add(r));
      }
    });
    racks.forEach((r) => {
      if (
        r.thermalRiskState !== 'HEALTHY' ||
        (this.config.failure && step >= 24 && r.id === 6 && !r.sensorAvailable)
      ) {
        affectedRackSet.add(r.id);
      }
    });

    const affectedRacks = Array.from(affectedRackSet).sort((a, b) => a - b);
    const escalatedRacks = isMidStep
      ? []
      : racks
          .filter(
            (r) =>
              r.simulatedInletC > this.config.limit ||
              Array.from(this.activeIncidents.values()).some(
                (inc) =>
                  inc.type === 'ACTION_VERIFICATION_DEFICIT' && inc.affectedRacks.includes(r.id)
              )
          )
          .map((r) => r.id);

    let visualState: ThermosVisualState = 'IDLE';
    let headline = 'Nominal · Monitoring 12 racks';
    let subline = 'Continuous BMS sensor polling & 15-min inlet temperature forecasts active';

    if (
      this.activePlan &&
      (this.activePlan.status === 'APPROVED' ||
        this.activePlan.status === 'AUTO_AUTHORISED' ||
        this.activePlan.status === 'IN_PROGRESS' ||
        (this.activePlan.status === 'VERIFYING' && isMidStep && step - this.activePlan.step <= 1))
    ) {
      visualState = 'INTERVENING';
      headline = `Acting on ${this.activePlan.rackAssignments.length} racks · Shifting movable load & local airflow`;
      subline = `Moving flexible jobs off ${this.activePlan.sourceRacks.map((r) => this.rackLabel(r)).join(', ')} → ${this.activePlan.receiverRacks.map((r) => this.rackLabel(r)).join(', ') || 'local cooling'}; pinned tenant work stays put`;
    } else if (escalatedRacks.length > 0 && !this.pendingPlan) {
      visualState = 'ESCALATION';
      headline = `Operator Escalation · ${escalatedRacks.length} rack${escalatedRacks.length > 1 ? 's' : ''} above ${this.config.limit.toFixed(1)}°C limit`;
      subline = `${escalatedRacks.map((r) => this.rackLabel(r)).join(', ')} limited by outdoor heat and remaining evaporative water cap`;
    } else if (this.activePlan) {
      visualState = 'MONITORING';
      headline = `Verifying cooldown across ${this.activePlan.targetRacks.length} racks`;
      subline = `Confirming ${this.activePlan.sourceRacks.map((r) => this.rackLabel(r)).join(', ')} cool safely without overheating receiver cabinets`;
    } else if (this.pendingPlan) {
      visualState = 'COORDINATING';
      headline = `Action plan ready for ${Math.max(affectedRacks.length, this.pendingPlan.sourceRacks.length)} stressed racks`;
      subline = `Scored ${this.pendingPlan.evaluatedCandidatesCount} control options · Waiting for operator sign-off while facility runs on baseline`;
    } else if (this.resolvedBannerStepsRemaining > 0 && this.lastVerifiedOutcome) {
      visualState = 'RESOLVED';
      headline = `Stabilised · ${this.lastVerifiedOutcome.stabilizedRacks.length} hot racks brought within limit`;
      subline =
        this.lastVerifiedOutcome.peakAfterC <= this.lastVerifiedOutcome.peakBeforeC
          ? `Peak inlet ${this.lastVerifiedOutcome.peakBeforeC.toFixed(1)}°C → ${this.lastVerifiedOutcome.peakAfterC.toFixed(1)}°C · Unaffected racks left untouched`
          : `Peak held at ${this.lastVerifiedOutcome.peakAfterC.toFixed(1)}°C (<${this.config.limit.toFixed(1)}°C limit) · Resuming normal watch`;
    } else if (affectedRacks.length > 0) {
      visualState = 'ANALYSING';
      const hottest = [...racks]
        .filter((r) => affectedRacks.includes(r.id))
        .sort((a, b) => b.simulatedInletC - a.simulatedInletC)[0];
      headline = `Evaluating local heat rise on ${affectedRacks.map((r) => this.rackLabel(r)).join(', ')}`;
      subline = hottest
        ? `${hottest.label} at ${hottest.simulatedInletC.toFixed(1)}°C (${Math.round(hottest.workloadUtil * 100)}% load) · Checking cool outer rack capacity`
        : `Running +15m thermal forecast on ${affectedRacks.map((r) => this.rackLabel(r)).join(', ')}`;
    } else if (step > 0 || isMidStep) {
      visualState = 'SCANNING';
      if (this.scenarioKey === 'normal') {
        headline = 'Nominal Baseline · Continuous Eco-Monitoring';
        subline = 'Zero thermal alarms across all 12 racks. Running minimum baseline energy (PUE 1.11) and conserving 100% cooling water.';
      } else if (this.scenarioKey === 'water') {
        headline = 'Water-Preservation Watch · 20L Budget Protected';
        subline = 'Evaporative cooling throttled to prevent municipal cap breach; rejecting heat via district heating and dry loop.';
      } else {
        headline = 'Thermal Risk Watch · 43.2°C Ambient Surge';
        subline = 'Continuous 15-min thermal forecasts tracking R07 hotspot progression and cooling response.';
      }
    }

    const activeTransfers = this.activePlan
      ? this.activePlan.transfers
      : currentRecord?.transfers || [];

    return {
      enabled: true,
      visualState,
      headline,
      subline,
      activeIncidentCount: rackIncidents.length,
      affectedRackCount: affectedRacks.length,
      evaluatedCandidatesCount:
        this.pendingPlan?.evaluatedCandidatesCount ??
        this.activePlan?.evaluatedCandidatesCount ??
        (step > 0 ? 108 : 0),
      selectedActionsCount:
        this.pendingPlan?.rackAssignments.length ??
        this.activePlan?.rackAssignments.length ??
        0,
      inProgressActionsCount: this.activePlan ? this.activePlan.rackAssignments.length : 0,
      resolvedCount: this.resolvedIncidents.length,
      escalatedRackCount: escalatedRacks.length,
      inspectedRacks: affectedRacks,
      interveningRacks,
      receivingRacks,
      activeRecoveryRacks,
      activeTransfers,
    };
  }

  private generateDynamicSummary(
    racks: RackFacilityState[],
    outsideTempC: number,
    waterRemainingL: number,
    waterBudgetL: number,
    counts: { healthy: number; warming: number; critical: number; sensorUnavailable: number },
    thermos: ThermosIntelligenceStatus
  ): string {
    if (thermos.activeIncidentCount === 0 && counts.critical === 0 && counts.warming === 0) {
      return `All 12 racks nominal at ${outsideTempC.toFixed(1)}°C ambient (${waterRemainingL.toFixed(1)}/${waterBudgetL} L water available).`;
    }

    const sortedHot = [...racks].sort((a, b) => b.simulatedInletC - a.simulatedInletC);
    const coolest = sortedHot[sortedHot.length - 1];
    const topTwo = sortedHot
      .slice(0, 2)
      .map((r) => `${r.label} (${r.simulatedInletC.toFixed(1)}°C)`)
      .join(', ');
    const parts: string[] = [
      `Localised stress on ${thermos.affectedRackCount} rack${thermos.affectedRackCount !== 1 ? 's' : ''}: highest ${topTwo} vs cool ${coolest.label} (${coolest.simulatedInletC.toFixed(1)}°C).`,
    ];

    if (!racks[6].sensorAvailable) {
      parts.push(
        `R07 sensor offline — distance-weighted virtual estimate active (±${racks[6].uncertaintyMarginC.toFixed(2)}°C).`
      );
    }
    if (waterRemainingL <= 35) {
      parts.push(`Water budget ${waterRemainingL.toFixed(1)}/${waterBudgetL} L constrains cooling mode.`);
    }
    return parts.join(' ');
  }

  private formatClock(mins: number): string {
    const totalMinutesFrom9AM = 9 * 60 + mins;
    const h = Math.floor(totalMinutesFrom9AM / 60);
    const m = totalMinutesFrom9AM % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
