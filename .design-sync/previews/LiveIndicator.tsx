import { LiveIndicator } from 'livebracket-ds';

export function Default() {
  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center', padding: 20 }}>
      <LiveIndicator />
      <LiveIndicator label="Court 3 · Live" size={14} />
    </div>
  );
}
