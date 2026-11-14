import { useState, useEffect, useCallback, useRef } from 'react';
import type { StepRecord, ThermosConfig } from '../simulation/types';

export interface WorkloadPacket {
  id: number;
  fromRack: number;
  toRack: number;
  progress: number; // 0 to 1
  amount: number;
}

export interface InterventionOutcome {
  targetRack: number;
  peakBefore: number;
  peakAfter: number;
  violationsAvoided: number;
  energyUsed: number;
  waterSaved: number;
}

export function useInterventionWorkflow(
  currentRecord: StepRecord | null,
  config: ThermosConfig,
  isPlaying: boolean,
  pauseSimulation: () => void,
  triggerStep: () => void
) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isInterventionActive, setIsInterventionActive] = useState(false);
  const [interventionStep, setInterventionStep] = useState<number>(0); // 0: none, 1: confirm, 2: cooling, 3: migration, 4: cooldown, 5: outcome
  const [activePackets, setActivePackets] = useState<WorkloadPacket[]>([]);
  const [lastOutcome, setLastOutcome] = useState<InterventionOutcome | null>(null);
  const [hasTriggeredAuto, setHasTriggeredAuto] = useState(false);
  const [inspectDecisionOpen, setInspectDecisionOpen] = useState(false);

  // Monitor for thermal risk (Autonomous event detection)
  useEffect(() => {
    if (!currentRecord || hasTriggeredAuto || isInterventionActive || isModalOpen) return;

    // Check if rack 7 (or any rack) exceeds safe inlet threshold (e.g., >= 28.2°C or predicted >= 29.0°C)
    const temps = currentRecord.temps;
    const preds = currentRecord.predictions;
    const hotRackIndex = preds.findIndex((p, idx) => p >= 28.5 || temps[idx] >= 28.2);

    if (hotRackIndex !== -1 && currentRecord.minute >= 30) {
      pauseSimulation();
      setIsModalOpen(true);
      setHasTriggeredAuto(true);
    }
  }, [currentRecord, hasTriggeredAuto, isInterventionActive, isModalOpen, pauseSimulation]);

  // Manual Trigger: "Trigger Demo Challenge / Event"
  const triggerDemoChallenge = useCallback(() => {
    pauseSimulation();
    setIsModalOpen(true);
  }, [pauseSimulation]);

  // Operator Action 1: Approve THERMOS
  const approveIntervention = useCallback(() => {
    setIsModalOpen(false);
    setIsInterventionActive(true);
    setInterventionStep(1); // 1: Confirmation banner

    const targetRack = 6; // R07 bottleneck (index 6)
    const currentPeak = currentRecord ? Math.max(...currentRecord.temps) : 29.6;

    // Stage 1 -> Stage 2 (Cooling Adjustment after 900ms)
    setTimeout(() => {
      setInterventionStep(2);

      // Stage 2 -> Stage 3 (Workload Packet Migration after 1200ms)
      setTimeout(() => {
        setInterventionStep(3);
        // Spawn animated packets from R07 (index 6) to R02 (index 1) and R04 (index 3)
        const packets: WorkloadPacket[] = [
          { id: 1, fromRack: 6, toRack: 1, progress: 0, amount: 0.22 },
          { id: 2, fromRack: 6, toRack: 3, progress: 0, amount: 0.14 },
        ];
        setActivePackets(packets);

        const startTime = Date.now();
        const duration = 1800; // 1.8 seconds packet travel

        const animInterval = setInterval(() => {
          const elapsed = Date.now() - startTime;
          const progress = Math.min(1, elapsed / duration);

          setActivePackets([
            { id: 1, fromRack: 6, toRack: 1, progress, amount: 0.22 },
            { id: 2, fromRack: 6, toRack: 3, progress, amount: 0.14 },
          ]);

          if (progress >= 1) {
            clearInterval(animInterval);
            setActivePackets([]);

            // Stage 4: Thermal Cooldown
            setInterventionStep(4);
            triggerStep(); // advance simulation state

            // Stage 5: Outcome Card after cooldown
            setTimeout(() => {
              setInterventionStep(5);
              setLastOutcome({
                targetRack,
                peakBefore: Math.max(29.6, currentPeak),
                peakAfter: 26.8,
                violationsAvoided: 1,
                energyUsed: 0.42,
                waterSaved: 0.85,
              });
            }, 1400);
          }
        }, 30);
      }, 1200);
    }, 900);
  }, [currentRecord, triggerStep]);

  // Operator Action 2: Inspect Decision
  const openDecisionInspection = useCallback(() => {
    setInspectDecisionOpen(true);
  }, []);

  // Operator Action 3: Decline / Keep Baseline
  const declineIntervention = useCallback(() => {
    setIsModalOpen(false);
    setIsInterventionActive(false);
    setInterventionStep(0);
    // User chooses to keep baseline, continuing simulation without THERMOS override
  }, []);

  const closeOutcome = useCallback(() => {
    setIsInterventionActive(false);
    setInterventionStep(0);
    setLastOutcome(null);
  }, []);

  return {
    isModalOpen,
    setIsModalOpen,
    isInterventionActive,
    interventionStep,
    activePackets,
    lastOutcome,
    inspectDecisionOpen,
    setInspectDecisionOpen,
    triggerDemoChallenge,
    approveIntervention,
    openDecisionInspection,
    declineIntervention,
    closeOutcome,
  };
}
