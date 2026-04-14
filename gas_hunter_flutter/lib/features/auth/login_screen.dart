import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'auth_controller.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final emailCtrl = TextEditingController();
  final pwdCtrl = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final loading = ref.watch(authLoadingProvider);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('GasHunter', style: Theme.of(context).textTheme.headlineMedium),
                  const SizedBox(height: 8),
                  const Text('Never overpay for gas again.'),
                  const SizedBox(height: 20),
                  TextField(controller: emailCtrl, decoration: const InputDecoration(labelText: 'Email')),
                  const SizedBox(height: 12),
                  TextField(controller: pwdCtrl, obscureText: true, decoration: const InputDecoration(labelText: 'Password')),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: loading
                        ? null
                        : () async {
                            ref.read(authLoadingProvider.notifier).state = true;
                            try {
                              await ref.read(authServiceProvider).signIn(emailCtrl.text.trim(), pwdCtrl.text.trim());
                            } finally {
                              ref.read(authLoadingProvider.notifier).state = false;
                            }
                          },
                    child: Text(loading ? 'Signing in...' : 'Login'),
                  ),
                  TextButton(onPressed: () => context.go('/signup'), child: const Text('Create account')),
                  TextButton(onPressed: () => context.go('/forgot'), child: const Text('Forgot password?')),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
