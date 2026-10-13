# Lumi 0.1.2

Fyra saker som inte fungerade helt i 0.1.1: appikonen, informationen från
skolan, AI:n och en kontroll av uppdateringen. Den här versionen rättar dem.

## Appikonen

Ikonen var tidigare en beskuren bild av hela logotypen, vilket klippte av
ordmärket och gjorde ikonen suddig i små storlekar. Nu används Lumi-märket –
boken med stjärnan – i tio storlekar (16, 20, 24, 32, 40, 48, 64, 96, 128 och
256 px). Windows väljer själv den storlek som passar i aktivitetsfältet,
Start-menyn, skrivbordsgenvägen och installationsprogrammet.

## Information och meddelanden från skolan

Administratörens nyheter och meddelanden når nu fram. De visas dels på
startsidan under **Från skolan**, dels under **Information** och
**Meddelanden** i menyn. En nyhet har en mottagare – Alla, Elever eller
Lärare – och backend avgör vad varje konto får läsa. En elev ser alltså bara
det som gäller elever, och en lärare bara det som gäller lärare.

## AI:n fungerar för alla

Nyckeln till OpenRouter fanns tidigare bara i miljövariabler, vilket gjorde att
AI:n inte fungerade i en installerad Lumi på en vanlig dator. Nu går alla
AI-frågor till Lumis egen tjänst, och nyckeln ligger som en hemlighet där. Den
finns varken i appen, i installationsfilen eller på elevens dator.

Om kontot inte kan använda standardmodellerna byter Lumi automatiskt till en
gratismodell och fortsätter svara. En diskret rad berättar då att svaret kommer
från en gratismodell – svaret ser aldrig ut att komma från en modell det inte
kom från. Annars gäller samma som förut: tydliga felmeddelanden på svenska i
stället för en krasch, och inga upprepade försök när felet inte går att försöka
om.

## Uppdateringar

Uppdateringskedjan är oförändrad och verifierad: en installerad Lumi upptäcker
en nyare version, laddar ner den, kontrollerar signaturen och installerar. En
signatur som inte stämmer avbryter allt.

## Ditt material ligger kvar

Ingen användardata rörs: konton, personer, schema, uppgifter, studiematerial,
resultat och inställningar ligger kvar precis som de var.

## Installation

Windows 10 eller 11 (64-bitars). Lumi installeras för den aktuella användaren
och kräver ingen administratörsbehörighet.

Har du 0.1.0 installerad måste den här versionen installeras manuellt en gång:
0.1.0 kan bara upptäcka en ny version, inte installera den. Från 0.1.1 och
framåt sköter Lumi uppdateringarna själv.

Installationsfilen är inte signerad med ett kodsigneringscertifikat, så Windows
kan visa *Windows skyddade datorn* första gången. Välj då **Mer information**
och **Kör ändå**.
