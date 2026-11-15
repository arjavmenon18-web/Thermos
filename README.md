# THERMOS — Thermal Intelligence & Sustainable Operations

**An Interactive AI Data Centre Intelligence Demonstration for Competition Judges**

THERMOS demonstrates how AI-assisted thermal prediction and intelligent multi-objective decision search help a simulated 12-rack data centre respond to extreme heatwaves, compute demand surges, water restrictions, and sensor outages while auditing conceptual waste-heat recovery.

---

## 1. Quick Launch Instructions

This application is built with React 19, TypeScript, Vite, and Tailwind CSS. All thermal physics, Random Forest inferences, and resource ledgers run **100% locally in the browser** with zero API keys or external services required.

```bash
# 1. Install dependencies (if running from scratch)
npm install

# 2. Start the local development server (port 3000)
npm run dev

# 3. Build for production
npm run build

# 4. Run automated test suite
./node_modules/.bin/tsx --test src/simulation/engine.test.ts
```

The application will be live at `http://localhost:3000`.

---

## 2. Core Architecture & Features

### A. 12-Rack Simulated Facility & Thermal Plant
- **Layout**: 12 virtual server racks arranged in a 3 × 4 grid (R01–R12).
- **Time Horizon**: 6 operating hours (09:00 to 15:00) simulated in 72 discrete steps of 5 minutes ($DT = 5$ min).
- **Thermal Dynamics**: First-order physical cooling response with a 12-minute time constant:
  $$\Delta T_i = (T_{\text{target}, i} - T_i) \times (1 - e^{-5/12})$$
  incorporating air-delivery effectiveness $D_i$, outdoor ambient derating, and thermal cross-coupling from orthogonal floorplan neighbors.
- **Physical Restrictions**: Known airflow restriction of 30% on R07 (primary facility bottleneck) and 16.5% on R08.

### B. Machine Learning Ensemble (Random Forest)
- **Model Architecture**: Scikit-learn `RandomForestRegressor` ensemble with 24 trees, max depth 11, min leaf samples 5.
- **Input Features (7)**:
  1. Current estimated inlet temperature ($T_{\text{inlet}}$) — 21.0% importance
  2. Rack workload load ($L_i$) — 6.6% importance
  3. Mean neighbor rack load ($n_i$) — 1.3% importance
  4. Candidate supply-air temperature ($S$) — 55.7% importance
  5. Airflow fraction ($F$) — 12.0% importance
  6. Outside ambient temperature ($A$) — 1.2% importance
  7. Known airflow restriction ($B_i$) — 2.4% importance
- **Target**: Predicted 15-minute temperature change ($\Delta T_{15\text{m}}$).
- **Documented Metrics**: Test MAE: **0.143°C** (vs 1.234°C persistence baseline), Test RMSE: **0.202°C**, $R^2$: **0.983**, 95% empirical prediction interval coverage: **95.7%** ($\pm 0.417^\circ\text{C}$ calibration margin).

### C. Sparse Sensing & Fault Tolerance
- **Sensors**: Physical sensors installed on a priority sequence (R07, R02, R11, R04...).
- **Spatial Reconstruction**: Unsensed racks are estimated via physics prior plus inverse distance-squared residual interpolation: $w_j = \frac{1}{1 + \text{dist}^2}$.
- **Uncertainty Margins**: Sensed racks carry $\pm 0.12^\circ\text{C}$; unsensed racks carry $\pm 0.75^\circ\text{C}$.
- **Sensor Failure Scenario**: In the sensor-loss preset, R07 fails abruptly at 11:00 (Step 24). The system dynamically expands its uncertainty buffer to $\pm 1.20^\circ\text{C}$ and shifts workload to prevent thermal runaway.

### D. Intelligent Decision Centre (72 Candidates)
- Evaluates 72 combinatorial actions every 5 minutes across supply air (20, 22, 24°C), fan speed (45%, 70%, 100%), cooling mode (dry vs wet evaporative), workload placement (original vs spread), and batch compute dispatching.
- **Explainability**: Generates dynamic natural-language explanations ("Why did THERMOS choose this action?") and presents expandable candidate comparisons ("Why not another action?").

