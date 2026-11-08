/* Shared niceties for the static secondary pages. */
(() => {
  'use strict';
  const copyright = document.getElementById('copyright');
  if (copyright) copyright.textContent = `© ${new Date().getFullYear()} Keemz Audio Lab`;
})();
