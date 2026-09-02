// Apply the saved theme before the app module renders to avoid a light/dark flash.
try {
  let theme = localStorage.getItem('vault-theme');
  if (!theme) theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
} catch (e) {
  // Storage can be unavailable in hardened/private browser contexts.
}
