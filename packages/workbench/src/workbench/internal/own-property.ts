/** Define one JSON-shaped own key without invoking the legacy `__proto__` setter. */
export function defineOwnEnumerableProperty<T>(
  target: Record<string, T>,
  key: string,
  value: T,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}
