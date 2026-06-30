// Models that reject the `temperature` sampling param with a 400 (adaptive thinking only).
const NO_TEMPERATURE = [/opus-4-[78]/, /sonnet-5/, /fable/, /mythos/];

export function extractionTemperature(model: string): number | undefined {
  if (NO_TEMPERATURE.some((re) => re.test(model))) return undefined;
  return 0.2;
}
