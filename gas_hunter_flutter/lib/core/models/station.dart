enum FuelType { regular, midgrade, premium, diesel, e85 }

extension FuelTypeLabel on FuelType {
  String get label => switch (this) {
        FuelType.regular => 'Regular',
        FuelType.midgrade => 'Midgrade',
        FuelType.premium => 'Premium',
        FuelType.diesel => 'Diesel',
        FuelType.e85 => 'E85',
      };

  static FuelType fromLabel(String value) {
    return FuelType.values.firstWhere(
      (e) => e.label.toLowerCase() == value.toLowerCase(),
      orElse: () => FuelType.regular,
    );
  }
}

class GasStation {
  const GasStation({
    required this.id,
    required this.name,
    required this.address,
    required this.city,
    required this.state,
    required this.zip,
    required this.phone,
    required this.hours,
    required this.fuelType,
    required this.price,
    required this.distanceMiles,
    required this.latitude,
    required this.longitude,
    required this.updatedAt,
    required this.priceHistory,
    this.isFavorite = false,
  });

  final String id;
  final String name;
  final String address;
  final String city;
  final String state;
  final String zip;
  final String phone;
  final String hours;
  final FuelType fuelType;
  final double price;
  final double distanceMiles;
  final double latitude;
  final double longitude;
  final DateTime updatedAt;
  final List<double> priceHistory;
  final bool isFavorite;

  String get fullAddress => '$address, $city, $state $zip';

  GasStation copyWith({
    bool? isFavorite,
  }) {
    return GasStation(
      id: id,
      name: name,
      address: address,
      city: city,
      state: state,
      zip: zip,
      phone: phone,
      hours: hours,
      fuelType: fuelType,
      price: price,
      distanceMiles: distanceMiles,
      latitude: latitude,
      longitude: longitude,
      updatedAt: updatedAt,
      priceHistory: priceHistory,
      isFavorite: isFavorite ?? this.isFavorite,
    );
  }
}
