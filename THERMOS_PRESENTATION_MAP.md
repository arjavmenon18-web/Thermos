# THERMOS v3.0.0 — Script-to-Interface Presentation Map

This internal reference aligns the **Vansh & Arjav presentation script (`ACTUAL_FINAL_SCRIPT.docx.pdf`)** with the refined **THERMOS v3.0.0** web application (full-bleed 3D Digital Twin with top-left `THERMOS` lockup & thermal key, `RackInspector`, `ThermosCorePanel`, `PathwayEquipmentPanel`, `MinimalSimControl`, and `TechnicalDrawers`).

> **Important Pre-Presentation Check:** Read **Section 3 (Script vs. Product Discrepancies)** below before going live. Several numbers and hardware phrases written in the earlier draft script reflect either legacy v1.0.0 metrics or overstated claims that have been reconciled in Engine v3.0.0.

---

## 1. Pre-Speech Setup Checklist

1. **Initial Load State (Default Ready):**
   - Scenario loads cleanly in **Compound Stress** (`compound`: `43.2°C` ambient peak, `82%` demand, `35 L` water cap, `R07` offline at `11:00` / Step 24).
   - **THERMOS AI** starts **Active**, **Approval Mode** starts on **`Auto`**, and the 3D hall starts open with zero blocking overlays (`activeTarget = 'none'`).
2. **Pre-Stage Clock & View:**
   - Open the bottom-center pill (`MinimalSimControl`) -> set **Speed** to `2x` or `5x` if advancing toward `11:00`, OR **scrub / play** to **`10:45`–`11:00`** right before Stage 2 (`Sensor Failure`), or leave at **`09:00`–`10:00` Live** if speaking from the start.
   - If you want to demonstrate **`Ask Me`** manual approval (Page 2), toggle **Approval Mode → `Ask Me`** inside the bottom-center control popover before opening **`CORE`** (`THERMOS Core`).
   - Click empty floor background or **`THERMOS`** top-left so judges first see the unobstructed **3D Digital Twin**, the quiet top-left **`THERMOS` · `Compound Stress · Peak XX.X°C · Results`** lockup + 1-line thermal status key, and the bottom-center **`THERMOS Active · 09:00`** control pill.

---

## 2. Script-to-Product Synchronization Guide

