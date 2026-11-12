# To do

- [ ] **P8 Ontario Northland label shows only "201".** On `/platform.map`, the P8 card on the map and the P8 row on the board show a single route number (201), which suggests 201 is the only Ontario Northland route serving Allandale. Other Ontario Northland routes stop here too. Show every route that serves P8, or a general "Ontario Northland" label instead of one route number. Start with `normalizeRoute()` in `server/terminal-layout.js` (agency `ontario-northland`) and wherever the board takes the label from the next trip's route.
