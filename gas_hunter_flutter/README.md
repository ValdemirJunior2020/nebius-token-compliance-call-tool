# GasHunter

**Tagline:** _Never overpay for gas again._

GasHunter is a production-minded Flutter 3.29+ starter for location-based fuel discovery with a privacy-first UX.

## Implemented
- Riverpod + go_router architecture
- Firebase Authentication: Login, Sign Up, Forgot Password, persistent auth state
- Account deletion with re-authentication + `FirebaseAuth.instance.currentUser?.delete()`
- Real-time location permissions (foreground + best-effort background)
- Map + List + Favorites + Profile tabs
- Fuel filters (Regular/Midgrade/Premium/Diesel/E85) + radius filters (5/10/25 miles)
- Search by city/ZIP
- Pull-to-refresh + automatic refresh every 5 minutes
- Station detail page with `fl_chart` price history + report CTA
- Local notification scaffolding for price-drop alerts
- Dark/light Material 3 theming + shimmer loading + onboarding + Hive cache hooks

## Firebase
This app is wired to the exact provided Firebase web config in `lib/firebase_options.dart`.

## Run
```bash
flutter pub get
flutter run
```

## Platform notes
- **Windows development**: fully supported for Android builds/emulators.
- **iOS**: build on macOS or CI services such as Codemagic.

## Production hardening checklist
1. Register Android/iOS Firebase apps and add native config files.
2. Configure background location capabilities in AndroidManifest + iOS Info.plist.
3. Replace `StationRepository` mock data with a live backend feed.
4. Add backend validation + abuse controls for user price reports.
5. Add widget/unit/integration tests in CI (GitHub Actions/Codemagic).
