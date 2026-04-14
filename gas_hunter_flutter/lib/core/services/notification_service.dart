import 'package:flutter_local_notifications/flutter_local_notifications.dart';

class NotificationService {
  static final NotificationService _instance = NotificationService._();
  factory NotificationService() => _instance;
  NotificationService._();

  final _plugin = FlutterLocalNotificationsPlugin();

  Future<void> init() async {
    const android = AndroidInitializationSettings('@mipmap/ic_launcher');
    const settings = InitializationSettings(android: android, iOS: DarwinInitializationSettings());
    await _plugin.initialize(settings);
  }

  Future<void> notifyPriceDrop(String title, String body) async {
    const android = AndroidNotificationDetails('price_alerts', 'Price Alerts', importance: Importance.max);
    await _plugin.show(1, title, body, const NotificationDetails(android: android, iOS: DarwinNotificationDetails()));
  }
}
