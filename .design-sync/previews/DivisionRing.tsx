import { DivisionRing } from 'livebracket-ds';

export function States() {
  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center', padding: 20 }}>
      <DivisionRing value="19/24" label="Men" />
      <DivisionRing value="24/24" label="Women" filled />
      <DivisionRing value="6/16" label="Mixed" size={48} />
    </div>
  );
}
