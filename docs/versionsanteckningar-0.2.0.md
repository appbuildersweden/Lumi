# Lumi 0.2.0

Ett informationssystem som faktiskt når fram: skolan kan publicera nyheter och
viktiga meddelanden till hela skolan, till en klass eller till en grupp av
elever – och varje elev ser bara det som gäller dem.

## Information som når rätt person

Administratören och läraren publicerar information under **Information** och
**Meddelanden**. Varje post har en mottagare:

- **Alla** – hela skolan.
- **Alla elever** – samtliga elever.
- **En eller flera klasser** – till exempel 8A och 9B.
- **En grupp av elever** – enskilda elever, valda ur registret.
- **Alla lärare** – personalen.

Urvalet görs i backend, varje gång informationen läses. Rollen och klassen läses
ur skolans egen data, aldrig ur något gränssnittet skickar med. En elev i 9A ser
alltså sina egna poster och det som gäller alla – aldrig 8A:s.

## Vikt och prioritet

En post märks som **Normal**, **Viktig** eller **Akut**. Det akuta ligger överst
i listan, och märket syns både på kortet och i sammanfattningen på startsidan.
En viktig nyhet kan inte längre försvinna under nyare poster.

## Informationskort

Elevens informationsvy visar korten med rubrik, text, mottagare, vikt och vem
som publicerade den, med datum. Publicerarens namn sätts av backend ur
sessionen, så det går inte att skriva in ett annat namn.

## Läraren kan publicera – inom sina klasser

Behörigheten styrs av rollen, i en enda regel i backend:

- **Administratören** når hela skolan och kan ändra och ta bort allt.
- **Läraren** får publicera till de klasser den undervisar och till eleverna i
  dem. Klasserna läses ur skolans schema, så en lärare når aldrig en annan
  klass. En lärare ändrar och tar bort sina egna poster.
- **Eleven** läser bara, och ser bara det som gäller eleven eller elevens klass.

En inaktiverad lärare tappar behörigheten direkt, utan att starta om appen.

## Ändra och ta bort

En publicerad post kan ändras och tas bort från informationssidan och från
adminpanelen. Den som lade upp posten står kvar som publicerare även efter en
ändring.

## Ditt material ligger kvar

Ingen användardata rörs: konton, personer, roller, schema, uppgifter,
studiematerial, resultat och meddelanden ligger kvar precis som de var. Poster
som sparades innan mottagare och vikt fanns läses som **Alla** respektive
**Normal** och blir aldrig osynliga.

## Installation

Windows 10 eller 11 (64-bitars). Lumi installeras för den aktuella användaren
och kräver ingen administratörsbehörighet. Uppdateringen hämtas automatiskt av
en installerad Lumi – signaturen verifieras före installation, precis som förut.

Installationsfilen är inte signerad med ett kodsigneringscertifikat, så Windows
kan visa *Windows skyddade datorn* första gången. Välj då **Mer information**
och **Kör ändå**.
