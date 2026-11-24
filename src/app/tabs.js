/**
 * Initialize sidebar tab navigation between workspace views.
 * Dispatches a resize event when returning to the 3D workbench so WebGL viewports re-measure.
 */
export function initNavigationTabs() {
  const buttons = Array.from(document.querySelectorAll('[data-tab-target]'));
  const panels = Array.from(document.querySelectorAll('[data-tab-panel]'));
  if (!buttons.length || !panels.length) return () => {};

  function activateTab(targetId) {
    for (const button of buttons) {
      const active = button.dataset.tabTarget === targetId;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    }
    for (const panel of panels) {
      const active = panel.dataset.tabPanel === targetId;
      panel.hidden = !active;
    }
    if (targetId === 'workbench') {
      window.dispatchEvent(new Event('resize'));
    }
  }

  function handleClick(event) {
    const button = event.currentTarget;
    activateTab(button.dataset.tabTarget);
  }

  for (const button of buttons) {
    button.addEventListener('click', handleClick);
  }

  return () => {
    for (const button of buttons) {
      button.removeEventListener('click', handleClick);
    }
  };
}
