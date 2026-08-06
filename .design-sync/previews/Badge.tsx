import { Badge } from 'livebracket-ds';

export function Variants() {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <Badge variant="live">Live</Badge>
      <Badge variant="highlight">Featured</Badge>
      <Badge variant="status">Upcoming</Badge>
      <Badge variant="outline">Open</Badge>
    </div>
  );
}
