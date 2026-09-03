(function () {
  const body = document.body;
  const menuButton = document.querySelector('.mobile-menu');
  const menuSheet = document.querySelector('.mobile-nav-sheet');
  const menuOverlay = document.querySelector('.menu-overlay');
  const menuClose = document.querySelector('.mobile-menu-close');
  const searchButton = document.querySelector('.search-pill');
  const searchDrawer = document.querySelector('.search-drawer');
  const searchClose = document.querySelector('.search-close');

  function openMenu() {
    if (!menuSheet || !menuOverlay || !menuButton) return;
    menuOverlay.hidden = false;
    requestAnimationFrame(function () {
      menuOverlay.classList.add('is-open');
      menuSheet.classList.add('is-open');
    });
    body.classList.add('menu-is-open');
    menuButton.setAttribute('aria-expanded', 'true');
    menuSheet.setAttribute('aria-hidden', 'false');
    if (menuClose) menuClose.focus();
  }

  function closeMenu() {
    if (!menuSheet || !menuOverlay || !menuButton) return;
    menuOverlay.classList.remove('is-open');
    menuSheet.classList.remove('is-open');
    body.classList.remove('menu-is-open');
    menuButton.setAttribute('aria-expanded', 'false');
    menuSheet.setAttribute('aria-hidden', 'true');
    window.setTimeout(function () { menuOverlay.hidden = true; }, 260);
  }

  function toggleSearch() {
    if (!searchDrawer || !searchButton) return;
    const opening = searchDrawer.hidden;
    searchDrawer.hidden = !opening;
    searchButton.setAttribute('aria-expanded', opening ? 'true' : 'false');
    if (opening) {
      const input = searchDrawer.querySelector('input[type="search"]');
      if (input) input.focus();
    }
  }

  if (menuButton) menuButton.addEventListener('click', openMenu);
  if (menuClose) menuClose.addEventListener('click', closeMenu);
  if (menuOverlay) menuOverlay.addEventListener('click', closeMenu);
  if (menuSheet) menuSheet.addEventListener('click', function (event) {
    if (event.target.closest('a')) closeMenu();
  });
  if (searchButton) searchButton.addEventListener('click', toggleSearch);
  if (searchClose) searchClose.addEventListener('click', toggleSearch);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      closeMenu();
      if (searchDrawer && !searchDrawer.hidden) toggleSearch();
    }
  });
})();

