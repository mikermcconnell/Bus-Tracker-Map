const options = {
  a: {
    name: 'Option A · Agency halo + code',
    title: 'Use an agency halo and short code',
    copy: 'Keep the circle and route number people already understand. Add a consistent agency-colour ring and a small agency code so colour is never the only identifier.',
    points: [
      "Preserves each provider's published route colour",
      'Works at the current 44 px marker size',
      'Still understandable for colour-blind riders',
    ],
  },
  b: {
    name: 'Option B · Different shapes',
    title: 'Give each agency a marker shape',
    copy: 'Use circles for Barrie, shields for LINX, rounded squares for GO, and hexagons for Ontario Northland. The silhouette remains visible when markers overlap.',
    points: [
      'Very fast to distinguish at a distance',
      'Does not depend on text or colour',
      'More visual variation makes the map feel busier',
    ],
  },
  c: {
    name: 'Option C · Logo flags',
    title: 'Pair every route number with its agency logo',
    copy: 'Use a compact white flag containing the provider logo and route number. This is the clearest branding treatment, but it occupies the most map space.',
    points: [
      'Immediate provider recognition',
      'Best match with the branded sidebar',
      'Can overlap nearby vehicles at Barrie zoom levels',
    ],
  },
};

const tabs = Array.from(document.querySelectorAll('.option-tab'));
const name = document.getElementById('option-name');
const title = document.getElementById('decision-title');
const copy = document.getElementById('decision-copy');
const points = document.getElementById('decision-points');

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const key = tab.dataset.view;
    const option = options[key];
    document.body.className = `view-${key}`;
    tabs.forEach((item) => {
      const active = item === tab;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    name.textContent = option.name;
    title.textContent = option.title;
    copy.textContent = option.copy;
    points.replaceChildren(...option.points.map((point) => {
      const item = document.createElement('li');
      item.textContent = point;
      return item;
    }));
  });
});
