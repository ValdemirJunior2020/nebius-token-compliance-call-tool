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
    final station = stations.firstWhere((s) => s.id == stationId);

    return Scaffold(
      appBar: AppBar(title: Text(station.name)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('\$${station.price.toStringAsFixed(2)} • ${station.fuelType}', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 8),
          Text(station.address),
          Text(station.phone),
          Text(station.hours),
          const SizedBox(height: 16),
          SizedBox(
            height: 200,
            child: LineChart(LineChartData(
              lineBarsData: [
                LineChartBarData(
                  spots: List.generate(station.priceHistory.length, (i) => FlSpot(i.toDouble(), station.priceHistory[i])),
                  isCurved: true,
                ),
              ],
            )),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Thank you! Price report submitted.')));
            },
            child: const Text('Report current price'),
          ),
        ],
      ),
    );
  }
}
