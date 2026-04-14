import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:latlong2/latlong.dart';
import 'package:shimmer/shimmer.dart';

import '../../core/services/cache_service.dart';

import '../../core/models/station.dart';
import '../auth/auth_controller.dart';
import 'home_controller.dart';

class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  int tab = 0;
  final _searchCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final cache = CacheService();
      final seen = await cache.isOnboardingSeen();
      if (!seen && mounted) {
        await showDialog<void>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Welcome to GasHunter'),
            content: const Text('Privacy-first experience: no ads, no tracking. Find cheaper fuel around you in real time.'),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Get Started'),
              )
            ],
          ),
        );
        await cache.saveOnboardingSeen();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final stations = ref.watch(stationsProvider);
    final fuel = ref.watch(fuelFilterProvider);
    final radius = ref.watch(radiusFilterProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('GasHunter'),
        actions: [
          DropdownButton<String>(
            value: fuel,
            items: const ['Regular', 'Midgrade', 'Premium', 'Diesel', 'E85']
                .map((f) => DropdownMenuItem(value: f, child: Text(f)))
                .toList(),
            onChanged: (value) {
              if (value != null) ref.read(fuelFilterProvider.notifier).state = value;
            },
          ),
          DropdownButton<int>(
            value: radius,
            items: const [5, 10, 25].map((r) => DropdownMenuItem(value: r, child: Text('${r}mi'))).toList(),
            onChanged: (value) {
              if (value != null) ref.read(radiusFilterProvider.notifier).state = value;
            },
          ),
        ],
      ),
      body: Column(children:[
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: SearchBar(
            controller: _searchCtrl,
            hintText: 'Search by city/ZIP or use current location',
            leading: const Icon(Icons.search),
          ),
        ),
        Expanded(child: RefreshIndicator(
        onRefresh: () => ref.read(stationsProvider.notifier).refresh(),
        child: stations.when(
          loading: () => ListView.builder(
            itemCount: 6,
            itemBuilder: (_, __) => Shimmer.fromColors(
              baseColor: Colors.grey.shade400,
              highlightColor: Colors.grey.shade300,
              child: const ListTile(title: Text('Loading station...')),
            ),
          ),
          error: (e, _) => ListView(children: [Center(child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text('Error: $e'),
          ))]),
          data: (data) {
            final pages = [
              _MapTab(stations: data),
              _ListTab(stations: data),
              const _FavoritesTab(),
              const _ProfileTab(),
            ];
            return pages[tab];
          },
        ),
      )),
      ]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: tab,
        onDestinationSelected: (v) => setState(() => tab = v),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.map), label: 'Map'),
          NavigationDestination(icon: Icon(Icons.local_gas_station), label: 'List'),
          NavigationDestination(icon: Icon(Icons.favorite), label: 'Favorites'),
          NavigationDestination(icon: Icon(Icons.person), label: 'Profile'),
        ],
      ),
    );
  }
}

class _MapTab extends StatelessWidget {
  const _MapTab({required this.stations});
  final List<GasStation> stations;

  @override
  Widget build(BuildContext context) {
    final cheapest = stations.isNotEmpty ? stations.first.price : 0.0;
    return FlutterMap(
      options: MapOptions(initialCenter: LatLng(stations.first.latitude, stations.first.longitude), initialZoom: 13),
      children: [
        TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
        MarkerLayer(
          markers: stations.map((s) {
            final color = s.price <= cheapest + 0.03 ? Colors.green : Colors.orange;
            return Marker(
              point: LatLng(s.latitude, s.longitude),
              width: 120,
              height: 54,
              child: InkWell(
                onTap: () => context.push('/station/${s.id}'),
                child: Card(color: color, child: Center(child: Text('\$${s.price.toStringAsFixed(2)} ${s.fuelType}', style: const TextStyle(fontSize: 11)))),
              ),
            );
          }).toList(),
        ),
      ],
    );
  }
}

class _ListTab extends StatelessWidget {
  const _ListTab({required this.stations});
  final List<GasStation> stations;

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      itemCount: stations.length,
      itemBuilder: (_, index) {
        final s = stations[index];
        return ListTile(
          onTap: () => context.push('/station/${s.id}'),
          title: Text('${s.name} • \$${s.price.toStringAsFixed(2)}'),
          subtitle: Text('${s.distanceMiles} mi • ${s.fuelType} • ${DateFormat.jm().format(s.updatedAt)}'),
        );
      },
    );
  }
}

class _FavoritesTab extends StatelessWidget {
  const _FavoritesTab();

  @override
  Widget build(BuildContext context) {
    return const Center(child: Text('Favorites will appear here (offline cached).'));
  }
}

class _ProfileTab extends ConsumerWidget {
  const _ProfileTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = FirebaseAuth.instance.currentUser;
    final emailCtrl = TextEditingController(text: user?.email ?? '');
    final pwdCtrl = TextEditingController();

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text('Logged in as ${user?.email ?? '-'}'),
        const SizedBox(height: 12),
        OutlinedButton(
          onPressed: () => ref.read(authServiceProvider).signOut(),
          child: const Text('Logout'),
        ),
        const Divider(height: 32),
        TextField(controller: emailCtrl, decoration: const InputDecoration(labelText: 'Email (for reauth)')),
        const SizedBox(height: 8),
        TextField(controller: pwdCtrl, obscureText: true, decoration: const InputDecoration(labelText: 'Password')),
        const SizedBox(height: 12),
        FilledButton.tonal(
          onPressed: () async {
            await ref.read(authServiceProvider).deleteWithReAuth(emailCtrl.text.trim(), pwdCtrl.text.trim());
            if (context.mounted) context.go('/login');
          },
          child: const Text('Delete account'),
        ),
      ],
    );
  }
}
