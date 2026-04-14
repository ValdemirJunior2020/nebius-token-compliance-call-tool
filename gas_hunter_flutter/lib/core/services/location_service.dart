import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart' as ph;

class LocationService {
  Future<void> requestForegroundAndBackgroundPermissions() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      throw Exception('Location services are disabled.');
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }

    if (permission == LocationPermission.deniedForever) {
      throw Exception('Location permission denied forever. Please enable it in settings.');
    }

    // Best-effort background permission request for Android 10+/iOS flows.
    await ph.Permission.locationAlways.request();
  }

  Future<Position> currentPosition() async {
    await requestForegroundAndBackgroundPermissions();
    return Geolocator.getCurrentPosition(desiredAccuracy: LocationAccuracy.best);
  }
}
