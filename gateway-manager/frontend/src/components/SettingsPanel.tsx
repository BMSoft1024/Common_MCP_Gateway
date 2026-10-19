interface Props {
  version?: string;
  globalDefaults?: Record<string, unknown>;
  logging?: Record<string, unknown>;
}

function flatten(prefix: string, value: unknown, out: [string, string][]): void {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, v] of Object.entries(value)) flatten(prefix ? `${prefix}.${key}` : key, v, out);
  } else {
    out.push([prefix, String(value)]);
  }
}

function Section({ title, data }: { title: string; data?: Record<string, unknown> }) {
  const rows: [string, string][] = [];
  if (data) flatten('', data, rows);
  return (
    <section className="bg-dark-card border border-dark-border rounded-lg p-4">
      <h3 className="text-lg font-bold mb-3">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">Not configured.</p>
      ) : (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
          {rows.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-4 border-b border-dark-border py-1 min-w-0">
              <dt className="text-gray-400">{key}</dt>
              <dd className="font-mono break-all text-right">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function SettingsPanel({ version, globalDefaults, logging }: Props) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-400">
        Read-only view of the shared settings. Edit them in the config file; saving a server here keeps them unchanged.
        {version && <> Config version: <span className="font-mono">{version}</span>.</>}
      </p>
      <Section title="Global defaults" data={globalDefaults} />
      <Section title="Logging" data={logging} />
    </div>
  );
}