### E. Three-Way Controller Strategy Comparison
1. **THERMOS (AI-Assisted)**: Proactive lookahead using Random Forest forecast and conservative uncertainty bounds.
2. **Reactive Baseline**: Traditional industrial thermostat responding only after observed temperatures approach limits.
3. **Engineering Planner**: Theoretical control model utilizing the exact simulator equations with 0.15°C margin and 20W overhead.

### F. Conceptual Waste-Heat Recovery & Thermoelectric Harvester
- **Liquid Loop**: Models source temperature $T_{\text{hot}} = 32 + 12 \bar{L} + 0.4(S - 20)^\circ\text{C}$.
- **Dual Rigorous Ledgers**: Strict boundary separation between electrical energy (kWh) and delivered thermal energy ($\text{kWh}_{\text{th}}$).
- **Carnot Limit**: Thermoelectric generation is strictly zero if ambient temperature meets or exceeds source temperature.
- **Energy Storage**: 50 Wh store begins at 0 Wh and supplies internal microcontroller monitoring first.

### G. Evidence Lab & Exports
- **15-Run Evidence Suite**: Tests all 5 presets across all 3 controllers live or inspects verified precomputed benchmarks.
- **JSON Exports**:
  - `THERMOS-results.json`: Full telemetry trace, action plans, and summaries for active runs.
  - `THERMOS-evidence-suite.json`: Complete 15-run evaluation matrix with model metrics.

### H. 8-Minute Judge Rehearsal Mode
- Step-by-step guided walkthrough with dual-presenter narrative cues:
  - **Presenter 1**: Engineering narrative & problem framing.
  - **Presenter 2**: Dashboard operator & evidence presenter.
  - Interactive "Execute Action" buttons to set up each demonstration station in one click.

---

## 3. Checklist of Tested Features & Known Limitations

### Tested & Verified Features
- [x] Full 6-hour simulation (09:00–15:00, 72 steps of 5 min) running deterministically.
- [x] 24-tree Random Forest local inference matching scikit-learn reference predictions ($< 10^{-5}$ tolerance).
- [x] Movable workload conservation and 1.0 rack capacity constraints verified.
- [x] Partial load pinning (45% pinned) preventing unrealistic compute migration thrashing.
- [x] Earliest-Deadline-First (EDF) batch jobs (J1, J2, J3) completing with 0 missed deadlines.
- [x] Sparse-sensor spatial residual interpolation and dynamic uncertainty margins.
- [x] Sensor failure at 11:00 (Step 24) on R07 verified; uncertainty raises to $\pm 1.20^\circ\text{C}$.
- [x] Evaluator Truth toggle ("Reveal Simulator Truth") verified without leaking into controller observations.
- [x] 11-metric side-by-side comparison matrix across THERMOS, Reactive, and Engineering controllers.
- [x] Interactive SVG timeseries curves for temperatures, electricity, water, violations, and batch progress.
- [x] Dual ledgers for electrical vs thermal energy; zero double-counting verified.
- [x] Carnot boundary check: zero generation when cold sink $\ge$ hot source verified.
- [x] 15-run live evidence suite execution and JSON export verified.
- [x] Fully responsive industrial control room UI tested across desktop (1440x900) and mobile (390x844).
- [x] Automated unit test suite passing 8/8 tests with 100% pass rate.

### Known Limitations & Scientific Disclaimers
1. **Digital Simulation Prototype**: All telemetry, weather profiles, and equipment curves are synthetic. This software demonstrates algorithmic closed-loop control; it has not been calibrated with physical commercial data centre measurements.
2. **Simplified Fluid Dynamics**: The thermal model uses a 12-minute first-order response with lumped cross-coupling rather than a full 3D Computational Fluid Dynamics (CFD) solver.
3. **Thermoelectric Efficiency**: Real-world low-temperature solid-state TEGs exhibit low figures of merit ($ZT \approx 0.8$), harvesting milliwatts to a few watts. They cannot power the IT servers or eliminate data centre grid electricity draw.
4. **Demonstration Threshold**: The 30°C temperature threshold is an illustrative operational boundary chosen for competition demonstration, not a universal hardware failure point.
5. .
