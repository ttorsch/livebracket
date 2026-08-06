import { Button } from 'livebracket-ds';

export function Variants() {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <Button variant="primary">Register Team</Button>
      <Button variant="secondary">Divisions</Button>
      <Button variant="general">Sign In</Button>
      <Button variant="arrow" aria-label="Next" />
    </div>
  );
}

export function Small() {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <Button variant="primary" size="small">Register</Button>
      <Button variant="secondary" size="small">Divisions</Button>
      <Button variant="general" size="small">Sign In</Button>
      <Button variant="arrow" size="small" aria-label="Next" />
    </div>
  );
}

export function States() {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <Button variant="primary" loading>Saving</Button>
      <Button variant="primary" disabled>Registration Closed</Button>
      <Button variant="secondary" loading>Loading</Button>
    </div>
  );
}
