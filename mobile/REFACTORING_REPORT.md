# Mobile app refactoring report

Date: 10 November 2026. Scope: `mobile/` (TankerLink app for companies, transporters and drivers).

The goal was a feature-based structure without changing UI, business logic, API contracts, routes or libraries. Every screen still renders the same markup, sends the same requests and lives at the same route.

## 1. What the app was

| Item | Finding |
| --- | --- |
| Platform | Expo SDK 54, managed workflow (no `android/` or `ios/` folders), React Native 0.81, React 19, New Architecture on |
| Navigation | **expo-router 6** (file-based). Every file in `app/` is a route; layouts use Stack and Tabs |
| Language | TypeScript, `strict: true`, path alias `@/* → src/*` |
| State | React context for auth (`AuthProvider`); a small `useQuery` hook for server data; no global store |
| HTTP | axios with a bearer token, single-flight refresh and secure-store refresh token |
| Lint / tests | No ESLint config and no test files or test runner |

**Problems found**

- **Screens lived in `app/`.** 37 of the 41 route files held full screen code (up to 155 lines) next to routing.
- **Two catch-all component files.** `components/ui.tsx` (232 lines) and `components/kit.tsx` (217 lines) mixed buttons, inputs, layout, modals, style sheets and helper functions (`callPhone`, `openMaps`, `markRead`, `toneFor`).
- **API calls inline.** 85 API calls used hard-coded paths directly inside screens and components; nothing listed the endpoints in one place.
- **Route files importing route files.** `transporter/market/[id]` imported a type from `transporter/(tabs)/market`; `transporter/offer/[id]` imported a constant from `transporter/(tabs)/offers`.
- **Misplaced pieces.** `useCountdown` was exported from `RegistrationOtp.tsx`; `API_URL`, device info and error parsing were inside the axios client; `WEB_URL` was declared in the sign-up screen.
- **Hand-typed paths.** 26 navigation calls typed their route paths by hand.
- **Scattered colours.** 13 colour literals outside the theme (`'#fff'`, `'#17559a'`, `'#dbeafe'`); `ui.tsx` and `kit.tsx` each had their own style sheet.
- **Dead code.** `simpleSignupSchema`, `changePasswordSchema` and `INDIAN_STATES` had no users.

## 2. New structure

```
mobile/
├── app/                          Expo Router routes: one-line re-exports, paths unchanged
├── src/
│   ├── navigation/               RootNavigator (auth gate), AuthNavigator, MainNavigator,
│   │                             RoleNavigators (role stacks and tab bars), routes.ts (ROUTES, tab definitions)
│   ├── providers/                AppProviders (SafeArea + Auth)
│   ├── components/
│   │   ├── ui/                   Button, Field/PasswordField, Banner, Card, Row, Pill, Stats, Chips,
│   │   │                         ChoiceChips, SectionTitle, LinkText, Logo
│   │   ├── layout/               Screen + Heading (form screens), Page (role app pages)
│   │   ├── common/               QueryState, ActionButton, PromptModal, PickerModal
│   │   └── forms/                FormField (react-hook-form), OtpCodeInput
│   ├── features/
│   │   ├── auth/                 screens (9), components (RegistrationOtp, TwoPhaseSignup), context (AuthContext),
│   │   │                         services (authService), utils (experienceOf, homeRouteFor), validation (zod schemas)
│   │   ├── account/              ProfileScreen, PendingVerificationScreen, AccountScreen component
│   │   ├── notifications/        NotificationsScreen, notificationsService
│   │   ├── company/              8 screens, CompanyOfferCard, companyService, types
│   │   ├── transporter/          8 screens, transporterService, types, constants
│   │   └── driver/               4 screens, driverService, locationTracking (background GPS), types
│   ├── services/
│   │   ├── api/                  client (axios + refresh), config, endpoints (every path), errors, upload
│   │   ├── domain/               offersService, tripsService (shared by company and transporter)
│   │   └── storage/              tokenStorage (secure store + in-memory access token)
│   ├── hooks/                    useQuery, useBackHandler/useExitOnBack, useCountdown
│   ├── theme/                    colors, metrics (radius, spacing, type sizes), styles (formStyles, pageStyles)
│   ├── constants/                roles (labels, role groups)
│   ├── types/                    auth types, UI types (IconName, Tone)
│   └── utils/                    format, linking (call, maps), status (toneFor), pickFile
```

