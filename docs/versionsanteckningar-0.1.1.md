# Lumi 0.1.1

Uppdateringar som sköter sig själva, din logga som appikon och en inloggning som
hålls kvar.

## Automatiska uppdateringar

Lumi kontrollerar vid start om en nyare version finns, laddar ner den i
bakgrunden och installerar den. Signaturen verifieras alltid mot den publika
nyckeln innan något installeras – går den inte att verifiera avbryts
uppdateringen och Lumi kör vidare precis som förut. Ingen behöver besöka
webbplatsen eller köra en installationsfil själv.

Under en pågående session installeras inget: en omstart mitt i arbetet vore ett
avbrott. En ny version som hittas medan Lumi är öppet installeras i stället vid
nästa start.

## Lumi-loggan som appikon

Loggan används nu som appikon i fönstret, i aktivitetsfältet, i Start-menyn, på
skrivbordsgenvägen och i installationsprogrammet – överallt där Windows visar
en appikon.

## Håll mig inloggad

Ett nytt kryss på inloggningssidan: **Håll mig inloggad**. Sessionen sparas
krypterad med Windows egen skyddade lagring, bara läsbar för den Windows-användare
som loggade in, och återställs vid nästa start. Lösenordet sparas aldrig.
Utloggning tar bort den sparade sessionen, och ett inaktiverat konto eller ett
ändrat lösenord gör att sessionen inte längre gäller.

## Tydligare namn i adminpanelen

Kategorierna heter nu Översikt, Elevhantering, Personalhantering,
Kontohantering, Behörigheter, Schemahantering och Uppgiftshantering. Samma sju
sidor som förut, i samma ordning, med samma innehåll.

## Ditt material ligger kvar

Uppdateringen rör ingen användardata: konton, studiematerial, resultat och
inställningar ligger kvar precis som de var.

## Installation

Windows 10 eller 11 (64-bitars). Lumi installeras för den aktuella användaren
och kräver ingen administratörsbehörighet.

Installationsfilen är inte signerad med ett kodsigneringscertifikat, så Windows
kan visa *Windows skyddade datorn* första gången. Välj då **Mer information**
och **Kör ändå**.
