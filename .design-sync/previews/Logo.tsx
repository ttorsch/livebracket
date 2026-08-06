import { Logo } from 'livebracket-ds';

export function Variants() {
  return (
    <div style={{ display: 'flex', gap: 36, alignItems: 'center', flexWrap: 'wrap', padding: 20 }}>
      <Logo variant="mark" size={56} />
      <Logo variant="lockup" size={40} />
      <Logo variant="wordmark" size={40} />
    </div>
  );
}

export function OnPhoto() {
  return (
    <div
      style={{
        padding: '22px 28px',
        margin: 20,
        borderRadius: 24,
        display: 'inline-block',
        background:
          'radial-gradient(120% 140% at 15% 0%, rgba(255,206,161,.55), transparent 55%), ' +
          'linear-gradient(160deg,#F7C175 0%,#EB6F43 45%,#8F3215 100%)',
      }}
    >
      <Logo variant="lockup" size={34} color="#fff" />
    </div>
  );
}
