import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DataCentreScene, ActiveContextualTarget } from './components/DataCentreScene';
import { MinimalSimControl } from './components/MinimalSimControl';
import { ThermosCorePanel, PathwayPanelKind } from './components/ThermosCorePanel';
import { PathwayEquipmentPanel } from './components/PathwayEquipmentPanel';
import { RackInspector } from './components/RackInspector';
import { IncidentInspectorCard } from './components/IncidentInspectorCard';
import { TechnicalDrawers, ActiveDrawer } from './components/TechnicalDrawers';
import { useSimulation } from './hooks/useSimulation';
import { useViewport } from './hooks/useViewport';
import type { FacilityViewMode } from './simulation/types';
import {
  buildContextualExplanation,
  type ExplainableTarget,
} from './simulation/explanationEngine';
import { PresentationPlugin } from './components/PresentationPlugin';

export default function App() {
  const sim = useSimulation();
  const viewport = useViewport();

  // Single contextual UI state — 'none' on initial load so the 3D facility is the interface
  const [activeTarget, setActiveTarget] = useState<ActiveContextualTarget>('none');
  const [navHistory, setNavHistory] = useState<ExplainableTarget[]>([]);

  // Secondary technical analysis slide-over (accessible via top-left Results or THERMOS Core)
  const [activeDrawer, setActiveDrawer] = useState<ActiveDrawer>('none');

  const selectedIncident = useMemo(() => {
    if (!sim.selectedIncidentId) return null;
    return sim.facilityState.activeIncidents.find((i) => i.id === sim.selectedIncidentId) ?? null;
  }, [sim.selectedIncidentId, sim.facilityState.activeIncidents]);

  // If an inspected incident auto-resolves in the simulation, release the empty incident slot cleanly
  useEffect(() => {
    if (activeTarget === 'incident' && !selectedIncident) {
      setActiveTarget('none');
      sim.setSelectedIncidentId(null);
    }
  }, [activeTarget, selectedIncident, sim]);

  const handleCloseAllContextual = useCallback(() => {
    setActiveTarget('none');
    setNavHistory([]);
    sim.setSelectedRackId(null);
    sim.setSelectedIncidentId(null);
  }, [sim]);

  const handleSelectRack = useCallback(
    (id: number | null) => {
      if (id === null) {
        setActiveTarget('none');
        setNavHistory([]);
        sim.setSelectedRackId(null);
        return;
      }
      setNavHistory([]);
      sim.setSelectedIncidentId(null);
      sim.setSelectedRackId(id);
      setActiveTarget('rack');
    },
    [sim]
  );

  const handleSelectIncident = useCallback(
    (id: string | null) => {
      if (id === null) {
        setActiveTarget('none');
        setNavHistory([]);
        sim.setSelectedIncidentId(null);
        return;
      }
      setNavHistory([]);
      sim.setSelectedRackId(null);
      sim.setSelectedIncidentId(id);
      setActiveTarget('incident');
    },
    [sim]
  );

  const handleToggleCore = useCallback(() => {
    setNavHistory([]);
    sim.setSelectedRackId(null);
    sim.setSelectedIncidentId(null);
    setActiveTarget((prev) => (prev === 'core' ? 'none' : 'core'));
  }, [sim]);

  const handleOpenCore = useCallback(() => {
    setNavHistory([]);
    sim.setSelectedRackId(null);
    sim.setSelectedIncidentId(null);
    setActiveTarget('core');
  }, [sim]);

  const handleTogglePathway = useCallback(
    (kind: PathwayPanelKind) => {
      setNavHistory([]);
      sim.setSelectedRackId(null);
      sim.setSelectedIncidentId(null);
      setActiveTarget((prev) => (prev === kind ? 'none' : kind));
    },
    [sim]
  );

  const handleSelectPathway = useCallback(
    (kind: PathwayPanelKind) => {
      setNavHistory([]);
      sim.setSelectedRackId(null);
      sim.setSelectedIncidentId(null);
      setActiveTarget(kind);
    },
    [sim]
  );

  const handleToggleSimControls = useCallback(() => {
    sim.setSelectedRackId(null);
    sim.setSelectedIncidentId(null);
    setActiveTarget((prev) => (prev === 'sim-controls' ? 'none' : 'sim-controls'));
  }, [sim]);

  const handleOpenDrawer = useCallback(
    (drawer: Exclude<ActiveDrawer, 'none'>) => {
      setActiveTarget('none');
      sim.setSelectedRackId(null);
      sim.setSelectedIncidentId(null);
      setActiveDrawer(drawer);
    },
    [sim]
  );

  // Derive 3D visualization pathway from active contextual selection
  const effectiveViewMode: FacilityViewMode = useMemo(() => {
    if (
      activeTarget === 'compute' ||
      activeTarget === 'heat' ||
      activeTarget === 'recovery' ||
      activeTarget === 'cooling'
    ) {
      return activeTarget;
    }
    return 'facility';
  }, [activeTarget]);

  // Keyboard shortcuts (Space = Toggle THERMOS Active/Paused, Right = Step +5m when clock frozen, Escape = Close contextual panel)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        sim.setThermosEnabled(!sim.thermosEnabled);
      } else if (e.code === 'ArrowRight' && !sim.isPlaying) {
        e.preventDefault();
        sim.stepForward();
      } else if (e.code === 'Escape') {
        setActiveTarget('none');
        sim.setSelectedRackId(null);
        sim.setSelectedIncidentId(null);
        setActiveDrawer('none');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sim]);

  const activePathwayKind: PathwayPanelKind | null =
    activeTarget === 'compute' ||
    activeTarget === 'heat' ||
    activeTarget === 'recovery' ||
    activeTarget === 'cooling'
      ? activeTarget
      : null;

  const hasActiveMobileSheet =
    viewport.isMobile &&
    (activeTarget === 'rack' ||
      activeTarget === 'core' ||
      activeTarget === 'incident' ||
      activePathwayKind !== null);

  const currentExplainableTarget: ExplainableTarget = useMemo(() => {
    if (activeTarget === 'rack' && sim.selectedRackId !== null) {
      return { type: 'rack', rackId: sim.selectedRackId };
    }
    if (activeTarget === 'incident' && sim.selectedIncidentId !== null) {
      return { type: 'incident', incidentId: sim.selectedIncidentId };
    }
    if (activeTarget === 'core') {
      return { type: 'core' };
    }
    if (activePathwayKind) {
      return { type: 'pathway', kind: activePathwayKind };
    }
    return { type: 'none' };
  }, [activeTarget, sim.selectedRackId, sim.selectedIncidentId, activePathwayKind]);

  const applyExplainableTarget = useCallback(
    (next: ExplainableTarget) => {
      if (next.type === 'rack') {
        sim.setSelectedIncidentId(null);
        sim.setSelectedRackId(next.rackId);
        setActiveTarget('rack');
      } else if (next.type === 'incident') {
        sim.setSelectedRackId(null);
        sim.setSelectedIncidentId(next.incidentId);
        setActiveTarget('incident');
      } else if (next.type === 'core') {
        sim.setSelectedRackId(null);
        sim.setSelectedIncidentId(null);
        setActiveTarget('core');
      } else if (next.type === 'pathway') {
        sim.setSelectedRackId(null);
        sim.setSelectedIncidentId(null);
        setActiveTarget(next.kind);
      } else {
        sim.setSelectedRackId(null);
        sim.setSelectedIncidentId(null);
        setActiveTarget('none');
      }
    },
    [sim]
  );

  const handleNavigateExplainable = useCallback(
    (next: ExplainableTarget) => {
      if (currentExplainableTarget.type !== 'none') {
        setNavHistory((prev) => [...prev.slice(-7), currentExplainableTarget]);
      }
      applyExplainableTarget(next);
    },
    [currentExplainableTarget, applyExplainableTarget]
  );

  const handleNavigateBack = useCallback(() => {
    setNavHistory((prev) => {
      if (prev.length === 0) return prev;
      const previous = prev[prev.length - 1];
      applyExplainableTarget(previous);
      return prev.slice(0, -1);
    });
  }, [applyExplainableTarget]);

  const backLabel = useMemo(() => {
    if (navHistory.length === 0) return undefined;
    const prev = navHistory[navHistory.length - 1];
    if (prev.type === 'rack') return `R${String(prev.rackId + 1).padStart(2, '0')}`;
    if (prev.type === 'core') return 'THERMOS Core';
    if (prev.type === 'incident') return 'Incident';
    if (prev.type === 'pathway') return prev.kind.charAt(0).toUpperCase() + prev.kind.slice(1);
    return 'Back';
  }, [navHistory]);

  const explanation = useMemo(
    () =>
      buildContextualExplanation(
        currentExplainableTarget,
        sim.facilityState,
        sim.currentRecord,
        sim.revealTruth
      ),
    [currentExplainableTarget, sim.facilityState, sim.currentRecord, sim.revealTruth]
  );

  const isThermosIntervening =
    sim.facilityState.thermos.visualState === 'INTERVENING' ||
    sim.facilityState.thermos.visualState === 'RESOLVED';

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#F7F7F2] text-[#18181B]">
      {/* Full-Bleed 3D Data-Centre Digital Twin */}
      <DataCentreScene
        temps={sim.displayTemps}
        loads={sim.displayLoads}
        predictions={sim.displayPredictions}
        uncertainties={sim.displayUncertainties}
        activeSensors={sim.displaySensors}
        config={sim.config}
        selectedRackId={activeTarget === 'rack' ? sim.selectedRackId : null}
        onSelectRack={handleSelectRack}
        selectedIncidentId={activeTarget === 'incident' ? sim.selectedIncidentId : null}
        onSelectIncident={handleSelectIncident}
        revealTruth={sim.revealTruth}
        minute={sim.minutesPassed}
        viewMode={effectiveViewMode}
        activeContextualTarget={activeTarget}
        onSelectCore={handleToggleCore}
        onSelectPathway={handleTogglePathway}
        onOpenResults={() => handleOpenDrawer('comparison')}
        onCanvasBackgroundClick={handleCloseAllContextual}
        currentRecord={sim.currentRecord}
        facility={sim.facilityState}
        activeWorkloadPackets={sim.activePackets}
        viewport={viewport}
        hasActiveMobileSheet={hasActiveMobileSheet}
        connectedRackIds={explanation?.connectedRackIds}
        highlightedPathways={explanation?.highlightedPathways}
      />

      {/* Discreet THERMOS Play/Pause & Digital Twin Clock Control */}
      <MinimalSimControl
        isOpen={activeTarget === 'sim-controls'}
        onToggleOpen={handleToggleSimControls}
        onClose={() => setActiveTarget('none')}
        thermosEnabled={sim.thermosEnabled}
        isIntervening={isThermosIntervening}
        onToggleThermos={() => sim.setThermosEnabled(!sim.thermosEnabled)}
        isPlaying={sim.isPlaying}
        onTogglePlay={() => sim.setIsPlaying(!sim.isPlaying)}
        onStepForward={sim.stepForward}
        onReset={() => sim.resetSimulation()}
        speed={sim.speed}
        onChangeSpeed={sim.setSpeed}
        scenarioKey={sim.scenarioKey}
        onSelectScenario={sim.selectScenario}
        systemMode={sim.systemMode}
        onChangeSystemMode={sim.setSystemMode}
        timeString={sim.timeString}
        currentStep={sim.facilityState.step}
        traceLength={sim.states[sim.activeController].trace.length}
        cursor={sim.cursor}
        onScrub={(step) => sim.setCursor(step)}
        isComplete={sim.isComplete}
        isMobile={viewport.isMobile}
        hidePill={hasActiveMobileSheet}
      />

      {/* Contextual Panel: Individual Server Rack (R01–R12) */}
      <RackInspector
        rackId={activeTarget === 'rack' ? sim.selectedRackId : null}
        onClose={() => {
          setActiveTarget('none');
          setNavHistory([]);
          sim.setSelectedRackId(null);
        }}
        facility={sim.facilityState}
        revealTruth={sim.revealTruth}
        onToggleRevealTruth={() => sim.setRevealTruth(!sim.revealTruth)}
        onSelectRack={(id) => handleSelectRack(id)}
        onSelectIncident={(incId) => handleSelectIncident(incId)}
        onSelectPathway={handleSelectPathway}
        onToggleThermos={() => sim.setThermosEnabled(!sim.thermosEnabled)}
        explanation={activeTarget === 'rack' ? explanation : null}
        onNavigate={handleNavigateExplainable}
        onBack={navHistory.length > 0 ? handleNavigateBack : undefined}
        backLabel={backLabel}
        isMobile={viewport.isMobile}
      />

      {/* Contextual Panel: THERMOS Core Intelligence, Manual Plan Approval & Deep Analysis Launchers */}
      <ThermosCorePanel
        isOpen={activeTarget === 'core'}
        onClose={() => {
          setActiveTarget('none');
          setNavHistory([]);
        }}
        facility={sim.facilityState}
        systemMode={sim.systemMode}
        onToggleThermos={() => sim.setThermosEnabled(!sim.thermosEnabled)}
        onApprovePlan={() => sim.authorisePendingPlan(false)}
        onRejectPlan={() => sim.rejectPendingPlan()}
        onDismissOutcome={sim.dismissVerifiedOutcome}
        onSelectRack={(id) => handleSelectRack(id)}
        onSelectIncident={(incId) => handleSelectIncident(incId)}
        onSelectPathway={handleSelectPathway}
        onOpenDrawer={handleOpenDrawer}
        explanation={activeTarget === 'core' ? explanation : null}
        onNavigate={handleNavigateExplainable}
        onBack={navHistory.length > 0 ? handleNavigateBack : undefined}
        backLabel={backLabel}
        isMobile={viewport.isMobile}
      />

      {/* Contextual Panel: Job Routing, Heat Capture, Thermal Recovery & Smart Cooling */}
      <PathwayEquipmentPanel
        kind={activePathwayKind}
        onClose={() => {
          setActiveTarget('none');
          setNavHistory([]);
        }}
        facility={sim.facilityState}
        currentRecord={sim.currentRecord}
        onSelectRack={(id) => handleSelectRack(id)}
        onSelectPathway={handleSelectPathway}
        onOpenCore={handleOpenCore}
        onToggleThermos={() => sim.setThermosEnabled(!sim.thermosEnabled)}
        explanation={activePathwayKind ? explanation : null}
        onNavigate={handleNavigateExplainable}
        onBack={navHistory.length > 0 ? handleNavigateBack : undefined}
        backLabel={backLabel}
        isMobile={viewport.isMobile}
      />

      {/* Contextual Panel: Active Facility Incident Details */}
      <IncidentInspectorCard
        incident={activeTarget === 'incident' ? selectedIncident : null}
        thermosEnabled={sim.thermosEnabled}
        onToggleThermos={() => sim.setThermosEnabled(!sim.thermosEnabled)}
        onClose={() => {
          setActiveTarget('none');
          setNavHistory([]);
          sim.setSelectedIncidentId(null);
        }}
        onSelectRack={(id) => handleSelectRack(id)}
        onOpenCore={handleOpenCore}
        explanation={activeTarget === 'incident' ? explanation : null}
        onNavigate={handleNavigateExplainable}
        onBack={navHistory.length > 0 ? handleNavigateBack : undefined}
        backLabel={backLabel}
        isMobile={viewport.isMobile}
      />

      {/* Performance & Sustainability / Verified Evidence / Decision Log / Model & Physics Slide-Over */}
      <TechnicalDrawers
        activeDrawer={activeDrawer}
        onChangeDrawer={setActiveDrawer}
        onClose={() => setActiveDrawer('none')}
        states={sim.states}
        config={sim.config}
        cursor={sim.cursor}
        onScrub={sim.setCursor}
        model={sim.model}
        currentRecord={sim.currentRecord}
        onRunFull={sim.runFullSimulation}
        isComputingFull={sim.isComputingFull}
      />

      {/* Discreet HOPE '26 UN SDG 9/11/12 Sustainability Reference */}
      <PresentationPlugin />
    </main>
  );
}
