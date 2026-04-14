import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth_controller.dart';

class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final emailCtrl = TextEditingController();
  String message = '';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Forgot Password')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            TextField(controller: emailCtrl, decoration: const InputDecoration(labelText: 'Email')),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () async {
                await ref.read(authServiceProvider).forgotPassword(emailCtrl.text.trim());
                setState(() => message = 'Reset email sent.');
              },
              child: const Text('Send reset link'),
            ),
            if (message.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 12), child: Text(message)),
          ],
        ),
      ),
    );
  }
}
