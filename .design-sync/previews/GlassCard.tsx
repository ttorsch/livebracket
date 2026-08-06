import { GlassCard, Badge } from 'livebracket-ds';

// No shipped photo asset in this repo — the brand's own sunset gradient
// (see components/livebracket-ds/tokens/colors.css coral ramp) stands in
// for the golden-hour beach photography glass normally floats over.
const backdrop = {
  padding: 28,
  borderRadius: 24,
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 20,
  background:
    'radial-gradient(120% 140% at 15% 0%, rgba(255,206,161,.55), transparent 55%), ' +
    'radial-gradient(90% 120% at 90% 100%, rgba(235,111,67,.5), transparent 60%), ' +
    'linear-gradient(160deg,#F7C175 0%,#EB6F43 45%,#8F3215 100%)',
};

export function Tones() {
  return (
    <div style={backdrop}>
      <GlassCard tone="light" radius="2xl">
        <Badge variant="live">Live</Badge>
        <h3 className="lb-h3" style={{ marginTop: 12 }}>Khao Lak Classic</h3>
        <p className="lb-body" style={{ marginTop: 6 }}>Open division · frosted light glass.</p>
      </GlassCard>
      <GlassCard tone="dark" radius="2xl" elevation="deep">
        <Badge variant="highlight">Featured</Badge>
        <h3 className="lb-h3" style={{ marginTop: 12, color: '#fff' }}>Night Finals</h3>
        <p className="lb-body" style={{ marginTop: 6, color: 'rgba(255,255,255,.8)' }}>Dark glass over photo.</p>
      </GlassCard>
    </div>
  );
}
