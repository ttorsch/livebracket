import { Card } from 'livebracket-ds';

export function Default() {
  return (
    <div style={{ padding: 20 }}>
      <Card radius="xl" interactive style={{ maxWidth: 280 }}>
        <h3 className="lb-h3">Memories Beach</h3>
        <p className="lb-body" style={{ marginTop: 6 }}>
          Opaque warm-white card with a soft ambient shadow — hover to lift.
        </p>
      </Card>
    </div>
  );
}
