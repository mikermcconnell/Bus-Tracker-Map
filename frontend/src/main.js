import { createDataClient } from './data/client.js';
import { createUiController } from './ui/controller.js';
import { createMapController } from './map/controller.js';

function bootstrap() {
  const dataClient = createDataClient();
  const ui = createUiController();
  const map = createMapController({ dataClient, ui });

  ui.init();

  map.initialize()
    .catch((err) => {
      ui.showBanner('routes', 'Failed to initialize map: ' + (err && err.message ? err.message : err));
      console.error('Failed to bootstrap map', err);
    });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
