import { PageControl } from 'livebracket-ds';
import { useState } from 'react';

export function Default() {
  return (
    <div style={{ display: 'flex', gap: 32, alignItems: 'center', padding: 24 }}>
      <PageControl count={3} active={0} />
      <PageControl count={4} active={2} />
    </div>
  );
}

export function Interactive() {
  const [active, setActive] = useState(1);
  return (
    <div style={{ padding: 24 }}>
      <PageControl count={3} active={active} onChange={setActive} />
    </div>
  );
}
