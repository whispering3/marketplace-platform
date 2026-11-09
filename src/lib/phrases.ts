/**
 * OLYMPUS - Anti-Phishing Phrase Generator
 * Generates a unique, memorable 3-word phrase for each user at registration.
 * This phrase is permanently tied to the account and displayed on every login,
 * allowing the user to verify they are on the legitimate site.
 */

const ADJECTIVES = [
  "silent", "frozen", "crimson", "hollow", "ancient", "broken", "golden",
  "rustic", "haunted", "silver", "burning", "hidden", "distant", "shadowed",
  "velvet", "iron", "pale", "dark", "obsidian", "steel", "faded", "bitter",
  "solemn", "midnight", "scarlet", "stone", "lost", "fierce", "blind", "hollow"
];

const NOUNS = [
  "cipher", "dagger", "lantern", "forest", "signal", "anchor", "ember",
  "raven", "specter", "bridge", "tower", "canyon", "mirror", "throne",
  "atlas", "vault", "oracle", "citadel", "phantom", "nexus", "harbor",
  "summit", "labyrinth", "sentinel", "eclipse", "void", "covenant", "forge",
  "archive", "obelisk"
];

const VERBS = [
  "falls", "burns", "waits", "echoes", "fades", "rises", "sleeps",
  "watches", "drifts", "remains", "endures", "hides", "hunts", "persists",
  "breathes", "stands", "flows", "lingers", "strikes", "circles"
];

export function generateAntiPhishingPhrase(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const verb = VERBS[Math.floor(Math.random() * VERBS.length)];
  return `${adj} ${noun} ${verb}`;
}
