import 'dart:math';

import '../models/station.dart';

class StationRepository {
  Future<List<GasStation>> fetchNearby({
    required double lat,
    required double lng,
    required String fuelType,
    required int radiusMiles,
  }) async {
    await Future<void>.delayed(const Duration(milliseconds: 500));

    final r = Random();
    final stations = List.generate(14, (i) {
      final price = (2.85 + r.nextDouble() * 1.2);
      return GasStation(
        id: 'st_$i',
        name: 'Station ${i + 1}',
        address: '${100 + i} Main St',
        phone: '(555) 010-${1000 + i}',
        hours: 'Open 24 hours',
        fuelType: fuelType,
        price: double.parse(price.toStringAsFixed(2)),
        distanceMiles: double.parse((r.nextDouble() * radiusMiles).toStringAsFixed(1)),
        latitude: lat + (r.nextDouble() - 0.5) / 100,
        longitude: lng + (r.nextDouble() - 0.5) / 100,
        updatedAt: DateTime.now().subtract(Duration(minutes: r.nextInt(50))),
        priceHistory: [price + .15, price + .1, price + .08, price],
      );
    });

    stations.sort((a, b) => a.price.compareTo(b.price));
    return stations;
  }
}
