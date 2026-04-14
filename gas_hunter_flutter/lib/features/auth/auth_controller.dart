import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/services/auth_service.dart';

final authServiceProvider = Provider((ref) => AuthService());

final authLoadingProvider = StateProvider<bool>((ref) => false);
