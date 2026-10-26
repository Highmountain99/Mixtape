# 📼 Mixtape

En liten sajt där ett kompisgäng turas om att dela en Spotify-spellista varje vecka.

- **Överst:** veckans mixtape som Spotify-spelare (med omslag).
- **Under:** alla tidigare veckor, fyra per rad.
- **Din vecka:** klistra in länken (det finns en "Klistra in"-knapp) → förhandsvisning → Publicera.
- **Admin:** bjud in vänner, ändra turordningen, sätt startvecka, lägg till missade veckor och ta bort mixtapes.

Det är en statisk sajt (HTML/CSS/JS, inget byggsteg) som använder [Supabase](https://supabase.com) för inloggning och databas, och som kan hostas gratis på GitHub Pages.
Innan `config.js` är ifylld körs sajten i **demoläge** med påhittade data, så att du kan se hur den ser ut.

## Hur turordningen fungerar

Medlemmarna står i en lista (Admin → Rotation). Vecka 1 är startveckan, och sedan går turen ett steg ner i listan varje måndag (svensk tid) och börjar om när listan är slut.
Bara den vars tur det är kan publicera den här veckan och byta sin länk under veckan; det kontrolleras i databasen. Admin kan alltid lägga till, byta och ta bort.

Den som har veckan behåller den när du lägger till, tar bort eller flyttar folk i listan; ändringen syns från nästa vecka. (Tar du bort den som har veckan går turen till nästa person.) Sparar du en ny startvecka börjar rotationen om från toppen av listan.

## Kom igång

### 1. Skapa ett Supabase-projekt
Skapa ett gratis projekt på [supabase.com](https://supabase.com).

### 2. Skapa databasen
1. Öppna `supabase/schema.sql` och byt `din@email.se` och namnet längst ner till dina egna uppgifter.
2. I Supabase: **SQL Editor → New query**, klistra in hela filen och kör.

### 3. Ställ in inloggningen
Under **Authentication → URL Configuration**:
- **Site URL:** `https://highmountain99.github.io/Mixtape/`
- **Redirect URLs:** lägg till `https://highmountain99.github.io/Mixtape/` och `http://localhost:8000/`

Valfritt men rekommenderat: under **Authentication → Email Templates → Magic Link**, lägg till koden i mejlet, t.ex. `<p>Eller skriv in koden: {{ .Token }}</p>`.
Då kan man logga in med koden om länken öppnas i fel webbläsare (vanligt på mobilen).

> Supabases inbyggda mejlutskick är begränsat till ett fåtal mejl per timme. För ett kompisgäng räcker det oftast; vill du ha mer kan du koppla in egen SMTP under **Authentication → Emails**.

### 4. Koppla sajten till Supabase
Under **Project Settings → API**, kopiera **Project URL** och **anon/publishable key** till `config.js`.
Nyckeln är tänkt att vara publik; det är reglerna (RLS) i databasen som skyddar datan.

### 5. Publicera på GitHub Pages
I repot på GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**, välj `main` och `/ (root)`.
Efter någon minut ligger sajten på `https://highmountain99.github.io/Mixtape/`.

### 6. Bjud in vänner
Logga in, klicka **Admin**, lägg till namn och e-post för varje vän och tryck ✉ för att kopiera en inbjudan att skicka till dem.
De loggar in med sin e-post (inget lösenord). Den som loggar in utan att vara inbjuden ser ingenting.

## Köra lokalt

```bash
python3 -m http.server 8000
```

Öppna sedan http://localhost:8000.

## Filer

| Fil | Vad |
|---|---|
| `index.html` | Sidans skal |
| `styles.css` | Utseendet |
| `app.js` | All logik: inloggning, turordning, inklistring, admin, demoläge |
| `config.js` | Supabase-URL och nyckel |
| `supabase/schema.sql` | Tabeller, regler (RLS) och första admin |
