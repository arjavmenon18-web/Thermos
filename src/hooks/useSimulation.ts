import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as E from '../simulation/engine';
import { FacilityStateManager } from '../simulation/facilityManager';
import type {
  ThermosConfig,
  SimulationState,
  PresetKey,
  ControllerType,
  ForestModel,
  StepRecord,
  SystemMode,
  GlobalFacilityState,
  CoordinatedResponsePlan,
  WorkloadTransferEdge,
} from '../simulation/types';
import modelData from '../data/model.json';

const MODEL = modelData as unknown as ForestModel;

export interface AnimatedTransferPacket extends WorkloadTransferEdge {
  id: string;
  progress: number; // 0..1
}

export function useSimulation() {
  const [scenarioKey, setScenarioKey] = useState<PresetKey>('compound');
  const [config, setConfig] = useState<ThermosConfig>(() => E.config(E.presets.compound));
  const [activeController, setActiveController] = useState<ControllerType>('thermos');
  const [systemMode, setSystemModeState] = useState<SystemMode>('demonstration');
  const [thermosEnabled, setThermosEnabledState] = useState<boolean>(true);
  const [planRevision, setPlanRevision] = useState<number>(0);

  // Facility State Manager (Single Source of Truth)
  const managerRef = useRef<FacilityStateManager>(
    new FacilityStateManager(E.config(E.presets.compound), 'compound', MODEL, 'demonstration', true)
  );

  // Simulation states for all 4 strategies kept synchronized (THERMOS, Reactive, Physics, No-Intervention)
  const [states, setStates] = useState<{
    thermos: SimulationState;
    reactive: SimulationState;
    physics: SimulationState;
    none: SimulationState;
  }>(() => {
    const baseConf = E.config(E.presets.compound);
    const sThermos = E.initial(baseConf);
    sThermos.controller = 'thermos';
    const sReactive = E.initial(baseConf);
    sReactive.controller = 'reactive';
    const sPhysics = E.initial(baseConf);
    sPhysics.controller = 'physics';
    const sNone = E.initial(baseConf);
    sNone.controller = 'none';
    return {
      thermos: sThermos,
      reactive: sReactive,
      physics: sPhysics,
      none: sNone,
    };
  });

  const [cursor, setCursor] = useState<number>(-1);
  const [subMinuteIndex, setSubMinuteIndex] = useState<number>(E.DT - 1);
  // Digital-twin live facility clock runs continuously by default, representing a 24/7 live hall
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [speed, setSpeed] = useState<number>(1);
  const [isComputingFull, setIsComputingFull] = useState<boolean>(false);
  const [revealTruth, setRevealTruth] = useState<boolean>(false);
  const [selectedRackId, setSelectedRackId] = useState<number | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [activePackets, setActivePackets] = useState<AnimatedTransferPacket[]>([]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const approvalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const approvalIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearApprovalTimers = useCallback(() => {
    if (approvalTimerRef.current) {
      clearTimeout(approvalTimerRef.current);
      approvalTimerRef.current = null;
    }
    if (approvalIntervalRef.current) {
      clearInterval(approvalIntervalRef.current);
      approvalIntervalRef.current = null;
    }
  }, []);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (animRef.current) {
      clearInterval(animRef.current);
      animRef.current = null;
    }
    clearApprovalTimers();
  }, [clearApprovalTimers]);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  const setSystemMode = useCallback(
    (mode: SystemMode) => {
      setSystemModeState(mode);
      managerRef.current.setSystemMode(mode);
      managerRef.current.recordUserAction(
        'CONTROL',
        mode === 'demonstration'
          ? 'Switched to Auto mode — THERMOS acts automatically'
          : 'Switched to Ask Me mode — THERMOS asks before acting',
        states.thermos.t * E.DT,
        { type: 'core' }
      );
      setPlanRevision((r) => r + 1);
    },
    [states.thermos.t]
  );

  // Practical Play/Pause for THERMOS AI System:
  // When paused (false), zero action from THERMOS takes place while the live facility clock keeps running on baseline BMS rules.
  // When engaged (true), THERMOS resumes sensing, forecasting, and coordinating actions on the live facility.
  const setThermosEnabled = useCallback(
    (nextEnabled: boolean) => {
      clearApprovalTimers();
      if (!nextEnabled) {
        if (animRef.current) {
          clearInterval(animRef.current);
          animRef.current = null;
        }
        setActivePackets([]);
      }
      const curStep = states.thermos.t;
      const curMin = curStep * E.DT;
      managerRef.current.setThermosEnabled(nextEnabled, curMin, curStep);
      setThermosEnabledState(nextEnabled);
      setPlanRevision((r) => r + 1);

      if (nextEnabled) {
        if (cursor >= 0) {
          setCursor(-1);
        }
        if (states.thermos.t < E.STEPS && !isPlaying) {
          setIsPlaying(true);
        }
        setSubMinuteIndex(E.DT - 1);
      } else {
        setSubMinuteIndex(E.DT - 1);
      }
    },
    [clearApprovalTimers, states.thermos.t, cursor, isPlaying]
  );

  const resetSimulation = useCallback(
    (newConfig?: ThermosConfig, newPreset?: PresetKey, keepClockRunning: boolean = true) => {
      clearTimers();
      setIsPlaying(keepClockRunning);
      setIsComputingFull(false);
      setActivePackets([]);
      setSelectedIncidentId(null);
      const conf = newConfig || config;
      const initialThermos = E.initial(conf);
      initialThermos.controller = 'thermos';
      const initialReactive = E.initial(conf);
      initialReactive.controller = 'reactive';
      const initialPhysics = E.initial(conf);
      initialPhysics.controller = 'physics';
      const initialNone = E.initial(conf);
      initialNone.controller = 'none';

      managerRef.current.reset(conf, newPreset || scenarioKey);
      setPlanRevision((r) => r + 1);

      setStates({
        thermos: initialThermos,
        reactive: initialReactive,
        physics: initialPhysics,
        none: initialNone,
      });
      setSubMinuteIndex(E.DT - 1);
      setCursor(-1);
    },
    [config, scenarioKey, clearTimers]
  );

  const tickAllControllers = useCallback(
    (prev: {
      thermos: SimulationState;
      reactive: SimulationState;
      physics: SimulationState;
      none: SimulationState;
    }) => {
      if (prev.thermos.t >= E.STEPS) return prev;
      const overrideAction = managerRef.current.getControlOverrideForNextTick(prev.thermos);
      const nextThermos = E.tick(E.clone(prev.thermos), config, 'thermos', MODEL, overrideAction);
      const nextReactive = E.tick(E.clone(prev.reactive), config, 'reactive', MODEL);
      const nextPhysics = E.tick(E.clone(prev.physics), config, 'physics', MODEL);
      const nextNone = E.tick(E.clone(prev.none), config, 'none', MODEL);
      return {
        thermos: nextThermos,
        reactive: nextReactive,
        physics: nextPhysics,
        none: nextNone,
      };
    },
    [config]
  );

  // Advance by 1 full decision step (+5 simulated minutes) across all 4 strategies
  const stepForward = useCallback(() => {
    clearApprovalTimers();
    const nextMin = (states.thermos.t + 1) * E.DT;
    managerRef.current.recordUserAction('CONTROL', 'Stepped clock forward +5 min', nextMin, {
      type: 'core',
    });
    setStates((prev) => tickAllControllers(prev));
    setSubMinuteIndex(E.DT - 1);
    setCursor(-1);
  }, [tickAllControllers, clearApprovalTimers, states.thermos.t]);

  const handleSetCursor = useCallback((step: number) => {
    setSubMinuteIndex(E.DT - 1);
    setCursor(step);
  }, []);

  // Animate real multi-rack workload transfer packets along light-strip conduits (wall-clock duration decoupled from sim speed)
  const animateTransfers = useCallback(
    (transfers: WorkloadTransferEdge[], onComplete?: () => void) => {
      if (animRef.current) {
        clearInterval(animRef.current);
        animRef.current = null;
      }
      if (!transfers.length) {
        setActivePackets([]);
        if (onComplete) {
          if (approvalTimerRef.current) clearTimeout(approvalTimerRef.current);
          approvalTimerRef.current = setTimeout(() => {
            approvalTimerRef.current = null;
            onComplete();
          }, 420);
        }
        return;
      }

      const start = Date.now();
      const durationMs = 1150;
      setActivePackets(
        transfers.map((t, idx) => ({
          ...t,
          id: `PKT_${t.fromRack}_${t.toRack}_${idx}`,
          progress: 0.04,
        }))
      );

      animRef.current = setInterval(() => {
        const p = Math.min(1, (Date.now() - start) / durationMs);
        setActivePackets(
          transfers.map((t, idx) => ({
            ...t,
            id: `PKT_${t.fromRack}_${t.toRack}_${idx}`,
            progress: p,
          }))
        );
        if (p >= 1) {
          if (animRef.current) {
            clearInterval(animRef.current);
            animRef.current = null;
          }
          setActivePackets([]);
          if (onComplete) onComplete();
        }
      }, 32);
    },
    []
  );

  // Run full 6-hour simulation across all 4 strategies
  const runFullSimulation = useCallback(async () => {
    if (isComputingFull) return;
    clearTimers();
    setIsPlaying(false);
    setIsComputingFull(true);

    await new Promise((resolve) => setTimeout(resolve, 40));

    try {
      const runThermos = E.run(config, 'thermos', MODEL);
      const runReactive = E.run(config, 'reactive', MODEL);
      const runPhysics = E.run(config, 'physics', MODEL);
      const runNone = E.run(config, 'none', MODEL);

      setStates({
        thermos: runThermos,
        reactive: runReactive,
        physics: runPhysics,
        none: runNone,
      });
      setSubMinuteIndex(E.DT - 1);
      setCursor(-1);
    } finally {
      setIsComputingFull(false);
    }
  }, [config, isComputingFull, clearTimers]);

  const selectScenario = useCallback(
    (preset: PresetKey) => {
      setScenarioKey(preset);
      const newConf = E.config(E.presets[preset]);
      setConfig(newConf);
      resetSimulation(newConf, preset);
    },
    [resetSimulation]
  );

  // Autonomous Compound Stress Run at 1x live speed with THERMOS engaged
  const runCompoundStressTest = useCallback(() => {
    const newConf = E.config(E.presets.compound);
    setScenarioKey('compound');
    setConfig(newConf);
    setSystemMode('demonstration');
    managerRef.current.setThermosEnabled(true, 0, 0);
    setThermosEnabledState(true);
    resetSimulation(newConf, 'compound', true);
    managerRef.current.setSystemMode('demonstration');
    setSpeed(1);
  }, [resetSimulation, setSystemMode]);

  const applyCustomConfig = useCallback(
    (custom: Partial<ThermosConfig>) => {
      const merged = { ...config, ...custom };
      setConfig(merged);
      resetSimulation(merged, scenarioKey, isPlaying);
    },
    [config, scenarioKey, resetSimulation, isPlaying]
  );

  // Approve pending coordinated multi-rack plan -> ignite green pathways, animate transfers,
  // and commit into the live simulation clock (or step verification smoothly if clock is frozen)
  const authorisePendingPlan = useCallback(
    (isAuto: boolean = false): CoordinatedResponsePlan | null => {
      clearApprovalTimers();
      const plan = managerRef.current.authorisePendingPlan(isAuto);
      setPlanRevision((r) => r + 1);
      if (plan) {
        if (isPlaying) {
          setCursor(-1);
          setSubMinuteIndex(E.DT - 1);
          animateTransfers(plan.transfers);
        } else {
          animateTransfers(plan.transfers, () => {
            setCursor(-1);
            setStates((prev) => tickAllControllers(prev));
            setSubMinuteIndex(0);

            let subTick = 0;
            const totalSubTicks = E.DT * 2 - 1;
            approvalIntervalRef.current = setInterval(() => {
              subTick += 1;
              if (subTick < E.DT) {
                setSubMinuteIndex(subTick);
              } else if (subTick === E.DT) {
                setStates((prev) => tickAllControllers(prev));
                setSubMinuteIndex(0);
              } else {
                const nextSub = subTick - E.DT;
                setSubMinuteIndex(Math.min(E.DT - 1, nextSub));
              }
              if (subTick >= totalSubTicks) {
                if (approvalIntervalRef.current) {
                  clearInterval(approvalIntervalRef.current);
                  approvalIntervalRef.current = null;
                }
              }
            }, 210);
          });
        }
      }
      return plan;
    },
    [animateTransfers, tickAllControllers, clearApprovalTimers, isPlaying]
  );

  // Reject pending plan -> hold unmitigated baseline and continue
  const rejectPendingPlan = useCallback(() => {
    clearApprovalTimers();
    managerRef.current.rejectPendingPlan();
    setPlanRevision((r) => r + 1);
    if (!isPlaying) {
      stepForward();
    }
  }, [stepForward, clearApprovalTimers, isPlaying]);

  const dismissVerifiedOutcome = useCallback(() => {
    managerRef.current.clearVerifiedOutcome();
    setPlanRevision((r) => r + 1);
  }, []);

  const currentState = states[activeController];
  const activeTrace = currentState.trace;
  const isScrubbing = cursor >= 0 && cursor < activeTrace.length;
  const currentStepIndex = isScrubbing
    ? cursor
    : activeTrace.length > 0
    ? activeTrace.length - 1
    : -1;

  const currentRecord: StepRecord | null =
    currentStepIndex >= 0 ? activeTrace[currentStepIndex] : null;

  const effectiveSubMinuteIndex = isScrubbing ? E.DT - 1 : subMinuteIndex;

  // Derive Central Facility State (Single Source of Truth across 1-minute ODE sub-steps and 5-minute controller epochs)
  const facilityState: GlobalFacilityState = useMemo(() => {
    void planRevision;
    return managerRef.current.evaluateFacilityState(
      currentRecord,
      currentState,
      speed,
      isPlaying,
      effectiveSubMinuteIndex,
      isScrubbing
    );
  }, [currentRecord, currentState, speed, isPlaying, effectiveSubMinuteIndex, isScrubbing, planRevision]);

  const decisionHoldRef = useRef<string | null>(null);
  decisionHoldRef.current = facilityState.decisionHoldReason;

  const handleSetIsPlaying = useCallback(
    (nextPlaying: boolean) => {
      if (nextPlaying) {
        clearApprovalTimers();
        if (states.thermos.t >= E.STEPS) {
          resetSimulation(config, scenarioKey, true);
          return;
        }
        managerRef.current.recordUserAction(
          'CONTROL',
          'Resumed live simulation clock',
          states.thermos.t * E.DT,
          { type: 'core' }
        );
      } else {
        managerRef.current.recordUserAction(
          'CONTROL',
          'Froze simulation clock',
          states.thermos.t * E.DT,
          { type: 'core' }
        );
      }
      setPlanRevision((r) => r + 1);
      setIsPlaying(nextPlaying);
    },
    [clearApprovalTimers, states.thermos.t, resetSimulation, config, scenarioKey]
  );

  // Controlled Simulation Clock:
  // 1x = 900ms per simulated minute | 2x = 450ms per simulated minute | 5x = 180ms per simulated minute
  useEffect(() => {
    if (!isPlaying) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    if (states.thermos.t >= E.STEPS && subMinuteIndex >= E.DT - 1) {
      setIsPlaying(false);
      return;
    }

    const baseMinuteMs = Math.max(160, Math.round(900 / speed));
    const hasMajorDecisionHold =
      systemMode === 'demonstration' &&
      subMinuteIndex === E.DT - 1 &&
      Boolean(decisionHoldRef.current);
    const holdBonusMs = hasMajorDecisionHold ? Math.round(900 / Math.sqrt(speed)) : 0;
    const delayMs = states.thermos.t === 0 ? Math.min(450, baseMinuteMs) : baseMinuteMs + holdBonusMs;

    timerRef.current = setTimeout(() => {
      if (cursor >= 0) {
        setCursor(-1);
      }
      if (subMinuteIndex < E.DT - 1 && states.thermos.trace.length > 0) {
        setSubMinuteIndex((idx) => idx + 1);
      } else {
        if (states.thermos.t >= E.STEPS) {
          setIsPlaying(false);
          return;
        }
        setStates((prev) => tickAllControllers(prev));
        setSubMinuteIndex(0);
      }
    }, delayMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [
    isPlaying,
    speed,
    subMinuteIndex,
    states.thermos.t,
    states.thermos.trace.length,
    cursor,
    systemMode,
    tickAllControllers,
  ]);

  // In Autonomous Mode (when THERMOS is enabled), animate transfer packets whenever THERMOS enters INTERVENING
  const lastAnimatedStepRef = useRef<number>(-1);
  useEffect(() => {
    if (states.thermos.t === 0 || !thermosEnabled) {
      lastAnimatedStepRef.current = -1;
    }
    if (
      thermosEnabled &&
      !isScrubbing &&
      systemMode === 'demonstration' &&
      facilityState.thermos.visualState === 'INTERVENING' &&
      facilityState.thermos.activeTransfers.length > 0 &&
      lastAnimatedStepRef.current !== facilityState.step
    ) {
      lastAnimatedStepRef.current = facilityState.step;
      animateTransfers(facilityState.thermos.activeTransfers);
    }
  }, [
    thermosEnabled,
    isScrubbing,
    systemMode,
    states.thermos.t,
    facilityState.step,
    facilityState.thermos.visualState,
    facilityState.thermos.activeTransfers,
    animateTransfers,
  ]);

  const displayTemps = useMemo(
    () =>
      facilityState.racks.map((r) =>
        revealTruth || r.sensorAvailable ? r.simulatedInletC : r.estimatedInletC
      ),
    [facilityState.racks, revealTruth]
  );

  const displayLoads = useMemo(
    () => facilityState.racks.map((r) => r.workloadUtil),
    [facilityState.racks]
  );

  const displayPredictions = useMemo(
    () => facilityState.racks.map((r) => r.predictedInletC),
    [facilityState.racks]
  );

  const displayUncertainties = useMemo(
    () => facilityState.racks.map((r) => r.uncertaintyMarginC),
    [facilityState.racks]
  );

  const displaySensors = currentRecord
    ? currentRecord.sensors
    : E.sensorMask(config, 0);

  const minutesPassed = facilityState.minute;
  const totalMinutes = E.STEPS * E.DT;
  const isComplete = states.thermos.t >= E.STEPS && effectiveSubMinuteIndex >= E.DT - 1;

  return {
    scenarioKey,
    config,
    activeController,
    setActiveController,
    systemMode,
    setSystemMode,
    thermosEnabled,
    setThermosEnabled,
    facilityState,
    states,
    cursor,
    isScrubbing,
    setCursor: handleSetCursor,
    isPlaying,
    setIsPlaying: handleSetIsPlaying,
    speed,
    setSpeed,
    isComputingFull,
    revealTruth,
    setRevealTruth,
    selectedRackId,
    setSelectedRackId,
    selectedIncidentId,
    setSelectedIncidentId,
    activePackets,
    resetSimulation,
    stepForward,
    runFullSimulation,
    selectScenario,
    runCompoundStressTest,
    applyCustomConfig,
    authorisePendingPlan,
    rejectPendingPlan,
    dismissVerifiedOutcome,
    currentRecord,
    currentStepIndex,
    displayTemps,
    displayLoads,
    displayPredictions,
    displayUncertainties,
    displaySensors,
    minutesPassed,
    totalMinutes,
    timeString: facilityState.timeString,
    isComplete,
    model: MODEL,
  };
}
