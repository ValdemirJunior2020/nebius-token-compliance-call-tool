import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../home/home_controller.dart';

class StationDetailScreen extends ConsumerWidget {
  const StationDetailScreen({super.key, required this.stationId});

  final String stationId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final stations = ref.watch(stationsProvider).valueOrNull ?? [];
    final match = stations.where((s) => s.id == stationId);
    if (match.isEmpty) {
      return const Scaffold(
        body: Center(child: Text('Station not found. Pull to refresh and try again.')),
      );
    }

    final station = match.first;

    return Scaffold(
      appBar: AppBar(title: Text(station.name)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            '\$${station.price.toStringAsFixed(2)} • ${station.fuelType.label}',
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 8),
          Text(station.fullAddress),
          Text(station.phone),
          Text(station.hours),
          const SizedBox(height: 16),
          SizedBox(
            height: 220,
            child: LineChart(
              LineChartData(
                lineBarsData: [
                  LineChartBarData(
                    spots: List.generate(
                      station.priceHistory.length,
                      (i) => FlSpot(i.toDouble(), station.priceHistory[i]),
                    ),
                    isCurved: true,
                    barWidth: 3,
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Thanks! Your price update report was submitted.')),
              );
            },
            icon: const Icon(Icons.price_change_outlined),
            label: const Text('Report current price'),
          ),
        ],
      ),
    );
  }
}
