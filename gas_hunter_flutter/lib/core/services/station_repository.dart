import 'dart:math';

import '../models/station.dart';

class StationRepository {
  Future<List<GasStation>> fetchNearby({
    required double lat,
    required double lng,
    required FuelType fuelType,
    required int radiusMiles,
    String query = '',
  }) async {
    await Future<void>.delayed(const Duration(milliseconds: 500));

    final random = Random();
    final zipSeed = ['10001', '30301', '60601', '73301', '85001'];

    final stations = List.generate(18, (i) {
      final price = (2.79 + random.nextDouble() * 1.35);
      final city = ['Austin', 'Phoenix', 'Chicago', 'Atlanta', 'New York'][i % 5];
      final state = ['TX', 'AZ', 'IL', 'GA', 'NY'][i % 5];
      return GasStation(
        id: 'st_$i',
        name: 'GasHunter Station ${i + 1}',
        address: '${100 + i} Main St',
        city: city,
        state: state,
        zip: zipSeed[i % 5],
        phone: '(555) 010-${1000 + i}',
        hours: i.isEven ? 'Open 24 hours' : '5:00 AM - 11:00 PM',
        fuelType: fuelType,
        price: double.parse(price.toStringAsFixed(2)),
        distanceMiles: double.parse((random.nextDouble() * radiusMiles).toStringAsFixed(1)),
        latitude: lat + (random.nextDouble() - 0.5) / 60,
        longitude: lng + (random.nextDouble() - 0.5) / 60,
        updatedAt: DateTime.now().subtract(Duration(minutes: random.nextInt(55))),
        priceHistory: [price + .18, price + .12, price + .07, price + .03, price],
      );
    });

    final normalizedQuery = query.trim().toLowerCase();
    final filtered = normalizedQuery.isEmpty
        ? stations
        : stations
            .where(
              (s) => s.city.toLowerCase().contains(normalizedQuery) ||
                  s.zip.contains(normalizedQuery),
            )
            .toList();

    filtered.sort((a, b) => a.price.compareTo(b.price));
    return filtered;
  }
}