| Script Beat & Speaker | Spoken Topic / Key Action | Where to Click in THERMOS | Visible Interface Panel / Visual Cue | Key Things to Point Out on Screen |
| :--- | :--- | :--- | :--- | :--- |
| **1. Opening Hook & Problem Statement**<br>*(Page 1 · Arjav & Vansh)* | Data centres burn huge electricity & water for cooling; reactive thermostats only react *after* racks overheat. | Default **3D Facility Hall** (click top-left **`THERMOS`** anytime to reset camera & panels) | Full-bleed **3D Data Centre Digital Twin** + top-left status chip & 1-line color key | Point out the **12 Virtual Racks (`R01`–`R12`)** and color key: **Normal `<27.5°` · Warming `27.5–30°` · Overheating `≥30°` · Offline (Est.)**. Click **`THERMOS Active`** at bottom-center to pause AI briefly and show unmanaged hotspots turning red, then click **`THERMOS Paused`** to re-engage AI. |
| **2. Predictive Thermal Intelligence (15m Forecast)**<br>*(Page 1–2 · Vansh)* | THERMOS predicts overheating **15 minutes ahead** using physics + machine learning instead of waiting for alarms. | Click any glowing rack directly in **3D** (e.g., **`R07`**) — then use the top `R01–R12` switcher bar | **`RackInspector`** right-side panel | Point directly to the **15-Minute Forecast** box (`72% Physics + 28% ML`, `Current Temp` vs `Predicted (+15 min)`, and gauge with red **`Limit 30°C`** line). *(Keep `Technical details & validation` collapsed unless a judge asks for MAE `0.312°C` / R² `0.966` / Q95 `±0.8249°C` / 24 trees / 7 features.)* |
| **3. Sensor Failure Resilience (`R07` @ `11:00`)**<br>*(Page 2 · Vansh)* | At `11:00` (Step 24), Rack `R07` loses its physical sensor; THERMOS safely estimates temperature instead of flying blind. | Advance/scrub bottom clock to **`11:00`** -> click **`R07`** in 3D hall (or in the `R01–R12` switcher) | **3D `R07` blue-bordered badge (`~XX.X° Est`)** + **`RackInspector`** (`Hardware sensor offline — estimating from neighbors...`) | Show that `R07` highlights its **4 neighbor racks (`R02, R06, R08, R12`)** and widens its safety margin (`±1.20°C`). Toggle **`THERMOS Active`** off briefly if you want to show **`Offline · No direct reading`**, then turn AI back on. *Do NOT click `Show Actual Temp` inside `Technical details & validation` unless a judge asks to verify simulated accuracy.* |
| **4. Intelligent Operations & 108-Plan Testing**<br>*(Page 2 · Vansh)* | High outdoor heat + demand spike; THERMOS evaluates cooling & job placement plans (`Auto` vs `Ask Me`). | Click **`CORE`** directly in **3D** | **`THERMOS Core`** right-side panel + bottom-center **`MinimalSimControl`** (`Auto` / `Ask Me`) | Walk across the 4-step pipeline (**`Detect heat` → `Predict risk` → `Test 108 plans` → `Adjust ops`**), the **`45% Pinned` / `55% Flexible`** bar (+ `3 scheduled batch jobs (360 rack-min total)`), and live **Hot → Cool moves** (`R07 → R02`, etc.). To demo **`Ask Me`**, switch Approval Mode in the bottom pill -> **`Ask Me`**, advance +5m, and click **`Approve`** inside **`Plan Ready for Approval`**. Switch back to **`Auto`** afterward. |
| **5. Thermal Recovery & Experimental TEG**<br>*(Page 3 · Arjav)* | Capturing waste heat into a hydronic loop and modeling reuse potential without powering the data centre illegally. | Click **`HEAT RECOVERY`** in **3D** (or click **`Thermal Recovery`** inside **`THERMOS Core`**) | **`PathwayEquipmentPanel`** (`Thermal Recovery` view) + orange/emerald 3D heat & reuse flow ribbons | Point to the **4-Step Visual Flow** (**`Server Heat ≥38°C` → `Hydronic Coils` → `88% HX Exchange` → `Concept kWh_th`**). Explain that `kWh_th` models **conceptual external building pre-heating** (kept strictly separate from grid electricity `kWh`), and point out the separate **`Auxiliary TEG Experiment`** card (`W` / `0 W` in hot ambient weather). |
| **6. Live Performance Results (`Compound Stress`, `Sensor Failure`, `Severe Drought`)**<br>*(Page 3 · Vansh)* | Quantitative proof: overheating drops near zero, cooling water drops to 0 L, all batch jobs finish on time. | Click **`Results`** in the top-left lockup (or **`Results` / `Verified Evidence`** inside **`THERMOS Core`**) | **`TechnicalDrawers` → `Performance & Sustainability`** (live scenario) & **`Verified Evidence`** (full 6h verified scenarios) | On **`Performance & Sustainability`**, show the **4 Horizontal Comparison Bars** first (**Time Racks Spent Too Hot**, **Water Used**, **Grid Electricity**, **Batch Jobs Completed `360/360` · 0 missed**), then switch to **`Verified Evidence`** for the full 6-hour Engine v3.0.0 table (**Compound Stress**, **Sensor Failure**, **Severe Drought Cap**). Expand **`Technical details: full controller table & carbon accounting`** only if asked by judges. |
| **7. UN SDGs 9, 11 & 12 Alignment & Closing**<br>*(Page 3–4 · Arjav)* | Connecting THERMOS back to resilient digital infrastructure, sustainable cities, and water/energy stewardship. | Scroll to the **UN SDGs 9, 11 & 12** strip in **`Performance & Sustainability`**, OR close drawer (`Esc`) and click bottom-left **`HOPE '26 · UN SDGs`** | **Sustainability Impact strip** in `ControllerComparisonPage` + expandable **`HOPE '26 · UN SDGs`** badge at `bottom-3 left-[132px]` | Point to **SDG 9** (15-min prediction + R07 virtual sensing), **SDG 11** (zero cooling water in heatwaves + conceptual `88%` HX heat reuse), and **SDG 12** (`0.00 L` cooling water under drought/compound stress and `-2.3%` electricity in Severe Drought Cap). |

---

## 3. Script vs. Product Discrepancies & Recommended Corrections

The draft PDF (`ACTUAL_FINAL_SCRIPT.docx.pdf`) contains **5 concrete mismatches** against the verified **Engine v3.0.0** codebase. Adjust the spoken lines or Q&A answers as noted below so judges see complete agreement between spoken words and live numbers on screen:

1. **Random Forest Specification (`Page 2 Knowledge Box`)**
   - **Script says:** *"24-feature Random Forest"*
   - **Actual v3.0.0 Code (`model_metrics.json`):** **24 trees with 7 input features** (`[T_est, Load, Neighbors, SupplyTemp, EffectiveAirflow, AmbientTemp, Blockage]`), blended `28%` ML + `72%` physics ODE (`0.312°C` simulated MAE, `R² = 0.966`, `94.3%` empirical coverage, `±0.8249°C` conformal Q95 bound).
   - **Action:** Say *"24-tree Random Forest using 7 inputs"* instead of *"24-feature Random Forest."*

