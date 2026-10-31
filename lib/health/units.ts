// Temperatures are stored and compared in Celsius (Fitbit's sleep temperature
// is a difference from its own baseline) and shown in Fahrenheit.

// A Celsius difference as a Fahrenheit one: +0.5 → "+0.9°F".
export function fahrenheitDelta(celsius: number) {
  const fahrenheit = celsius * 1.8;
  return `${fahrenheit >= 0 ? "+" : ""}${fahrenheit.toFixed(1)}°F`;
}
