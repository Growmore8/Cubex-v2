// A short, memorable "type-to-confirm" safe word for destructive actions.
// Pairs an adjective + noun (e.g. "BRAVE-FALCON") so it's creative but easy to
// copy. Client-side only (used in confirm dialogs).
const ADJ = ["BRAVE", "SWIFT", "CALM", "BOLD", "BRIGHT", "NOBLE", "ROYAL", "VIVID", "LUCKY", "QUIET", "MIGHTY", "AMBER", "COBALT", "CRIMSON", "GOLDEN"];
const NOUN = ["FALCON", "EMBER", "ORBIT", "RAVEN", "QUARTZ", "NIMBUS", "ZENITH", "CIPHER", "VORTEX", "ONYX", "PHOENIX", "GLACIER", "TEMPEST", "KRAKEN", "TITAN"];

export function randomConfirmWord(): string {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  return `${a}-${n}`;
}