104 source files; the largest is 155 lines.

**Differences from the suggested layout, and why**

1. **`src/navigation/` instead of `src/app/navigation/`.** Expo Router uses `src/app/` as the routes folder whenever it exists, and checks it before the root `app/`. I confirmed this in `@expo/cli` (`getRouterDirectory`). A `src/app/` folder would have turned every navigator and provider file into a route and broken the app. Providers are in `src/providers/` for the same reason.
2. **No React Navigation `*Navigator` trees.** Expo Router builds navigation from `app/`, and the brief said not to change the navigation library. The navigator files hold what the layouts used to contain (auth gate, stacks, tab bars), and `app/**/_layout.tsx` re-exports them.
3. **Features follow the app's real modules.** These are auth, account, notifications, company, transporter and driver. The app is organised by user role, not by tankers/drivers/trips: tankers and drivers appear only inside the transporter app, and trips appear in all three. Trip and offer calls shared across roles live in `services/domain/`.
4. **No `assets/` folder.** The app has no image, icon or font files (the logo is drawn with views), so I created no empty folders.

## 3. Files moved and renamed

Every `app/` route file kept its path and now contains only `export { default } from '@/…'`.

| Route (unchanged) | Screen now in `src/features/…` |
| --- | --- |
| `index` | `auth/screens/LaunchScreen` |
| `(auth)/welcome`, `login`, `forgot-password`, `verify-otp` | `auth/screens/WelcomeScreen`, `LoginScreen`, `ForgotPasswordScreen`, `VerifyOtpScreen` |
| `(auth)/signup/index`, `agency`, `driver`, `customer` | `auth/screens/SignupScreen`, `AgencySignupScreen`, `DriverSignupScreen`, `CustomerSignupScreen` |
| `(app)/profile`, `pending-verification` | `account/screens/ProfileScreen`, `PendingVerificationScreen` |
| `(app)/notifications` | `notifications/screens/NotificationsScreen` |
| `company/(tabs)/index`, `bookings`, `offers`, `trips`, `account` | `company/screens/CompanyHomeScreen`, `CompanyBookingsScreen`, `CompanyOffersScreen`, `CompanyTripsScreen`, `CompanyAccountScreen` |
| `company/booking/[id]`, `new-booking`, `trip/[id]` | `company/screens/BookingDetailScreen`, `NewBookingScreen`, `CompanyTripDetailScreen` |
| `transporter/(tabs)/index`, `market`, `offers`, `trips`, `account` | `transporter/screens/TransporterHomeScreen`, `MarketplaceScreen`, `TransporterOffersScreen`, `TransporterTripsScreen`, `TransporterAccountScreen` |
| `transporter/market/[id]`, `offer/[id]`, `trip/[id]` | `transporter/screens/MarketBookingScreen`, `TransporterOfferDetailScreen`, `TransporterTripDetailScreen` |
| `driver/(tabs)/index`, `trips`, `account`, `driver/trip/[id]` | `driver/screens/DriverHomeScreen`, `DriverTripsScreen`, `DriverAccountScreen`, `DriverTripDetailScreen` |
| `_layout`, `(auth)/_layout`, `(app)/_layout` | `src/navigation/RootNavigator`, `AuthNavigator`, `MainNavigator` |
| `company/_layout`, `transporter/_layout`, `driver/_layout`, `*/(tabs)/_layout` | `src/navigation/RoleNavigators` (`RoleStack`, `CompanyTabs`, `TransporterTabs`, `DriverTabs`) |

