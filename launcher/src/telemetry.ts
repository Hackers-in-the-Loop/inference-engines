// Optional OpenTelemetry Collector sidecar (`up --otel`): scrapes the engine's
// Prometheus endpoint and writes OTLP JSON to the run record, plus forwards to
// OTEL_EXPORTER_OTLP_ENDPOINT when it is set.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Recipe } from './manifest.ts';
import { ensureDir } from './nodes.ts';

export const COLLECTOR_IMAGE =
  'docker.io/otel/opentelemetry-collector-contrib:0.161.0@sha256:fd328de2552466ad78385e1b1289c3f2402b1c45f265b252aab1955b42845ac1';

export function containerEngine(): string | undefined {
  for (const bin of ['podman', 'docker']) {
    try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return bin; } catch { /* try next */ }
  }
  return undefined;
}

export function collectorConfig(recipe: Recipe, url: string, forward?: string): string {
  const metrics = recipe.telemetry?.metrics;
  if (!metrics) throw new Error(`${recipe.id} declares no telemetry.metrics endpoint`);
  const target = new URL(url);
  const exporters = ['file'];
  const lines = [
    'receivers:',
    '  prometheus:',
    '    config:',
    '      scrape_configs:',
    `        - job_name: ${JSON.stringify(recipe.id)}`,
    '          scrape_interval: 5s',
    `          metrics_path: ${JSON.stringify(metrics.path)}`,
    `          static_configs: [{targets: [${JSON.stringify(target.host)}]}]`,
    'processors:',
    '  resource:',
    '    attributes:',
    `      - {key: ie.recipe.id, value: ${JSON.stringify(recipe.id)}, action: upsert}`,
    'exporters:',
    '  file:',
    '    path: /telemetry/metrics.jsonl',
  ];
  if (forward) {
    exporters.push('otlphttp');
    lines.push('  otlphttp:', `    endpoint: ${JSON.stringify(forward)}`);
  }
  lines.push(
    'service:',
    '  telemetry: {logs: {level: warn}}',
    '  pipelines:',
    '    metrics:',
    '      receivers: [prometheus]',
    '      processors: [resource]',
    `      exporters: [${exporters.join(', ')}]`,
  );
  return lines.join('\n') + '\n';
}

export function startCollector(recipe: Recipe, url: string, runDir: string): { container?: string } {
  const engine = containerEngine();
  if (!engine) throw new Error('--otel needs podman or docker to run the collector');
  const dir = ensureDir(join(runDir, 'telemetry'));
  writeFileSync(join(dir, 'collector.yaml'), collectorConfig(recipe, url, process.env.OTEL_EXPORTER_OTLP_ENDPOINT));
  const name = `ie-otel-${recipe.id.replace(/[^a-z0-9]+/g, '-')}`;
  execFileSync(engine, ['rm', '-f', name], { stdio: 'ignore' });
  // Run as the invoking user so the collector can write into the run record.
  const user = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
  const userArgs = engine === 'podman' ? ['--userns=keep-id', '--user', user] : ['--user', user];
  execFileSync(engine, [
    'run', '-d', '--name', name, '--network', 'host', ...userArgs,
    '-v', `${dir}:/telemetry:Z`, COLLECTOR_IMAGE, '--config=/telemetry/collector.yaml',
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  process.stderr.write(`[ie] telemetry: collector ${name} writing ${join(dir, 'metrics.jsonl')}\n`);
  return { container: `${engine}:${name}` };
}

export function stopCollector(c: { container?: string }): void {
  if (!c.container) return;
  const [engine, name] = c.container.split(':');
  try { execFileSync(engine, ['rm', '-f', name], { stdio: 'ignore' }); } catch { /* already gone */ }
}
