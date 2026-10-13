# Lumi – webbplatsen

Lumis webbplats: startsida, funktioner, så fungerar Lumi, nedladdning och om
Lumi. Den är ett **eget projekt**, skilt från skrivbordsappen i repo-roten, och
bygger helt statiska filer med React och Vite.

Ingen inloggning, ingen databas och ingen AI finns här. De delarna ligger i
skrivbordsappen.

## Köra lokalt

```bash
cd website
npm install
npm run dev      # utvecklingsserver
npm run build    # typkontroll + bygge till website/dist
npm run preview  # visa det färdiga bygget lokalt
```

## Innehåll och text

All text, navigering, funktionskort, stegen och nedladdningsuppgifterna ligger i
`src/content.ts`. Ändra där i stället för i komponenterna.

## Nedladdningen

Installationsfilen finns inte ännu, och därför visas en inaktiverad knapp med
texten **Kommer snart** – aldrig en länk som inte leder någonstans.

När `.exe`-filen är byggd och uppladdad: öppna `src/content.ts` och sätt

```ts
export const DOWNLOAD: DownloadInfo = {
  available: true,
  url: "https://…/Lumi_0.1.0_x64-setup.exe",
  version: "0.1.0",
  requirements: ["Windows 10 eller 11 (64-bitars)"],
  steps: ["Hämta filen", "Kör installationsprogrammet", "Starta Lumi"],
};
```

Sektionen visar då en riktig nedladdningsknapp samt systemkrav och
installationssteg. Ingen annan ändring behövs.

## Publicera på Cloudflare Pages

Filen `wrangler.toml` är förberedd. Samma uppgifter anges i
Cloudflare Pages-gränssnittet om bygget sker där:

| Inställning | Värde |
| --- | --- |
| Byggkommando | `npm run build` |
| Utmapp | `dist` |
| Rotmapp | `website` |

Med Wrangler i stället:

```bash
cd website
npm run build
npx wrangler pages deploy dist
```

`public/_headers` sätter säkerhetsrubriker och cachning. Sidan har inga
klientsidor, så ingen omdirigering till `index.html` behövs.

**Publicering sker först efter godkännande.** Ingen uppladdning är gjord.

## Struktur

```
website/
  index.html            sidans skal och metadata
  wrangler.toml         förberett för Cloudflare Pages
  public/
    lumi-logo.png       logotypen, nedskalad till 384×256 (60 kB)
    _headers            säkerhetsrubriker och cachning
  src/
    main.tsx            startpunkt
    App.tsx             avsnitten i ordning
    content.ts          all text och alla uppgifter
    styles/site.css     design, färger och anpassning
    components/
      Header.tsx        toppmeny med mobilmeny
      Hero.tsx          rubrik, knappar och förhandsvisning
      AppPreview.tsx    ritad illustration av appens gränssnitt
      Features.tsx      funktionskorten
      HowItWorks.tsx    de tre stegen
      Download.tsx      nedladdningen
      About.tsx         om Lumi
      Footer.tsx        sidfoten
      Logo.tsx          logotypen, beskuren med CSS
      Reveal.tsx        in-toning vid skroll
```

## Design

Samma identitet som appen: rosé, plum och vitt, typsnittet Plus Jakarta Sans,
rundade kort och mjuka skuggor. Färgerna ligger som variabler högst upp i
`src/styles/site.css`. Sidan är responsiv och respekterar
`prefers-reduced-motion`.
