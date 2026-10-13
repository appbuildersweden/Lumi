/**
 * Lumi-logotypen. Filen är 1536×1024 med tomrum runt motivet, så bakgrundsbilden
 * skalas och förskjuts för att beskära bort tomrummet – samma förhållanden som
 * skrivbordsappen använder, i de storlekar webbplatsen behöver.
 */
export function Logo({
  size = "header",
  decorative = false,
}: {
  size?: "header" | "footer" | "mock";
  decorative?: boolean;
}) {
  return (
    <span
      className={`logo logo--${size}`}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "Lumi"}
      aria-hidden={decorative ? "true" : undefined}
    />
  );
}