Each default-exported component is now named after its file (for example `Login` became `LoginScreen`, and `Account` became `CompanyAccountScreen` or `TransporterAccountScreen`).

| Old file | New location |
| --- | --- |
| `src/api/client.ts` | `src/services/api/client.ts`, `config.ts`, `errors.ts` |
| `src/auth/AuthContext.tsx` | `src/features/auth/context/AuthContext.tsx` |
| `src/auth/tokenStorage.ts` | `src/services/storage/tokenStorage.ts` |
| `src/lib/theme.ts` | `src/theme/colors.ts`, `metrics.ts` |
| `src/lib/types.ts` | `src/types/auth.ts`, `src/constants/roles.ts`, `src/features/auth/utils/experience.ts` |
| `src/lib/format.ts` | `src/utils/format.ts` |
| `src/lib/useQuery.ts`, `useBackHandler.ts` | `src/hooks/` |
| `src/lib/validation.ts` | `src/features/auth/validation/schemas.ts` |
| `src/components/ui.tsx` | `components/ui/*`, `components/layout/Screen.tsx`, `theme/styles.ts` (`formStyles`) |
| `src/components/kit.tsx` | `components/ui/*`, `components/layout/Page.tsx`, `components/common/*`, `utils/linking.ts`, `utils/status.ts`, `theme/styles.ts` (`pageStyles`), notifications service |
| `src/components/nav.tsx` | `src/navigation/RoleNavigators.tsx` |
| `src/components/upload.ts` | `src/utils/pickFile.ts` and `src/services/api/upload.ts` |
| `src/components/FormField.tsx`, `OtpCodeInput.tsx` | `src/components/forms/` |
| `src/components/Logo.tsx` | `src/components/ui/Logo.tsx` |
| `src/components/RegistrationOtp.tsx`, `TwoPhaseSignup.tsx` | `src/features/auth/components/` (`useCountdown` moved to `src/hooks/`) |
| `src/components/Account.tsx` | `src/features/account/components/AccountScreen.tsx` |
| `src/components/CompanyOffer.tsx` | `src/features/company/components/CompanyOfferCard.tsx` |
| `src/driver/location.ts`, `types.ts` | `src/features/driver/services/locationTracking.ts`, `src/features/driver/types.ts` |

## 4. Components extracted

- **From `ui.tsx` and `kit.tsx`, one component per file:** Button, Field, PasswordField, Banner, ChoiceChips, LinkText, Card, Row, Pill, Stats, SectionTitle, Chips, Screen/Heading, Page, QueryState, ActionButton, PromptModal, PickerModal. Each folder has an `index.ts`, so imports read `import { Button, Card } from '@/components/ui'`.
- **Out of screens:**
  - `MarketCard` type → `features/transporter/types.ts`
  - `OFFER_LABEL` → `features/transporter/constants.ts`
  - `CompanyTrip` type → `features/company/types.ts`
- **Duplicate code removed:**
  - the inline `useCountdown` in `RegistrationOtp.tsx`, now in `hooks/`
  - two separate style sheets, now `theme/styles.ts`
  - repeated colour literals, now theme tokens
  - the two route-to-route imports
  - three unused validation exports (`simpleSignupSchema`, `changePasswordSchema`, `INDIAN_STATES`; grep confirmed no users)

**Not merged, on purpose:** `ProfileScreen` keeps its own local `Section` and `Row`. They have different spacing from the shared `Row`, and merging them would change how the screen looks.

## 5. Navigation

- **Routes unchanged:** all 41 route files are at their original paths. URLs, `[id]` parameters, groups `(auth)`, `(app)` and `(tabs)`, the `ttms://` scheme, and the auth gate's redirect rules are unchanged.
- **One place for paths:** `src/navigation/routes.ts` holds `ROUTES` (every path, with builders for detail screens), `RouteParams`, and the three tab definitions. All 26 hand-typed paths in `router.push`, `router.replace` and `href` now use `ROUTES`, which produce the same strings.
- **Splash and background GPS:** the splash-screen handling and the background-location task registration stay at app start in `RootNavigator`. `expo-task-manager` requires the task to be defined before any screen mounts.

