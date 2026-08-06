import { Icon } from 'livebracket-ds';

const NAMES = [
  'search', 'mic', 'location', 'star', 'starFilled', 'arrowRight', 'chevronRight', 'chevronDown',
  'x', 'trophy', 'users', 'calendar', 'bell', 'plus', 'filter', 'play',
];

export function Set() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 18, padding: 20 }}>
      {NAMES.map((n) => (
        <div key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <Icon name={n} size={24} color="var(--text-primary)" />
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{n}</span>
        </div>
      ))}
    </div>
  );
}
