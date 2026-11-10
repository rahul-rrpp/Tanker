# TankerLink mobile app

One Expo app (`mobile/`) for three kinds of user. After sign-in the app opens the right experience from the user's role; a user cannot open another role's screens.

| Who | Roles | Screens |
| --- | --- | --- |
| Customer (company) | COMPANY_ADMIN, COMPANY_USER | Home dashboard, bookings (list, detail, cancel), **new booking** (place search, product, quote, submit), offers (accept / counter / reject), trips with live tracking, notifications, account |
| Transporter | AGENCY_OWNER, AGENCY_STAFF | Dashboard, marketplace (accept or counter a booking), offers (respond / withdraw), trips (assign tanker and driver, track, report delay or emergency, complete), fleet and drivers, account |
| Driver | DRIVER | Current trip, one-tap status steps (confirm → pickup → loading → transit → delivery → unloading → submit), navigation to pickup/delivery, call contacts, delivery proof and slips by camera or file, **background live location**, emergency alert, trip history, licence details |

Sign-in: mobile number + password, or one-time code (drivers usually use the code). Registration and online payments open the web app (`EXPO_PUBLIC_WEB_URL`). Drivers are added by their transporter.

## Run

```bash
cd mobile
cp .env.example .env   # set EXPO_PUBLIC_API_URL / EXPO_PUBLIC_WEB_URL
npm install
npx expo start         # Expo Go works for everything except background location
```

Demo logins (after `npm run db:seed`, `db:seed:transporter`): customer `9100000001`, transporter `9200000001` (password `Demo@12345`), driver `9200000011` (one-time code; with `OTP_DEV_ECHO=true` the code is shown in the API response).

## Background location (driver)

- The app asks for permission when the driver confirms a trip, or when they tap **Share live location**. Sharing is only possible while the trip is between assignment and delivery; it stops itself after that, on sign-out, or if the server answers 409.
- Points are sampled every 30 s / 50 m, queued on the phone (up to 2000) and sent in batches of 200 to `POST /driver/me/trips/:id/location`, so dead zones don't lose the track.
- Android shows a persistent "sharing trip location" notification (foreground service). Choosing "Allow all the time" is needed for sharing with the screen locked; otherwise sharing is foreground-only and the app says so.
- **Background location does not run in Expo Go.** Use a development or store build: `npx expo run:android` or `eas build`.

## Maps

Trip screens show the tanker's last position and open Google Maps / Apple Maps for the route and turn-by-turn navigation. There is no embedded map in the app.

## Checks

```bash
npx tsc --noEmit
npx expo export --platform android   # bundles the whole app
```

## Code structure

Screens live in `src/features/<feature>/screens/`; `app/` only holds Expo Router route files that re-export them. API paths are in `src/services/api/endpoints.ts`, route paths in `src/navigation/routes.ts`, colours and styles in `src/theme/`. See [mobile/REFACTORING_REPORT.md](../mobile/REFACTORING_REPORT.md).