2. **Weather / Demand Controls vs. Scenario Presets (`Page 2 Bracket Cue`)**
   - **Script says:** *`[Increase outdoor temperature and computing demand.]` and `"THERMOS enters Ask Me approval mode"`*
   - **Actual UI Behavior:** The simulation does not expose arbitrary manual outdoor temperature or demand sliders; instead, **`Operating Condition`** presets (`Compound Stress`, `Sensor Failure`, `Severe Drought Cap`, `Normal Working Day`) drive calibrated deterministic stress trajectories, and **Approval Mode** defaults to **`Auto`** unless you switch it to **`Ask Me`** in the bottom-center control panel (`MinimalSimControl`).
   - **Action:** Switch between `Normal Working Day` and `Compound Stress` (or pre-stage `Compound Stress` at `10:45`–`11:00`), and explicitly toggle **`Ask Me`** in the bottom control drawer if you want to demonstrate manual approval.

3. **Benchmark Figures & Batch Job Count (`Page 3 Performance Results · Vansh`)**
   - **Script says:** *"220 over-limit rack-minutes vs 0"*, *"98.84 litres vs 0"*, *"All 360 computing jobs completed"*, *"+3.1% electricity"*
   - **Actual v3.0.0 Engine (`engine.ts` / `verified_benchmark.json`):**
     - `220 rack-min`, `98.84 L`, and `+3.1%` come from an **older v1.0.0 `sensor` archive** (`verified_benchmark.json`).
     - **Engine v3.0.0 Live Scenarios (always keep strictly separated):**
       - **Compound Stress (`compound`):** `910 → 20` rack-min vs No-Intervention (`-97.8%`; `520 → 20` vs Reactive; `0` violations after step 0), **`33.51 → 0.00 L` water (`-100%`)**, **`+1.6%` electricity** vs Reactive (`302.61 → 307.44 kWh` for dry fans).
       - **Sensor Failure (`sensor`):** `390 → 0` rack-min (`-100%`), **`98.12 → 0.00 L` water**, **`+3.6%` electricity** vs Reactive (`293.21 → 303.76 kWh`).
       - **Severe Drought Cap (`water`):** `195 → 0` rack-min (`-100%`), **`18.78 → 0.00 L` water**, **`-2.3%` electricity** vs Reactive (`309.94 → 302.76 kWh`).
     - **Batch Work:** It is **3 scheduled batch jobs (J1, J2, J3) totaling 360 rack-minutes** — not 360 individual jobs.
   - **Action:** Quote **`910 → 20` rack-min (`-97.8%`)** and **`33.5 → 0 L` (`-100%`)** when showing `Compound Stress`, or **`390 → 0` rack-min** and **`98.1 → 0 L`** when showing `Sensor Failure`, and say **"all 3 batch jobs (360 rack-minutes of work) finished on time."**

4. **Thermal Recovery & TEG Claims (`Page 3 Heat Recovery & SDG 11 · Arjav`)**
   - **Script says:** *"sustains THERMOS itself by using recovered energy to power its own monitoring equipment"* and *"SDG 11: Supplies recovered heat to nearby buildings"*
   - **Actual Engineering (`engine.ts`):**
     - **Hydronic Recovery (`kWh_th`, `88%` HX above `38°C`)** models **conceptual external building/district pre-heating potential** — there is no physical building connected, and `kWh_th` is never subtracted from electrical `kWh`.
     - **Seebeck TEG (`Wh`)** is strictly an **auxiliary experimental module** Carnot-bounded by ambient temperature (`0 W` during hot weather like Compound Stress/Sensor Failure when ambient temperature removes usable `ΔT`), and **does not power THERMOS**.
   - **Action:** Present Path A as *"captured thermal energy modeling potential building pre-heating"* and Path B TEG as *"an auxiliary low-ΔT experiment shown separately (yielding 0 W in extreme ambient heatwaves)."*

5. **SDG 12 Severe Drought Electricity Number (`Page 4 SDG 12 · Arjav`)**
   - **Script says:** *"Reduces electricity consumption by 2.2% during severe drought"*
   - **Actual v3.0.0 Output (`water` scenario):** **`2.3%` electricity reduction** (`309.94 kWh` Reactive → `302.76 kWh` THERMOS, `-2.32%`).
   - **Action:** Say **"2.3% less electricity during a severe drought cap."**

---

## 4. Transition & Live-Demo Cautions

- **Clicking `R07` directly in 3D or `THERMOS Core`:** `R07` (`rackId = 6`) is both the airflow-restricted rack and the `11:00` sensor-fault rack — ideal for immediate speaking transitions.
- **Avoid double-clicking `1x / 2x / 5x` speed without pausing:** When `Compound Stress` passes `15:00` (`Step 72`), the shift finishes (`Done`). Press **`Restart` (rotate icon)** inside the bottom pill to jump back to `09:00` at any time.
- **Keep `Technical details` collapsed during the main pitch:** Opening `Show Actual Temp`, the 8-row scoreboard table, or raw equations mid-pitch slows judges down; save them for Q&A or switch to **`Verified Evidence`** / **`Decision Log`** / **`Model & Physics`** tabs in the drawer if asked how the math works.

