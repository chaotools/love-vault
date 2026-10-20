export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export function nextFocusIndex(length, currentIndex, backwards = false) {
  if (!length) return -1;
  if (currentIndex < 0 || currentIndex >= length) return backwards ? length - 1 : 0;
  return backwards
    ? (currentIndex - 1 + length) % length
    : (currentIndex + 1) % length;
}
