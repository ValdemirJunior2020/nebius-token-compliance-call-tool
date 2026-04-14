# GasHunter

**Tagline:** _Never overpay for gas again._

Production-lean Flutter 3.29+ starter for a location-based gas price app with:
- Riverpod + go_router architecture
- Firebase Authentication (email/password, reset password, account deletion with re-auth)
- Real-time location + map/list views
- Fuel and radius filters
- Station detail with price history chart
- Pull-to-refresh + background auto-refresh every 5 minutes
- Local notifications scaffolding for price-drop alerts
- Material 3 adaptive UI, dark/light themes, onboarding, shimmer loading, offline cache hooks

## Firebase
This app is wired to the exact provided Firebase Web config in `lib/firebase_options.dart`.

## Run
```bash
flutter pub get
flutter run
```

## Platform notes
- **Windows dev**: fully supported for Android builds/emulators.
- **iOS**: build on macOS or CI (Codemagic).

## Important setup for production
1. Add Android/iOS Firebase app registrations and native config files.
2. Configure location/background modes in AndroidManifest and iOS plist.
3. Replace mock station repository with real pricing API backend.
4. Add secure server-side validation for user-submitted price reports.
