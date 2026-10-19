import { useId, useMemo, useState } from 'react';
import type { MCPServer } from '../types';

interface Props {
  initialName: string;
  initial: MCPServer;
  nameEditable: boolean;
  otherServerNames: string[];
  existingNames: string[];
  saving: boolean;
  saveError: string;
  onSubmit: (name: string, server: MCPServer) => void;
  onCancel: () => void;
}

const inputClass = 'w-full bg-dark-card border border-dark-border rounded px-4 py-2 text-white';

function parseEnv(text: string): { env?: Record<string, string>; error?: string } {
  try {
    const value = JSON.parse(text.trim() === '' ? '{}' : text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { error: 'Must be a JSON object, e.g. {"API_KEY": "value"}' };
    }
    for (const [key, v] of Object.entries(value)) {
      if (typeof v !== 'string') return { error: `Value of "${key}" must be a string` };
    }
    return { env: value as Record<string, string> };
  } catch {
    return { error: 'Invalid JSON' };
  }
}

export function ServerForm({
  initialName,
  initial,
  nameEditable,
  otherServerNames,
  existingNames,
  saving,
  saveError,
  onSubmit,
  onCancel
}: Props) {
  const uid = useId();
  const [name, setName] = useState(initialName);
  const [command, setCommand] = useState(initial.command ?? '');
  const [argsText, setArgsText] = useState((initial.args ?? []).join('\n'));
  const [envText, setEnvText] = useState(JSON.stringify(initial.env ?? {}, null, 2));
  const [timeoutSec, setTimeoutSec] = useState(String(Math.round((initial.timeout ?? 30000) / 1000)));
  const [retries, setRetries] = useState(String(initial.retryAttempts ?? initial.retries ?? 3));
  const [threshold, setThreshold] = useState(String(initial.circuitBreakerThreshold ?? 5));
  const [fallbacks, setFallbacks] = useState<string[]>(initial.fallbackServers ?? []);
  const [disabled, setDisabled] = useState(!!initial.disabled);

  const envResult = useMemo(() => parseEnv(envText), [envText]);

  const errors: Record<string, string> = {};
  const trimmedName = name.trim();
  if (nameEditable) {
    if (!trimmedName) errors.name = 'Name is required';
    else if (!/^[A-Za-z0-9_-]+$/.test(trimmedName)) errors.name = 'Use letters, digits, "-" and "_" only';
    else if (existingNames.includes(trimmedName)) errors.name = 'A server with this name already exists';
  }
  if (!command.trim()) errors.command = 'Command is required';
  if (envResult.error) errors.env = envResult.error;
  const timeoutNum = Number(timeoutSec);
  if (!Number.isFinite(timeoutNum) || timeoutNum < 1 || timeoutNum > 300) errors.timeout = 'Between 1 and 300 seconds';
  const retriesNum = Number(retries);
  if (!Number.isInteger(retriesNum) || retriesNum < 0 || retriesNum > 10) errors.retries = 'Whole number, 0 to 10';
  const thresholdNum = Number(threshold);
  if (!Number.isInteger(thresholdNum) || thresholdNum < 1 || thresholdNum > 100) errors.threshold = 'Whole number, 1 to 100';
  const valid = Object.keys(errors).length === 0;

  const submit = () => {
    if (!valid || !envResult.env) return;
    const { retries: _legacy, ...rest } = initial;
    onSubmit(nameEditable ? trimmedName : initialName, {
      ...rest,
      command: command.trim(),
      args: argsText.split('\n').map((s) => s.trim()).filter(Boolean),
      env: envResult.env,
      timeout: Math.round(timeoutNum * 1000),
      retryAttempts: retriesNum,
      circuitBreakerThreshold: thresholdNum,
      fallbackServers: fallbacks,
      disabled
    });
  };

  const toggleFallback = (serverName: string) =>
    setFallbacks((current) =>
      current.includes(serverName) ? current.filter((n) => n !== serverName) : [...current, serverName]
    );

  const fieldError = (key: string) => errors[key] && <p className="text-red-400 text-xs mt-1">{errors[key]}</p>;

  return (
    <div className="space-y-4">
      {nameEditable && (
        <div>
          <label htmlFor={`${uid}-name`} className="block text-sm font-medium mb-2">Server name</label>
          <input id={`${uid}-name`} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="my-mcp-server" />
          {fieldError('name')}
        </div>
      )}

      <div>
        <label htmlFor={`${uid}-command`} className="block text-sm font-medium mb-2">Command</label>
        <input id={`${uid}-command`} className={inputClass} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" />
        {fieldError('command')}
      </div>

      <div>
        <label htmlFor={`${uid}-args`} className="block text-sm font-medium mb-2">Arguments (one per line)</label>
        <textarea
          id={`${uid}-args`}
          className={`${inputClass} font-mono text-sm h-24`}
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          placeholder={'-y\n@scope/package-name'}
        />
      </div>

      <div>
        <label htmlFor={`${uid}-env`} className="block text-sm font-medium mb-2">Environment variables (JSON)</label>
        <textarea
          id={`${uid}-env`}
          className={`${inputClass} font-mono text-sm h-28 ${errors.env ? 'border-red-500' : ''}`}
          value={envText}
          onChange={(e) => setEnvText(e.target.value)}
          placeholder='{"API_KEY": "your-key"}'
        />
        {fieldError('env')}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label htmlFor={`${uid}-timeout`} className="block text-sm font-medium mb-2">Timeout (seconds)</label>
          <input id={`${uid}-timeout`} className={inputClass} type="number" min={1} max={300} value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)} />
          {fieldError('timeout')}
        </div>
        <div>
          <label htmlFor={`${uid}-retries`} className="block text-sm font-medium mb-2">Retry attempts</label>
          <input id={`${uid}-retries`} className={inputClass} type="number" min={0} max={10} value={retries} onChange={(e) => setRetries(e.target.value)} />
          {fieldError('retries')}
        </div>
        <div>
          <label htmlFor={`${uid}-threshold`} className="block text-sm font-medium mb-2">Circuit breaker threshold</label>
          <input id={`${uid}-threshold`} className={inputClass} type="number" min={1} max={100} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          {fieldError('threshold')}
        </div>
      </div>

      <fieldset>
        <legend className="block text-sm font-medium mb-2">Fallback servers</legend>
        {otherServerNames.length === 0 ? (
          <p className="text-xs text-gray-500">No other servers configured.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {otherServerNames.map((n) => (
              <label key={n} className="flex items-center space-x-2 bg-dark-card border border-dark-border rounded px-3 py-1 text-sm cursor-pointer">
                <input type="checkbox" checked={fallbacks.includes(n)} onChange={() => toggleFallback(n)} />
                <span>{n}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <label className="flex items-center space-x-2 cursor-pointer">
        <input type="checkbox" className="w-5 h-5" checked={disabled} onChange={(e) => setDisabled(e.target.checked)} />
        <span className="text-sm font-medium">Disabled</span>
      </label>

      {saveError && <p className="text-red-400 text-sm bg-red-950 border border-red-800 rounded px-3 py-2">{saveError}</p>}

      <div className="flex space-x-4 pt-2">
        <button
          onClick={submit}
          disabled={!valid || saving}
          className="bg-green-600 hover:bg-green-700 px-6 py-2 rounded-lg font-semibold disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button onClick={onCancel} className="bg-gray-600 hover:bg-gray-700 px-6 py-2 rounded-lg font-semibold">
          Cancel
        </button>
      </div>
    </div>
  );
}
