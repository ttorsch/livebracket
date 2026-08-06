import { DateChip } from 'livebracket-ds';

export function Range() {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 20 }}>
      <DateChip>Aug 9, 2026</DateChip>
      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>to</span>
      <DateChip>Aug 10, 2026</DateChip>
    </div>
  );
}
