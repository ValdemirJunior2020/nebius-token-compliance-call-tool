import 'package:flutter/material.dart';

class AppTheme {
  static ThemeData light() {
    final base = ThemeData(
      colorSchemeSeed: Colors.green,
      useMaterial3: true,
      brightness: Brightness.light,
    );
    return base.copyWith(
      cupertinoOverrideTheme: const NoDefaultCupertinoThemeData(
        primaryColor: Colors.green,
      ),
    );
  }

  static ThemeData dark() {
    final base = ThemeData(
      colorSchemeSeed: Colors.green,
      useMaterial3: true,
      brightness: Brightness.dark,
    );
    return base;
  }
}
