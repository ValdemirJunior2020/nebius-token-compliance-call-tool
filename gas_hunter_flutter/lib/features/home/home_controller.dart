import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models/station.dart';
import '../../core/services/cache_service.dart';
import '../../core/services/location_service.dart';
import '../../core/services/notification_service.dart';
import '../../core/services/station_repository.dart';

final cacheServiceProvider = Provider((ref) => CacheService());
final locationServiceProvider = Provider((ref) => LocationService());
final stationRepoProvider = Provider((ref) => StationRepository());
final notificationServiceProvider = Provider((ref) => NotificationService());

final fuelFilterProvider = StateProvider<FuelType>((ref) => FuelType.regular);
final radiusFilterProvider = StateProvider<int>((ref) => 10);
final searchQueryProvider = StateProvider<String>((ref) => '');

final favoriteIdsProvider = StateNotifierProvider<FavoriteIdsNotifier, Set<String>>(
  FavoriteIdsNotifier.new,
);

class FavoriteIdsNotifier extends StateNotifier<Set<String>> {
  FavoriteIdsNotifier(this.ref) : super(<String>{}) {
    _load();
  }

  final Ref ref;

  Future<void> _load() async {
    final ids = await ref.read(cacheServiceProvider).favorites();
    state = ids.toSet();
  }

  Future<void> toggle(String stationId) async {
    final updated = {...state};
    if (!updated.remove(stationId)) {
      updated.add(stationId);
    }
    state = updated;
    await ref.read(cacheServiceProvider).saveFavorites(updated.toList());
  }
}

class StationNotifier extends AsyncNotifier<List<GasStation>> {
  Timer? _timer;

  @override
  Future<List<GasStation>> build() async {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(minutes: 5), (_) => ref.invalidateSelf());
    ref.onDispose(() => _timer?.cancel());

    final fuelType = ref.watch(fuelFilterProvider);
    final radius = ref.watch(radiusFilterProvider);
    final query = ref.watch(searchQueryProvider);
    final favoriteIds = ref.watch(favoriteIdsProvider);
    final position = await ref.read(locationServiceProvider).currentPosition();
    final stations = await ref.read(stationRepoProvider).fetchNearby(
          lat: position.latitude,
          lng: position.longitude,
          fuelType: fuelType,
          radiusMiles: radius,
          query: query,
        );

    final decorated = stations
        .map((e) => e.copyWith(isFavorite: favoriteIds.contains(e.id)))
        .toList();

    await _sendPriceAlerts(decorated);
    return decorated;
  }

  Future<void> _sendPriceAlerts(List<GasStation> stations) async {
    if (stations.isEmpty) return;
    final threshold = await ref.read(cacheServiceProvider).alertThreshold();
    final cheapest = stations.first;
    if (cheapest.price <= threshold) {
      await ref.read(notificationServiceProvider).notifyPriceDrop(
            'GasHunter Alert',
            '${cheapest.name} is ${cheapest.price.toStringAsFixed(2)} (${cheapest.fuelType.label})',
          );
    }
  }

  Future<void> refresh() async => ref.invalidateSelf();
}

final stationsProvider = AsyncNotifierProvider<StationNotifier, List<GasStation>>(StationNotifier.new);