## 6. API organisation

- **`services/api/config.ts`:** `API_URL` and `WEB_URL` (from `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_WEB_URL`), timeout, device info and client headers. No secrets exist in the app.
- **`services/api/endpoints.ts`:** every backend path, with builders that produce exactly the old query strings.
- **`services/api/client.ts`:** the axios instance, bearer token, single-flight refresh and revoked-session handling. The logic is moved unchanged.
- **Feature services:** `authService`, `notificationsService`, `companyService`, `transporterService`, `driverService`, and the shared `offersService` and `tripsService`. Each function wraps one request with the same method, path and body, and returns the axios response unchanged, so screens still read `data.data`. Where a screen sent `{}` or no body, it still does.
- **Reads:** reads stay on `useQuery(ENDPOINTS.…)`, so loading, error, refresh and polling behave as before.
- **Result:** no screen or component imports `api` directly any more, and no API path appears outside `endpoints.ts`.

## 7. Theme

- **`theme/colors.ts`:** the original palette plus tokens for values that were repeated as literals: `white`, `placeholder`, `neutralBg`, `backdrop`, `brandTint`. Every new token has exactly the value it replaced.
- **`theme/metrics.ts`:** `radius` (field, card, sheet, pill), the `space()` scale, and `typography` sizes for titles, sections, labels and captions, taken from the existing styles.
- **`theme/styles.ts`:** `formStyles` and `pageStyles`, copied value for value from the old `ui.tsx` and `kit.tsx` sheets.
- **Result:** no colour literal remains outside `src/theme/`. The UI was not redesigned.

## 8. Dependencies

None added or removed. The circular-import check was a short Node script run once from outside the project, not a package.

## 9. Validation results

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` (strict) | Passes, 0 errors |
| `tsc --noUnusedLocals --noUnusedParameters` (stricter than the project config) | Passes, 0 errors; 22 now-unused imports were removed |
| Android and iOS bundle (`npx expo export --platform android --platform ios`) | Both bundle (3.78 MB each, about the same as before) |
| Route files | Same 41 paths as before; each is a one-line re-export to a file that exists |
| Circular imports | None (145 modules, 414 import edges checked) |
| Leftover literal API paths / direct `api` calls in screens | None |
| ESLint | Not configured in this project, so not run |
| Tests | The project has no tests, so none were run |

**Not verified:** the app was not run on a device or emulator, so screen-by-screen behaviour, the look of each screen, and background GPS were not tested by hand. The changes were mechanical (moves, import rewiring, path-for-builder swaps), and every API swap was an exact-match replacement that would have stopped on any mismatch. Even so, a quick tap-through of each role is the remaining check.

A full copy of the pre-refactor `app/` and `src/` was kept during the work for comparison.

## 10. Recommendations

1. **ESLint:** add `eslint-config-expo`, plus `import/no-cycle` to keep the import graph acyclic.
2. **Tests:** add `jest-expo` and React Native Testing Library. Start with `services/api/client.ts` (refresh), `features/auth/utils/experience.ts` and the zod schemas.
3. **Typed routes:** turn on Expo Router typed routes (`experiments.typedRoutes`), so `ROUTES` and `href` are checked at compile time.
4. **Response types:** responses are typed per screen. Moving those types next to `endpoints.ts`, or generating them from the backend's OpenAPI document, would remove the remaining loose `data.data` reads.
5. **Server state:** if screens grow, `@tanstack/react-query` could replace `useQuery` for caching and shared refetching. That is a library change, so it was not done here.
6. **Large screens:** `AgencySignupScreen` (155 lines), `ProfileScreen`, `DriverTripDetailScreen` and `NewBookingScreen` are the largest. Their step sections could become feature components if they grow further.
