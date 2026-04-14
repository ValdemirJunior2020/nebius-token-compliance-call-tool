import 'package:hive/hive.dart';

class CacheService {
  static const _boxName = 'gas_hunter_cache';

  Future<Box<dynamic>> _open() => Hive.openBox<dynamic>(_boxName);

  Future<void> saveOnboardingSeen() async {
    final box = await _open();
    await box.put('onboarding_seen', true);
  }

  Future<bool> isOnboardingSeen() async {
    final box = await _open();
    return box.get('onboarding_seen', defaultValue: false) as bool;
  }

  Future<void> saveFavorites(List<String> ids) async {
    final box = await _open();
    await box.put('favorites', ids);
  }

  Future<List<String>> favorites() async {
    final box = await _open();
    return (box.get('favorites', defaultValue: <String>[]) as List).cast<String>();
  }
}
