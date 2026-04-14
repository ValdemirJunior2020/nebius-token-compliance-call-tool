import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';

import 'app/app.dart';
import 'core/services/notification_service.dart';
import 'firebase_options.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Hive.initFlutter();
  await Firebase.initializeApp(options: FirebaseOptions(
    apiKey: firebaseConfig['apiKey']!,
    appId: firebaseConfig['appId']!,
    messagingSenderId: firebaseConfig['messagingSenderId']!,
    projectId: firebaseConfig['projectId']!,
    authDomain: firebaseConfig['authDomain'],
    storageBucket: firebaseConfig['storageBucket'],
    measurementId: firebaseConfig['measurementId'],
  ));
  await NotificationService().init();

  runApp(const ProviderScope(child: GasHunterApp()));
}
