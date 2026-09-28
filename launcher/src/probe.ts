// `inventory --probe`: describe this host as an inventory snippet. Read-only:
// it queries GPU tools and USB serial descriptors and never opens or resets a board.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import YAML from 'yaml';
import type { Device, Host } from './inventory.ts';

const tryRun = (cmd: string, args: string[]) => {
  try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return undefined; }
};

export function nvidiaDevices(csv = tryRun('nvidia-smi', ['--query-gpu=index,name,memory.total,driver_version', '--format=csv,noheader,nounits'])): Device[] {
  if (!csv) return [];
  return csv.trim().split('\n').filter(Boolean).map((line) => {
    const [index, name, mem, driver] = line.split(',').map((s) => s.trim());
    return { kind: 'gpu', vendor: 'nvidia', index: Number(index), model: name.replace(/^NVIDIA\s+/, ''), vram_gb: Math.round(Number(mem) / 1024), driver, label: `gpu${index}` };
  });
}

export function serialDevices(dir = '/dev/serial/by-id'): { id: string; dev: string }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((id) => ({ id, dev: realpathSync(`${dir}/${id}`) }));
}

export function probeInventory(): string {
  const devices: Device[] = [...nvidiaDevices()];
  const serial = serialDevices();
  const host: Host = { name: hostname(), address: 'local', devices };
  let text = '# Probed inventory for this host. Review before saving to ~/.config/inference-engines/inventory.yaml.\n';
  if (serial.length) {
    text += '# USB serial ports found. MCU boards need their roles (e.g. flash, serial), chip and memory\n';
    text += '# filled in by hand; the probe does not open ports, because that can reset a board.\n';
    for (const s of serial) text += `#   ${s.dev}  ${s.id}\n`;
  }
  if (!devices.length && !serial.length) text += '# no GPUs or serial devices detected\n';
  return text + YAML.stringify({ hosts: [host] });
}
