import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/station.dart';
import '../../core/services/location_service.dart';
import '../../core/services/station_repository.dart';

final locationServiceProvider = Provider((ref) => LocationService());
final stationRepoProvider = Provider((ref) => StationRepository());

final fuelFilterProvider = StateProvider<String>((ref) => 'Regular');
final radiusFilterProvider = StateProvider<int>((ref) => 10);

class StationNotifier extends AsyncNotifier<List<GasStation>> {
  Timer? _timer;

  @override
  Future<List<GasStation>> build() async {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(minutes: 5), (_) => ref.invalidateSelf());
    ref.onDispose(() => _timer?.cancel());

    final fuelType = ref.watch(fuelFilterProvider);
    final radius = ref.watch(radiusFilterProvider);
    final position = await ref.read(locationServiceProvider).currentPosition();
    return ref.read(stationRepoProvider).fetchNearby(
      lat: position.latitude,
      lng: position.longitude,
      fuelType: fuelType,
      radiusMiles: radius,
    );
  }

  Future<void> refresh() async => ref.invalidateSelf();
}

final stationsProvider = AsyncNotifierProvider<StationNotifier, List<GasStation>>(StationNotifier.new);
