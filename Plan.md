# Mini Map Feature Plan

**Overall Progress:** `100%`

## Tasks:

- [x] 🟩 **Step 1: Layout scaffolding**
  - [x] 🟩 Add inset map container in `index.html` and apply base styles (≈20% screen, bottom-left)
  - [x] 🟩 Implement responsive rules to collapse/disable inset on tight viewports

- [x] 🟩 **Step 2: Secondary map initialization**
  - [x] 🟩 Create Leaflet mini-map instance with static terminal-focused view and decorative border
  - [x] 🟩 Share tile configuration and legend visibility hooks with main map context

- [x] 🟩 **Step 3: Vehicle rendering pipeline**
  - [x] 🟩 Extend vehicle updates to mirror live vehicles on the inset without clustering
  - [x] 🟩 Respect route visibility toggles while filtering to terminal vicinity only

- [x] 🟩 **Step 4: Terminal highlighting linkage**
  - [x] 🟩 Draw matching border/overlay on main map around the terminal to visually pair with the inset
  - [x] 🟩 Ensure both borders respond to layout collapse states

- [x] 🟩 **Step 5: Validation**
  - [x] 🟩 Smoke-test desktop and mobile layouts
  - [x] 🟩 Verify legend toggles, vehicle updates, and responsive collapse behave as expected
