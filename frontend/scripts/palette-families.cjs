// The Tailwind colour families that follow the theme. Shared by gen-palette.mjs and tailwind.config.js.
const FAMILIES = ["slate", "red", "orange", "amber", "yellow", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose"];
const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];

/** `{ emerald: { 50: "rgb(var(--tw-emerald-50) / <alpha-value>)", … }, … }` for the Tailwind config. */
function themedFamilies() {
  return Object.fromEntries(FAMILIES.map((family) => [family, Object.fromEntries(SHADES.map((shade) => [shade, `rgb(var(--tw-${family}-${shade}) / <alpha-value>)`]))]));
}

module.exports = { FAMILIES, SHADES, themedFamilies };
