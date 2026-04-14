class GasStation {
  const GasStation({
    required this.id,
    required this.name,
    required this.address,
    required this.phone,
    required this.hours,
    required this.fuelType,
    required this.price,
    required this.distanceMiles,
    required this.latitude,
    required this.longitude,
    required this.updatedAt,
    required this.priceHistory,
  });

  final String id;
  final String name;
  final String address;
  final String phone;
  final String hours;
  final String fuelType;
  final double price;
  final double distanceMiles;
  final double latitude;
  final double longitude;
  final DateTime updatedAt;
  final List<double> priceHistory;
}
