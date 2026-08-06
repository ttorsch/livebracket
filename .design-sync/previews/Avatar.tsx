import { Avatar } from 'livebracket-ds';

export function Sizes() {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', padding: 20 }}>
      <Avatar name="Aroon K." />
      <Avatar name="Lukas M." size={32} />
      <Avatar name="Mali S." size={48} />
    </div>
  );
}

export function Placeholder() {
  return (
    <div style={{ padding: 20 }}>
      <Avatar size={44} />
    </div>
  );
}
