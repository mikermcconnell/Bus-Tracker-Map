(function () {
  const platforms = window.PLATFORM_DATA || [];
  const map = document.querySelector('#platform-overlays');
  const directory = document.querySelector('#directory-rows');

  function routeBadge(service) {
    return `<b class="route ${service.theme || 'blue'}">${service.route}</b>`;
  }

  platforms.forEach((platform) => {
    const card = document.createElement('section');
    card.className = `platform platform--${platform.id}${platform.agency ? ` platform--${platform.agency}` : ''}${platform.wide ? ' platform--wide' : ''}`;
    card.dataset.state = platform.state;
    card.style.left = `${platform.x}%`;
    card.style.top = `${platform.y}%`;
    card.innerHTML = `
      <div class="platform-head"><b class="platform-no">${platform.name}</b><i class="state-dot"></i></div>
      <div class="routes">${platform.services.map(routeBadge).join('')}</div>
      <div class="platform-status">${platform.status}</div>`;
    map.appendChild(card);

    const row = document.createElement('div');
    row.className = `row${platform.state === 'here' ? ' active' : platform.state === 'arriving' ? ' arriving' : ''}`;
    row.innerHTML = `
      <div><strong>${platform.directoryName || platform.name}</strong><small>${platform.state === 'here' ? 'At platform' : platform.status}</small></div>
      <div>${platform.services.map((service) => `<div class="service">${routeBadge(service)}<span>${service.destination}</span></div>`).join('')}</div>`;
    directory.appendChild(row);
  });
})();
