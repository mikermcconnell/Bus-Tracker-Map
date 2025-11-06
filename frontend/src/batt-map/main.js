import { createDataClient } from '../data/client.js';
import { createBattMapController } from './controller.js';

function bootstrap() {
  const dataClient = createDataClient();
  const battMap = createBattMapController({ dataClient });
  battMap.initialize().catch((err) => {
    console.error('Failed to initialize BATT platform map:', err);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
